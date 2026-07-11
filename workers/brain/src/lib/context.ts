/**
 * context.ts — BrainContext: the per-engagement factory for emitters + agents.
 *
 * Everything an agent needs to exist and speak into Watson is minted here:
 *   - `emitterFor(agentId)` — an `@watson/shared` Emitter (convex or mock).
 *   - `spawn({...})`        — mints an agent id, self-emits its `spawn` (the
 *                             agent's FIRST event), returns its emitter.
 *   - `handoff` / `status`  — convenience emitters for the common transitions.
 *
 * Emit modes (env `WATSON_EMIT_MODE`):
 *   - 'convex' → EventEmitterClient POSTing batches to `${convexUrl}/emit`.
 *               `convexUrl` MUST be the Convex *.site* URL (HTTP actions live
 *               there), and we pass `fetchImpl: fetch` for the Workers runtime.
 *   - 'mock'   → MockEmitter appending JSONL to `mockFilePath`. ALL emitters in
 *               one engagement SHARE a single seqCounter so seq stays gapless
 *               and monotonic across agents (the server does this in prod).
 */

import {
  EventEmitterClient,
  MockEmitter,
  type AgentTier,
  type Emitter,
  type EventPayloadMap,
  type EventType,
  type EventUsage,
} from '@watson/shared';
import { SteeringGate } from './steering';

export type EmitMode = 'convex' | 'mock';

export interface BrainContextConfig {
  engagementId: string;
  /** Convex *.site* base URL for the /emit endpoint (used in 'convex' mode). */
  convexUrl: string;
  /** Convex *.cloud* base URL for the function API (steering read/consume). */
  convexApiUrl?: string;
  emitMode: EmitMode;
  /** JSONL output path (required in 'mock' mode). */
  mockFilePath?: string;
  /** Model ids (terra = high effort, luna = cheap fan-out). */
  models: { terra: string; luna: string };
  /** Injected fetch for the Workers runtime (convex mode). */
  fetchImpl?: typeof fetch;
}

export interface SpawnArgs {
  /** Parent in the org tree. `null` ONLY for Hermes. */
  parentAgentId: string | null;
  role: string;
  tier: AgentTier;
  model: string;
  label?: string;
}

export interface SpawnedAgent {
  agentId: string;
  emitter: Emitter;
}

/** slugify a role for a readable, id-safe agent id. */
function slug(role: string): string {
  return (
    role
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'agent'
  );
}

export class BrainContext {
  readonly engagementId: string;
  readonly models: { terra: string; luna: string };
  private readonly cfg: BrainContextConfig;
  /** Shared seq counter for mock mode so all agents share one monotonic seq. */
  private readonly seqCounter = { value: 0 };
  private readonly emitters: Emitter[] = [];
  /** Human-steering read/consume side (undefined in mock mode / no API url). */
  private readonly steering?: SteeringGate;

  constructor(cfg: BrainContextConfig) {
    if (cfg.emitMode === 'mock' && !cfg.mockFilePath) {
      throw new Error("BrainContext: emitMode 'mock' requires mockFilePath");
    }
    this.cfg = cfg;
    this.engagementId = cfg.engagementId;
    this.models = cfg.models;
    if (cfg.emitMode === 'convex' && cfg.convexApiUrl) {
      const rawFetch = cfg.fetchImpl ?? (globalThis.fetch as typeof fetch);
      this.steering = new SteeringGate(cfg.convexApiUrl, rawFetch.bind(globalThis));
    }
  }

  /**
   * Steering checkpoint: pull any unconsumed operator steering for `agentId`,
   * consume it, RE-EMIT a `steering` event on that agent's stream (so the console
   * shows it landed + was applied), and return the texts for injection into the
   * agent's next model call. Safe: returns [] on any error, zero cost when idle.
   */
  async checkSteering(emitter: Emitter, agentId: string): Promise<string[]> {
    if (!this.steering) return [];
    const rows = await this.steering.pending(agentId);
    const texts: string[] = [];
    for (const row of rows) {
      await this.steering.consume(row.steeringId);
      texts.push(row.text);
      await this.emit(emitter, 'steering', { text: `[applied] ${row.text}`, from: row.from ?? 'operator' });
    }
    return texts;
  }

  /** An Emitter stamped with `agentId` (and `model` for cost derivation). */
  emitterFor(agentId: string, model?: string): Emitter {
    let emitter: Emitter;
    if (this.cfg.emitMode === 'mock') {
      emitter = new MockEmitter({
        engagementId: this.engagementId,
        agentId,
        model,
        filePath: this.cfg.mockFilePath!,
        seqCounter: this.seqCounter,
      });
    } else {
      // Bind fetch to globalThis: the shared client calls `this.fetchImpl(...)`,
      // and an unbound global `fetch` throws "Illegal invocation" in Workers.
      const rawFetch = this.cfg.fetchImpl ?? (globalThis.fetch as typeof fetch);
      emitter = new EventEmitterClient({
        convexUrl: this.cfg.convexUrl,
        engagementId: this.engagementId,
        agentId,
        model,
        fetchImpl: rawFetch.bind(globalThis),
      });
    }
    this.emitters.push(emitter);
    return emitter;
  }

  /**
   * Bring an agent into existence: mint its id, build its emitter, and
   * self-emit its `spawn` as the FIRST event on that agent's stream. Enforces
   * the contract rule that `parentAgentId` is null iff the agent is Hermes.
   *
   * The spawn is FLUSHED before returning so that in multi-agent orchestration a
   * parent's spawn always gets a lower `seq` than its children's — replay can
   * then rebuild the tree with parents-before-children by walking `seq`.
   */
  async spawn(args: SpawnArgs): Promise<SpawnedAgent> {
    const isHermes = args.tier === 'hermes';
    if (isHermes && args.parentAgentId !== null) {
      throw new Error('spawn: Hermes must have parentAgentId=null');
    }
    if (!isHermes && args.parentAgentId === null) {
      throw new Error('spawn: only Hermes may have parentAgentId=null');
    }

    const agentId = isHermes ? 'hermes' : `${slug(args.role)}-${shortId()}`;
    const emitter = this.emitterFor(agentId, args.model);
    emitter.emit('spawn', {
      parentAgentId: args.parentAgentId,
      role: args.role,
      tier: args.tier,
      model: args.model,
      ...(args.label ? { label: args.label } : {}),
    });
    await emitter.flush();
    return { agentId, emitter };
  }

  /**
   * Emit one event and flush it immediately, so `seq` follows true emission
   * order (gapless, monotonic ts) even when several agents interleave. Use this
   * in orchestration code where ordering across agents matters.
   */
  async emit<K extends EventType>(
    emitter: Emitter,
    type: K,
    payload: EventPayloadMap[K],
    usage?: EventUsage,
  ): Promise<void> {
    emitter.emit(type, payload, usage);
    await emitter.flush();
  }

  /** Emit a `handoff` from one agent to another (flushed). */
  async handoff(from: Emitter, toAgentId: string, reason: string, summary: string): Promise<void> {
    await this.emit(from, 'handoff', { toAgentId, reason, summary });
  }

  /** Emit a lifecycle `status` transition for an agent (flushed). */
  async status(
    emitter: Emitter,
    status: 'spawned' | 'running' | 'waiting' | 'done' | 'failed',
    detail?: string,
  ): Promise<void> {
    await this.emit(emitter, 'status', { status, ...(detail ? { detail } : {}) });
  }

  /** Flush + close every emitter created in this engagement. */
  async close(): Promise<void> {
    await Promise.all(this.emitters.map((e) => e.close()));
  }
}

/** Short unique suffix. crypto.randomUUID is available in Workers & Node 18+. */
function shortId(): string {
  return crypto.randomUUID().slice(0, 8);
}
