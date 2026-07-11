/**
 * observability.ts — cost rollups, run-diff, and event text search.
 * All computed FROM the event stream (by_engagement_seq / by_engagement_type).
 */

import type { QueryCtx } from './_generated/server';
import { query } from './_generated/server';
import { v } from 'convex/values';

interface AgentRollup {
  agentId: string;
  role?: string;
  label?: string;
  tier?: string;
  model?: string;
  steps: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

async function collectEvents(ctx: QueryCtx, engagementId: string) {
  return ctx.db
    .query('events')
    .withIndex('by_engagement_seq', (q) => q.eq('engagementId', engagementId))
    .collect();
}

/** Per-agent: step count, tokens, cost. Enriched with agent identity if known. */
export const agentCostRollup = query({
  args: { engagementId: v.string() },
  handler: async (ctx, { engagementId }): Promise<AgentRollup[]> => {
    const events = await collectEvents(ctx, engagementId);
    const agents = await ctx.db
      .query('agents')
      .withIndex('by_engagementId', (q) => q.eq('engagementId', engagementId))
      .collect();
    const meta = new Map(agents.map((a) => [a.agentId, a]));

    const roll = new Map<string, AgentRollup>();
    for (const ev of events) {
      let r = roll.get(ev.agentId);
      if (!r) {
        const m = meta.get(ev.agentId);
        r = {
          agentId: ev.agentId,
          role: m?.role,
          label: m?.label,
          tier: m?.tier,
          model: m?.model,
          steps: 0,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
        };
        roll.set(ev.agentId, r);
      }
      r.steps += 1;
      r.tokensIn += ev.tokensIn ?? 0;
      r.tokensOut += ev.tokensOut ?? 0;
      r.costUsd += ev.costUsd ?? 0;
    }
    return Array.from(roll.values()).sort((a, b) => b.costUsd - a.costUsd);
  },
});

/** Engagement totals. */
export const engagementCostRollup = query({
  args: { engagementId: v.string() },
  handler: async (ctx, { engagementId }) => {
    const events = await collectEvents(ctx, engagementId);
    let tokensIn = 0;
    let tokensOut = 0;
    let costUsd = 0;
    for (const ev of events) {
      tokensIn += ev.tokensIn ?? 0;
      tokensOut += ev.tokensOut ?? 0;
      costUsd += ev.costUsd ?? 0;
    }
    const agents = await ctx.db
      .query('agents')
      .withIndex('by_engagementId', (q) => q.eq('engagementId', engagementId))
      .collect();
    return {
      engagementId,
      events: events.length,
      agents: agents.length,
      tokensIn,
      tokensOut,
      costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
    };
  },
});

/** Side-by-side comparison of two engagements (steps, cost, metric series). */
export const runDiff = query({
  args: { engagementIdA: v.string(), engagementIdB: v.string() },
  handler: async (ctx, { engagementIdA, engagementIdB }) => {
    async function summarize(engagementId: string) {
      const events = await collectEvents(ctx, engagementId);
      let tokensIn = 0;
      let tokensOut = 0;
      let costUsd = 0;
      const metrics: Record<string, { value: number; unit?: string; seriesLabel?: string }> = {};
      for (const ev of events) {
        tokensIn += ev.tokensIn ?? 0;
        tokensOut += ev.tokensOut ?? 0;
        costUsd += ev.costUsd ?? 0;
        if (ev.type === 'metric') {
          const p = ev.payload as {
            name?: string;
            value?: number;
            unit?: string;
            seriesLabel?: string;
          };
          if (p?.name) {
            metrics[`${p.name}::${p.seriesLabel ?? ''}`] = {
              value: p.value ?? 0,
              unit: p.unit,
              seriesLabel: p.seriesLabel,
            };
          }
        }
      }
      return {
        engagementId,
        steps: events.length,
        tokensIn,
        tokensOut,
        costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
        metrics,
      };
    }
    return { a: await summarize(engagementIdA), b: await summarize(engagementIdB) };
  },
});

/** Case-insensitive substring search across event payloads. */
export const searchEvents = query({
  args: { engagementId: v.string(), query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { engagementId, query: q, limit }) => {
    const needle = q.toLowerCase();
    const events = await collectEvents(ctx, engagementId);
    const hits = events.filter((ev) =>
      JSON.stringify(ev.payload ?? {}).toLowerCase().includes(needle),
    );
    return hits.slice(0, limit ?? 200);
  },
});
