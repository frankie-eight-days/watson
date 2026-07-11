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
} from '@watson/shared';

export type EmitMode = 'convex' | 'mock';

export interface BrainContextConfig {
  engagementId: string;
  /** Convex *.site* base URL for the /emit endpoint (used in 'convex' mode). */
  convexUrl: string;
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

  constructor(cfg: BrainContextConfig) {
    if (cfg.emitMode === 'mock' && !cfg.mockFilePath) {
      throw new Error("BrainContext: emitMode 'mock' requires mockFilePath");
    }
    this.cfg = cfg;
    this.engagementId = cfg.engagementId;
    this.models = cfg.models;
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
      emitter = new EventEmitterClient({
        convexUrl: this.cfg.convexUrl,
        engagementId: this.engagementId,
        agentId,
        model,
        fetchImpl: this.cfg.fetchImpl ?? (globalThis.fetch as typeof fetch),
      });
    }
    this.emitters.push(emitter);
    return emitter;
  }

  /**
   * Bring an agent into existence: mint its id, build its emitter, and
   * self-emit its `spawn` as the FIRST event on that agent's stream. Enforces
   * the contract rule that `parentAgentId` is null iff the agent is Hermes.
   */
  spawn(args: SpawnArgs): SpawnedAgent {
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
    return { agentId, emitter };
  }

  /** Emit a `handoff` from one agent to another. */
  handoff(from: Emitter, toAgentId: string, reason: string, summary: string): void {
    from.emit('handoff', { toAgentId, reason, summary });
  }

  /** Emit a lifecycle `status` transition for an agent. */
  status(
    emitter: Emitter,
    status: 'spawned' | 'running' | 'waiting' | 'done' | 'failed',
    detail?: string,
  ): void {
    emitter.emit('status', { status, ...(detail ? { detail } : {}) });
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
