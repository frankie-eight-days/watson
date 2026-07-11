/**
 * agents.ts — the org tree: explicit mirror mutations + view queries.
 */

import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { setAgentStatusRow, upsertAgentRecord } from './ingest';

const tierV = v.union(v.literal('hermes'), v.literal('orchestrator'), v.literal('worker'));
const agentStatusV = v.union(
  v.literal('spawned'),
  v.literal('running'),
  v.literal('waiting'),
  v.literal('done'),
  v.literal('failed'),
);

/** Mirror of a spawn — used by Tab B when it needs to register out of band. */
export const registerAgent = mutation({
  args: {
    agentId: v.string(),
    engagementId: v.string(),
    parentAgentId: v.union(v.string(), v.null()),
    role: v.string(),
    tier: tierV,
    model: v.string(),
    label: v.optional(v.string()),
    status: v.optional(agentStatusV),
    spawnedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await upsertAgentRecord(ctx, {
      agentId: args.agentId,
      engagementId: args.engagementId,
      parentAgentId: args.parentAgentId,
      role: args.role,
      tier: args.tier,
      model: args.model,
      label: args.label,
      status: args.status ?? 'spawned',
      spawnedAt: args.spawnedAt ?? Date.now(),
    });
  },
});

export const setAgentStatus = mutation({
  args: { agentId: v.string(), status: agentStatusV, engagementId: v.optional(v.string()) },
  handler: async (ctx, { agentId, status, engagementId }) => {
    await setAgentStatusRow(ctx, agentId, status, engagementId);
  },
});

/** Flat list; the client builds the tree from parentAgentId. */
export const agentsByEngagement = query({
  args: { engagementId: v.string() },
  handler: async (ctx, { engagementId }) => {
    return ctx.db
      .query('agents')
      .withIndex('by_engagementId', (q) => q.eq('engagementId', engagementId))
      .collect();
  },
});

/** Per-agent event feed for the console drawer (by_agent_seq, seq asc). */
export const agentEvents = query({
  args: { agentId: v.string(), sinceSeq: v.optional(v.number()) },
  handler: async (ctx, { agentId, sinceSeq }) => {
    return ctx.db
      .query('events')
      .withIndex('by_agent_seq', (q) =>
        sinceSeq === undefined
          ? q.eq('agentId', agentId)
          : q.eq('agentId', agentId).gt('seq', sinceSeq),
      )
      .order('asc')
      .collect();
  },
});
