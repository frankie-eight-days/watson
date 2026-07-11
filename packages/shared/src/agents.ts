/**
 * agents.ts — the agent org-chart record.
 *
 * Watson's org structure is DATA, not code: new roles appear mid-run (this is
 * the org-structure L5 proof). So `role` is a free string, never an enum. The
 * only fixed axis is `tier`, which places an agent in the three-layer hierarchy
 * Hermes → orchestrators → workers.
 *
 * An AgentRecord is fully reconstructable from the event stream: every agent
 * self-emits a `spawn` event whose enclosing `agentId` is this `id` and whose
 * `SpawnPayload` carries the rest of these fields. Convex also materializes an
 * `agents` table (see convex/schema.ts) so views can read the tree directly.
 *
 * Part of the FROZEN CONTRACT — see packages/shared/README.md.
 */

import type { AgentStatus, AgentTier } from './events';

// Re-export so consumers can import agent enums from either module.
export type { AgentStatus, AgentTier } from './events';

export interface AgentRecord {
  /** Stable unique id (also the `agentId` on every event this agent emits). */
  id: string;

  /** The engagement (client job) this agent belongs to. */
  engagementId: string;

  /**
   * Parent in the org tree. `null` ONLY for Hermes (the root president).
   * Every other agent is spawned by exactly one parent.
   */
  parentAgentId: string | null;

  /**
   * Free-form role, e.g. 'repo-ingestion-orchestrator', 'abstract-screener',
   * 'cuda-profiling-specialist'. Roles are data — brand-new roles can appear
   * partway through a run. Never model this as a closed union.
   */
  role: string;

  /** Where this agent sits in the three-layer hierarchy. */
  tier: AgentTier; // 'hermes' | 'orchestrator' | 'worker'

  /** Backing model, e.g. 'gpt-5.6-terra' (Hermes/orchestrators) or 'gpt-5.6-luna' (workers). */
  model: string;

  /** Current lifecycle status. Latest `status` event wins. */
  status: AgentStatus; // 'spawned' | 'running' | 'waiting' | 'done' | 'failed'

  /** Epoch ms when the agent was spawned (its `spawn` event's `ts`). */
  spawnedAt: number;

  /** Optional human-friendly label for the tree pane (falls back to `role`). */
  label?: string;
}
