/**
 * fixture.ts — load fixtures/mock-engagement.jsonl into the deployment.
 *
 * loadFixtureBatch ingests events PRESERVING their embedded seq (faithful replay
 * timing) and materializes agents + domain rows exactly like the /emit path.
 * clearEngagement makes the load idempotent.
 *
 * Public (not internal) so the loader script can call them via the JS client
 * without deploy-key gymnastics; safe because they only touch one engagement.
 */

import type { MutationCtx } from './_generated/server';
import { mutation } from './_generated/server';
import { v } from 'convex/values';
import { assignSeqAndIngest, isValidRawEvent, type RawEvent } from './ingest';

async function deleteByEngagement(
  ctx: MutationCtx,
  table: 'events' | 'agents' | 'papers' | 'pitches' | 'experiments' | 'prs' | 'runs' | 'steering',
  engagementId: string,
) {
  const rows = await ctx.db
    .query(table)
    .withIndex('by_engagementId' as never, (q: any) => q.eq('engagementId', engagementId))
    .collect();
  for (const r of rows) await ctx.db.delete(r._id);
}

export const clearEngagement = mutation({
  args: { engagementId: v.string() },
  handler: async (ctx, { engagementId }) => {
    // events uses by_engagement_seq for its engagement filter.
    const events = await ctx.db
      .query('events')
      .withIndex('by_engagement_seq', (q) => q.eq('engagementId', engagementId))
      .collect();
    for (const e of events) await ctx.db.delete(e._id);

    await deleteByEngagement(ctx, 'agents', engagementId);
    await deleteByEngagement(ctx, 'papers', engagementId);
    await deleteByEngagement(ctx, 'pitches', engagementId);
    await deleteByEngagement(ctx, 'experiments', engagementId);
    await deleteByEngagement(ctx, 'prs', engagementId);
    await deleteByEngagement(ctx, 'runs', engagementId);
    await deleteByEngagement(ctx, 'steering', engagementId);

    const eng = await ctx.db
      .query('engagements')
      .withIndex('by_engagementId', (q) => q.eq('engagementId', engagementId))
      .first();
    if (eng) await ctx.db.delete(eng._id);

    return { cleared: events.length };
  },
});

export const loadFixtureBatch = mutation({
  args: { events: v.array(v.any()) },
  handler: async (ctx, { events }) => {
    const valid: RawEvent[] = [];
    for (const e of events) {
      if (isValidRawEvent(e)) valid.push(e as RawEvent);
    }
    const seqs = await assignSeqAndIngest(ctx, valid, { preserveSeq: true });
    return { ingested: seqs.length };
  },
});
