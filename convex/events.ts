/**
 * events.ts — the primary read path. Every view renders from these.
 */

import { query } from './_generated/server';
import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';

/** Paginated walk of an engagement's stream, seq ascending. */
export const eventsByEngagement = query({
  args: { engagementId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { engagementId, paginationOpts }) => {
    return ctx.db
      .query('events')
      .withIndex('by_engagement_seq', (q) => q.eq('engagementId', engagementId))
      .order('asc')
      .paginate(paginationOpts);
  },
});

/** Live tail: everything with seq strictly greater than `sinceSeq`. */
export const tailEvents = query({
  args: { engagementId: v.string(), sinceSeq: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, { engagementId, sinceSeq, limit }) => {
    return ctx.db
      .query('events')
      .withIndex('by_engagement_seq', (q) =>
        q.eq('engagementId', engagementId).gt('seq', sinceSeq),
      )
      .order('asc')
      .take(limit ?? 500);
  },
});

/** Cheap inclusive [startSeq, endSeq] range read for replay windows. */
export const eventsWindow = query({
  args: { engagementId: v.string(), startSeq: v.number(), endSeq: v.number() },
  handler: async (ctx, { engagementId, startSeq, endSeq }) => {
    return ctx.db
      .query('events')
      .withIndex('by_engagement_seq', (q) =>
        q.eq('engagementId', engagementId).gte('seq', startSeq).lte('seq', endSeq),
      )
      .order('asc')
      .collect();
  },
});

/** Convenience: current max seq for an engagement (or -1 if empty). */
export const maxSeq = query({
  args: { engagementId: v.string() },
  handler: async (ctx, { engagementId }) => {
    const last = await ctx.db
      .query('events')
      .withIndex('by_engagement_seq', (q) => q.eq('engagementId', engagementId))
      .order('desc')
      .first();
    return last ? last.seq : -1;
  },
});
