/**
 * engagements.ts — engagement lifecycle (Tab B calls these).
 */

import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { genId } from './util';

const phaseV = v.union(
  v.literal('bench'),
  v.literal('ingestion'),
  v.literal('library'),
  v.literal('lab'),
  v.literal('conference'),
  v.literal('done'),
);

const statusV = v.union(
  v.literal('active'),
  v.literal('paused'),
  v.literal('completed'),
  v.literal('failed'),
);

/** Create (or return existing) engagement. Generates an id when absent. */
export const createEngagement = mutation({
  args: {
    engagementId: v.optional(v.string()),
    repoUrl: v.string(),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const engagementId = args.engagementId ?? genId('eng');
    const existing = await ctx.db
      .query('engagements')
      .withIndex('by_engagementId', (q) => q.eq('engagementId', engagementId))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        repoUrl: args.repoUrl || existing.repoUrl,
        title: args.title ?? existing.title,
        updatedAt: now,
      });
      return engagementId;
    }
    await ctx.db.insert('engagements', {
      engagementId,
      repoUrl: args.repoUrl,
      title: args.title,
      status: 'active',
      phase: 'bench',
      createdAt: now,
    });
    return engagementId;
  },
});

export const setEngagementPhase = mutation({
  args: { engagementId: v.string(), phase: phaseV },
  handler: async (ctx, { engagementId, phase }) => {
    const row = await ctx.db
      .query('engagements')
      .withIndex('by_engagementId', (q) => q.eq('engagementId', engagementId))
      .first();
    if (row) await ctx.db.patch(row._id, { phase, updatedAt: Date.now() });
  },
});

export const setEngagementStatus = mutation({
  args: { engagementId: v.string(), status: statusV },
  handler: async (ctx, { engagementId, status }) => {
    const row = await ctx.db
      .query('engagements')
      .withIndex('by_engagementId', (q) => q.eq('engagementId', engagementId))
      .first();
    if (row) await ctx.db.patch(row._id, { status, updatedAt: Date.now() });
  },
});

export const getEngagement = query({
  args: { engagementId: v.string() },
  handler: async (ctx, { engagementId }) => {
    return ctx.db
      .query('engagements')
      .withIndex('by_engagementId', (q) => q.eq('engagementId', engagementId))
      .first();
  },
});

export const listEngagements = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db.query('engagements').collect();
  },
});
