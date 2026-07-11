/**
 * runs.ts — replay index. The scrubber lists runs; replay itself is client-side
 * walking eventsWindow. This just records the [startSeq, endSeq] bookmarks.
 */

import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { genId } from './util';

export const createRun = mutation({
  args: {
    engagementId: v.string(),
    label: v.string(),
    startSeq: v.number(),
    endSeq: v.number(),
    startTs: v.optional(v.number()),
    endTs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const runId = genId('run');
    await ctx.db.insert('runs', {
      runId,
      engagementId: args.engagementId,
      label: args.label,
      startSeq: args.startSeq,
      endSeq: args.endSeq,
      startTs: args.startTs,
      endTs: args.endTs,
      createdAt: Date.now(),
    });
    return runId;
  },
});

export const runsByEngagement = query({
  args: { engagementId: v.string() },
  handler: async (ctx, { engagementId }) =>
    ctx.db
      .query('runs')
      .withIndex('by_engagementId', (q) => q.eq('engagementId', engagementId))
      .collect(),
});
