/**
 * convex/schema.ts — Watson's Convex schema. PART OF THE FROZEN CONTRACT.
 * =====================================================================
 *
 * These tables mirror the shared types in `@watson/shared` (events.ts,
 * agents.ts, domain.ts) and PLAN.md §2. Tab A owns the *functions* (mutations,
 * queries, the emit httpAction, the replay cursor, run-diff) but this schema is
 * read-only for every tab — changes only via the architect session.
 *
 * Conventions:
 *   - `_id` / `_creationTime` are Convex built-ins; our own `createdAt`/`ts`
 *     fields are explicit epoch-ms so the event stream is self-describing and
 *     replay does not depend on Convex internals.
 *   - Cross-references use string ids that match the shared-type `id` fields
 *     (e.g. `engagementId`, `agentId`, `pitchId`). These are application ids,
 *     not Convex `Id<>` handles, so events emitted from outside Convex can carry
 *     them verbatim.
 *   - The `events` table is THE table. Its indexes are load-bearing for every
 *     view, the trace tree, and replay.
 */

import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

// The closed vocabulary of event types (kept in lockstep with EventType in
// events.ts). Convex validators can't import a TS union, so it's re-stated here.
const eventType = v.union(
  v.literal('spawn'),
  v.literal('thought'),
  v.literal('tool_call'),
  v.literal('tool_result'),
  v.literal('handoff'),
  v.literal('status'),
  v.literal('artifact'),
  v.literal('metric'),
  v.literal('steering'),
  v.literal('error'),
);

const agentTier = v.union(v.literal('hermes'), v.literal('orchestrator'), v.literal('worker'));

const agentStatus = v.union(
  v.literal('spawned'),
  v.literal('running'),
  v.literal('waiting'),
  v.literal('done'),
  v.literal('failed'),
);

export default defineSchema({
  // -------------------------------------------------------------------------
  // engagements — one client job
  // -------------------------------------------------------------------------
  engagements: defineTable({
    engagementId: v.string(), // application id (matches Engagement.id)
    repoUrl: v.string(),
    title: v.optional(v.string()),
    status: v.union(
      v.literal('active'),
      v.literal('paused'),
      v.literal('completed'),
      v.literal('failed'),
    ),
    phase: v.union(
      v.literal('bench'),
      v.literal('ingestion'),
      v.literal('library'),
      v.literal('lab'),
      v.literal('conference'),
      v.literal('done'),
    ),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  }).index('by_engagementId', ['engagementId']),

  // -------------------------------------------------------------------------
  // agents — the org tree. Roles are DATA (free string), never an enum.
  // -------------------------------------------------------------------------
  agents: defineTable({
    agentId: v.string(), // application id (matches AgentRecord.id)
    engagementId: v.string(),
    parentAgentId: v.union(v.string(), v.null()), // null only for Hermes
    role: v.string(), // free-form; novel roles appear mid-run
    tier: agentTier,
    model: v.string(),
    status: agentStatus,
    spawnedAt: v.number(),
    label: v.optional(v.string()),
  })
    .index('by_engagementId', ['engagementId'])
    .index('by_agentId', ['agentId'])
    .index('by_parent', ['parentAgentId']),

  // -------------------------------------------------------------------------
  // events — THE table. seq is monotonic per engagement, assigned server-side.
  // payload is stored as opaque JSON (v.any) — its shape is disciplined by the
  // discriminated WatsonEvent union in events.ts, validated at the emit edge.
  // -------------------------------------------------------------------------
  events: defineTable({
    engagementId: v.string(),
    agentId: v.string(),
    seq: v.number(), // monotonic per engagement
    ts: v.number(), // epoch ms
    type: eventType,
    payload: v.any(),
    tokensIn: v.optional(v.number()),
    tokensOut: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    model: v.optional(v.string()),
  })
    // Primary read path for every view + the replay cursor (ordered walk).
    .index('by_engagement_seq', ['engagementId', 'seq'])
    // Trace tree / per-agent console drawer.
    .index('by_agent_seq', ['agentId', 'seq'])
    // Filter a view by event kind within an engagement (e.g. only artifacts).
    .index('by_engagement_type', ['engagementId', 'type']),

  // -------------------------------------------------------------------------
  // papers — the Library pipeline
  // -------------------------------------------------------------------------
  papers: defineTable({
    paperId: v.string(),
    engagementId: v.string(),
    title: v.string(),
    authors: v.array(v.string()),
    abstract: v.string(),
    url: v.string(),
    stage: v.union(
      v.literal('discovered'),
      v.literal('screened'),
      v.literal('distilled'),
      v.literal('cited'),
      v.literal('pitched'),
    ),
    score: v.optional(v.number()),
    gradeRationale: v.optional(v.string()),
    distillation: v.optional(v.string()),
    citationPass: v.optional(v.boolean()),
    pitchId: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_engagementId', ['engagementId']),

  // -------------------------------------------------------------------------
  // pitches — MAD-arena hypotheses
  // -------------------------------------------------------------------------
  pitches: defineTable({
    pitchId: v.string(),
    engagementId: v.string(),
    hypothesis: v.string(),
    sourcePaperIds: v.array(v.string()),
    expectedImpact: v.string(),
    status: v.union(
      v.literal('proposed'),
      v.literal('testing'),
      v.literal('validated'),
      v.literal('rejected'),
      v.literal('prd'),
    ),
    createdAt: v.number(),
  }).index('by_engagementId', ['engagementId']),

  // -------------------------------------------------------------------------
  // experiments — sandbox runs
  // -------------------------------------------------------------------------
  experiments: defineTable({
    experimentId: v.string(),
    engagementId: v.string(),
    pitchId: v.string(),
    sandboxId: v.optional(v.string()),
    command: v.string(),
    status: v.union(
      v.literal('proposed'),
      v.literal('testing'),
      v.literal('validated'),
      v.literal('rejected'),
      v.literal('failed'),
    ),
    baselineMetric: v.optional(v.number()),
    resultMetric: v.optional(v.number()),
    metricUnit: v.optional(v.string()),
    logsRef: v.optional(v.string()),
    series: v.optional(v.array(v.object({ x: v.number(), y: v.number() }))),
    createdAt: v.number(),
  }).index('by_engagementId', ['engagementId']),

  // -------------------------------------------------------------------------
  // prs — pull requests opened on the fork
  // -------------------------------------------------------------------------
  prs: defineTable({
    prId: v.string(),
    engagementId: v.string(),
    number: v.number(),
    url: v.string(),
    title: v.string(),
    pitchId: v.string(),
    metricBefore: v.optional(v.number()),
    metricAfter: v.optional(v.number()),
    metricUnit: v.optional(v.string()),
    state: v.union(v.literal('open'), v.literal('merged'), v.literal('closed')),
    createdAt: v.number(),
  }).index('by_engagementId', ['engagementId']),

  // -------------------------------------------------------------------------
  // memory — three layers (rubric L5)
  // -------------------------------------------------------------------------
  memory: defineTable({
    memoryId: v.string(),
    layer: v.union(v.literal('task'), v.literal('client'), v.literal('rules')),
    engagementId: v.optional(v.string()), // absent for org-wide 'rules'
    key: v.string(),
    value: v.string(),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index('by_engagementId', ['engagementId'])
    .index('by_layer', ['layer']),

  // -------------------------------------------------------------------------
  // runs — replay index (scrubber + run-diff)
  // -------------------------------------------------------------------------
  runs: defineTable({
    runId: v.string(),
    engagementId: v.string(),
    label: v.string(),
    startSeq: v.number(),
    endSeq: v.number(),
    startTs: v.optional(v.number()),
    endTs: v.optional(v.number()),
    createdAt: v.number(),
  }).index('by_engagementId', ['engagementId']),

  // -------------------------------------------------------------------------
  // steering — human messages injected into a specific agent's loop
  // -------------------------------------------------------------------------
  steering: defineTable({
    steeringId: v.string(),
    engagementId: v.string(),
    agentId: v.string(),
    text: v.string(),
    from: v.optional(v.string()),
    createdAt: v.number(),
    consumed: v.optional(v.boolean()),
  })
    .index('by_agentId', ['agentId'])
    .index('by_engagementId', ['engagementId']),
});
