/**
 * steering.ts — human messages injected into an agent's loop.
 *
 * appendSteering does BOTH: inserts a steering row (consumed:false) the brain
 * polls, AND emits a `steering` event into the stream so it shows up in replay.
 */

import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { assignSeqAndIngest } from './ingest';
import { genId } from './util';

export const appendSteering = mutation({
  args: {
    engagementId: v.string(),
    agentId: v.string(),
    text: v.string(),
    from: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const steeringId = genId('steer');
    const now = Date.now();

    await ctx.db.insert('steering', {
      steeringId,
      engagementId: args.engagementId,
      agentId: args.agentId,
      text: args.text,
      from: args.from,
      createdAt: now,
      consumed: false,
    });

    // Also announce it on the event stream (replay-visible).
    const [seq] = await assignSeqAndIngest(ctx, [
      {
        engagementId: args.engagementId,
        agentId: args.agentId,
        ts: now,
        type: 'steering',
        payload: { text: args.text, from: args.from },
      },
    ]);

    return { steeringId, seq };
  },
});

/** The brain subscribes to this: unconsumed steering for a given agent. */
export const pendingSteering = query({
  args: { agentId: v.string() },
  handler: async (ctx, { agentId }) => {
    const rows = await ctx.db
      .query('steering')
      .withIndex('by_agentId', (q) => q.eq('agentId', agentId))
      .collect();
    return rows.filter((r) => r.consumed !== true);
  },
});

export const consumeSteering = mutation({
  args: { steeringId: v.string() },
  handler: async (ctx, { steeringId }) => {
    const row = await ctx.db
      .query('steering')
      .filter((q) => q.eq(q.field('steeringId'), steeringId))
      .first();
    if (row) await ctx.db.patch(row._id, { consumed: true });
  },
});
