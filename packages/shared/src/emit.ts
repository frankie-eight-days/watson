/**
 * emit.ts — the emitEvent client. THE SINGLE PIPE.
 * ================================================
 *
 * Every agent, in every runtime (Hermes DO, OpenAI-Agents Workers, sandbox
 * glue), constructs one emitter and calls `.emit(type, payload, usage?)` for
 * every step. That is the ONLY way state enters Watson.
 *
 * Design constraints (from PLAN.md):
 *   - seq is assigned SERVER-SIDE — the client sends events WITHOUT seq.
 *   - batch-friendly — emissions are buffered and flushed together.
 *   - fire-and-forget — `.emit()` returns void and NEVER throws; a failed flush
 *     is retried a small number of times with backoff, then dropped (with a
 *     warning) so an agent's loop is never blocked by telemetry.
 *
 * Two implementations share the `Emitter` interface:
 *   - EventEmitterClient — POSTs batches to the Convex emit endpoint (prod).
 *   - MockEmitter — appends JSONL to a local file for OFFLINE dev + replay.
 *
 * Part of the FROZEN CONTRACT — see packages/shared/README.md.
 */

import {
  EMIT_ENDPOINT_PATH,
  costFor,
  type EmitBatchRequest,
  type EmitBatchResponse,
  type EmitEventInput,
  type EventPayloadMap,
  type EventType,
  type EventUsage,
  type WatsonEvent,
} from './events';

// ===========================================================================
// Shared interface
// ===========================================================================

/** The surface every emitter exposes. Agents should depend on THIS, not a class. */
export interface Emitter {
  /**
   * Enqueue one event. Fire-and-forget: returns immediately, never throws.
   * @param type    the event kind
   * @param payload the payload matching `type`
   * @param usage   optional token/cost accounting for this step
   */
  emit<K extends EventType>(type: K, payload: EventPayloadMap[K], usage?: EventUsage): void;

  /** Force-send anything buffered. Resolves when the buffer is drained. */
  flush(): Promise<void>;

  /** Flush and release resources. Call on agent shutdown. */
  close(): Promise<void>;
}

// ===========================================================================
// Config
// ===========================================================================

export interface EmitterConfig {
  /** Base Convex deployment URL (the emit path is appended). */
  convexUrl: string;
  /** The engagement all emitted events belong to. */
  engagementId: string;
  /** The agent doing the emitting (its id is stamped on every event). */
  agentId: string;
  /** Default model for this agent; used for costUsd derivation & the `model` field. */
  model?: string;

  /** Override the endpoint path (defaults to EMIT_ENDPOINT_PATH = '/emit'). */
  endpointPath?: string;
  /** Max events per batch before an automatic flush (default 25). */
  batchSize?: number;
  /** Auto-flush interval in ms (default 250). Set 0 to disable timed flushing. */
  flushIntervalMs?: number;
  /** Max retry attempts per batch on network/5xx failure (default 3). */
  maxRetries?: number;
  /** Base backoff in ms between retries; doubles each attempt (default 150). */
  retryBackoffMs?: number;
  /** Injectable fetch (for tests / non-global-fetch runtimes). */
  fetchImpl?: typeof fetch;
  /** Called when a batch is permanently dropped after exhausting retries. */
  onDrop?: (events: EmitEventInput[], error: unknown) => void;
}

// ===========================================================================
// Base: buffering, batching, usage-stamping (shared by both emitters)
// ===========================================================================

abstract class BufferedEmitter implements Emitter {
  protected readonly engagementId: string;
  protected readonly agentId: string;
  protected readonly model?: string;
  protected readonly batchSize: number;
  protected readonly flushIntervalMs: number;

  private buffer: EmitEventInput[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Chain of in-flight flushes so close()/flush() await everything. */
  private tail: Promise<void> = Promise.resolve();

  constructor(cfg: Pick<EmitterConfig, 'engagementId' | 'agentId' | 'model' | 'batchSize' | 'flushIntervalMs'>) {
    this.engagementId = cfg.engagementId;
    this.agentId = cfg.agentId;
    this.model = cfg.model;
    this.batchSize = cfg.batchSize ?? 25;
    this.flushIntervalMs = cfg.flushIntervalMs ?? 250;

    if (this.flushIntervalMs > 0) {
      this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
      // Don't keep a Node process alive just for the flush timer.
      (this.timer as unknown as { unref?: () => void }).unref?.();
    }
  }

  emit<K extends EventType>(type: K, payload: EventPayloadMap[K], usage?: EventUsage): void {
    const model = usage?.model ?? this.model;
    // Derive costUsd if the caller gave tokens but no explicit cost.
    let costUsd = usage?.costUsd;
    if (costUsd === undefined && model && (usage?.tokensIn || usage?.tokensOut)) {
      costUsd = costFor(model, usage.tokensIn ?? 0, usage.tokensOut ?? 0);
    }

    // Build the wire event (no seq — the server assigns it). Cast is safe: the
    // fields exactly match EmitEventInput for this K.
    const event = {
      engagementId: this.engagementId,
      agentId: this.agentId,
      ts: Date.now(),
      type,
      payload,
      ...(usage?.tokensIn !== undefined ? { tokensIn: usage.tokensIn } : {}),
      ...(usage?.tokensOut !== undefined ? { tokensOut: usage.tokensOut } : {}),
      ...(costUsd !== undefined ? { costUsd } : {}),
      ...(model !== undefined ? { model } : {}),
    } as EmitEventInput;

    this.buffer.push(event);
    if (this.buffer.length >= this.batchSize) {
      void this.flush();
    }
  }

  flush(): Promise<void> {
    if (this.buffer.length === 0) return this.tail;
    const batch = this.buffer;
    this.buffer = [];
    // Serialize flushes so JSONL/HTTP ordering is preserved.
    this.tail = this.tail.then(() => this.send(batch)).catch(() => {});
    return this.tail;
  }

  async close(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
    await this.tail;
  }

  /** Deliver one batch. Implementations must not throw out of this method. */
  protected abstract send(batch: EmitEventInput[]): Promise<void>;
}

// ===========================================================================
// EventEmitterClient — POSTs to the Convex emit endpoint (production)
// ===========================================================================

export class EventEmitterClient extends BufferedEmitter {
  private readonly url: string;
  private readonly maxRetries: number;
  private readonly retryBackoffMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly onDrop?: EmitterConfig['onDrop'];

  constructor(cfg: EmitterConfig) {
    super(cfg);
    const base = cfg.convexUrl.replace(/\/+$/, '');
    const path = cfg.endpointPath ?? EMIT_ENDPOINT_PATH;
    this.url = base + (path.startsWith('/') ? path : `/${path}`);
    this.maxRetries = cfg.maxRetries ?? 3;
    this.retryBackoffMs = cfg.retryBackoffMs ?? 150;
    const injected = cfg.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);
    if (!injected) {
      throw new Error(
        'EventEmitterClient: no fetch available. Pass cfg.fetchImpl in this runtime.',
      );
    }
    this.fetchImpl = injected;
    this.onDrop = cfg.onDrop;
  }

  protected async send(batch: EmitEventInput[]): Promise<void> {
    const body: EmitBatchRequest = { events: batch };
    let attempt = 0;
    // Retry loop: network error or non-2xx or {ok:false} triggers a retry.
    for (;;) {
      try {
        const res = await this.fetchImpl(this.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`emit endpoint ${res.status}`);
        // We don't need the seqs client-side, but validate the contract shape.
        const parsed = (await res.json().catch(() => null)) as EmitBatchResponse | null;
        if (parsed && parsed.ok === false) {
          throw new Error(`emit endpoint reported failure: ${parsed.error ?? 'unknown'}`);
        }
        return; // success
      } catch (err) {
        attempt += 1;
        if (attempt > this.maxRetries) {
          // Give up — but NEVER throw into the agent loop.
          if (this.onDrop) this.onDrop(batch, err);
          else console.warn(`[watson/emit] dropped ${batch.length} event(s):`, err);
          return;
        }
        await delay(this.retryBackoffMs * 2 ** (attempt - 1));
      }
    }
  }
}

// ===========================================================================
// MockEmitter — appends JSONL to a local file for offline dev / replay
// ===========================================================================

/**
 * Offline emitter. Unlike the server, it must assign `seq` itself so the JSONL
 * is a faithful, replayable event stream. seq is monotonic per engagement,
 * counted locally (share ONE MockEmitter per engagement to keep seq correct, or
 * pass a shared `seqCounter`).
 */
export class MockEmitter extends BufferedEmitter {
  private readonly filePath: string;
  /** In-memory mirror of everything emitted (handy for tests). */
  readonly events: WatsonEvent[] = [];
  private readonly seqRef: { value: number };

  constructor(
    cfg: Pick<EmitterConfig, 'engagementId' | 'agentId' | 'model' | 'batchSize' | 'flushIntervalMs'> & {
      /** JSONL output path. */
      filePath: string;
      /** Optional shared seq counter so multiple mock emitters agree on order. */
      seqCounter?: { value: number };
    },
  ) {
    super(cfg);
    this.filePath = cfg.filePath;
    this.seqRef = cfg.seqCounter ?? { value: 0 };
  }

  protected async send(batch: EmitEventInput[]): Promise<void> {
    // Assign seq now (at flush) so it reflects true emission order.
    const withSeq: WatsonEvent[] = batch.map(
      (e) => ({ ...e, seq: this.seqRef.value++ }) as WatsonEvent,
    );
    for (const ev of withSeq) this.events.push(ev);
    const lines = withSeq.map((e) => JSON.stringify(e)).join('\n') + '\n';
    // Lazy node:fs import so this module stays bundleable for browser/Workers
    // targets that never touch MockEmitter.
    const { appendFile, mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(this.filePath), { recursive: true }).catch(() => {});
    await appendFile(this.filePath, lines, 'utf8');
  }
}

// ===========================================================================
// Helpers
// ===========================================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Convenience factory: returns an Emitter, choosing Mock vs real by whether a
 * `filePath` is supplied. Lets agent code stay agnostic in dev vs prod.
 */
export function createEmitter(
  cfg: EmitterConfig & { filePath?: string; seqCounter?: { value: number } },
): Emitter {
  if (cfg.filePath) {
    return new MockEmitter({
      engagementId: cfg.engagementId,
      agentId: cfg.agentId,
      model: cfg.model,
      batchSize: cfg.batchSize,
      flushIntervalMs: cfg.flushIntervalMs,
      filePath: cfg.filePath,
      seqCounter: cfg.seqCounter,
    });
  }
  return new EventEmitterClient(cfg);
}
