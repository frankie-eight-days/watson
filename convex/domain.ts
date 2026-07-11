/**
 * domain.ts — the convenience projections (Library/Lab/Conference views) +
 * enrichment mutations Tab B calls to fill the rich fields thin artifact events
 * can't carry (score, distillation, metricBefore/After, …).
 *
 * All views can still render from the event stream alone; these are for indexed
 * reads only.
 */

import type { MutationCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { definedOnly } from './util';

const metricPointV = v.object({ x: v.number(), y: v.number() });

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
async function findRow(
  ctx: MutationCtx,
  table: 'papers' | 'pitches' | 'experiments' | 'prs',
  idField: string,
  engagementId: string,
  idValue: string,
) {
  const rows = await ctx.db
    .query(table)
    .withIndex('by_engagementId', (q) => q.eq('engagementId', engagementId))
    .collect();
  return rows.find((r) => (r as Record<string, unknown>)[idField] === idValue) ?? null;
}

// ---------------------------------------------------------------------------
// Papers
// ---------------------------------------------------------------------------
export const upsertPaper = mutation({
  args: {
    paperId: v.string(),
    engagementId: v.string(),
    title: v.optional(v.string()),
    authors: v.optional(v.array(v.string())),
    abstract: v.optional(v.string()),
    url: v.optional(v.string()),
    stage: v.optional(
      v.union(
        v.literal('discovered'),
        v.literal('screened'),
        v.literal('distilled'),
        v.literal('cited'),
        v.literal('pitched'),
      ),
    ),
    score: v.optional(v.number()),
    gradeRationale: v.optional(v.string()),
    distillation: v.optional(v.string()),
    citationPass: v.optional(v.boolean()),
    pitchId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await findRow(ctx, 'papers', 'paperId', args.engagementId, args.paperId);
    if (existing) {
      await ctx.db.patch(existing._id, definedOnly({ ...args, paperId: undefined, engagementId: undefined }));
      return existing._id;
    }
    return ctx.db.insert('papers', {
      paperId: args.paperId,
      engagementId: args.engagementId,
      title: args.title ?? '',
      authors: args.authors ?? [],
      abstract: args.abstract ?? '',
      url: args.url ?? '',
      stage: args.stage ?? 'discovered',
      score: args.score,
      gradeRationale: args.gradeRationale,
      distillation: args.distillation,
      citationPass: args.citationPass,
      pitchId: args.pitchId,
      createdAt: Date.now(),
    });
  },
});

export const papersByEngagement = query({
  args: { engagementId: v.string() },
  handler: async (ctx, { engagementId }) =>
    ctx.db
      .query('papers')
      .withIndex('by_engagementId', (q) => q.eq('engagementId', engagementId))
      .collect(),
});

// ---------------------------------------------------------------------------
// Pitches
// ---------------------------------------------------------------------------
export const upsertPitch = mutation({
  args: {
    pitchId: v.string(),
    engagementId: v.string(),
    hypothesis: v.optional(v.string()),
    sourcePaperIds: v.optional(v.array(v.string())),
    expectedImpact: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal('proposed'),
        v.literal('testing'),
        v.literal('validated'),
        v.literal('rejected'),
        v.literal('prd'),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await findRow(ctx, 'pitches', 'pitchId', args.engagementId, args.pitchId);
    if (existing) {
      await ctx.db.patch(existing._id, definedOnly({ ...args, pitchId: undefined, engagementId: undefined }));
      return existing._id;
    }
    return ctx.db.insert('pitches', {
      pitchId: args.pitchId,
      engagementId: args.engagementId,
      hypothesis: args.hypothesis ?? '',
      sourcePaperIds: args.sourcePaperIds ?? [],
      expectedImpact: args.expectedImpact ?? '',
      status: args.status ?? 'proposed',
      createdAt: Date.now(),
    });
  },
});

export const pitchesByEngagement = query({
  args: { engagementId: v.string() },
  handler: async (ctx, { engagementId }) =>
    ctx.db
      .query('pitches')
      .withIndex('by_engagementId', (q) => q.eq('engagementId', engagementId))
      .collect(),
});

// ---------------------------------------------------------------------------
// Experiments
// ---------------------------------------------------------------------------
export const upsertExperiment = mutation({
  args: {
    experimentId: v.string(),
    engagementId: v.string(),
    pitchId: v.optional(v.string()),
    sandboxId: v.optional(v.string()),
    command: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal('proposed'),
        v.literal('testing'),
        v.literal('validated'),
        v.literal('rejected'),
        v.literal('failed'),
      ),
    ),
    baselineMetric: v.optional(v.number()),
    resultMetric: v.optional(v.number()),
    metricUnit: v.optional(v.string()),
    logsRef: v.optional(v.string()),
    series: v.optional(v.array(metricPointV)),
  },
  handler: async (ctx, args) => {
    const existing = await findRow(
      ctx,
      'experiments',
      'experimentId',
      args.engagementId,
      args.experimentId,
    );
    if (existing) {
      await ctx.db.patch(
        existing._id,
        definedOnly({ ...args, experimentId: undefined, engagementId: undefined }),
      );
      return existing._id;
    }
    return ctx.db.insert('experiments', {
      experimentId: args.experimentId,
      engagementId: args.engagementId,
      pitchId: args.pitchId ?? '',
      sandboxId: args.sandboxId,
      command: args.command ?? '',
      status: args.status ?? 'proposed',
      baselineMetric: args.baselineMetric,
      resultMetric: args.resultMetric,
      metricUnit: args.metricUnit,
      logsRef: args.logsRef,
      series: args.series,
      createdAt: Date.now(),
    });
  },
});

export const experimentsByEngagement = query({
  args: { engagementId: v.string() },
  handler: async (ctx, { engagementId }) =>
    ctx.db
      .query('experiments')
      .withIndex('by_engagementId', (q) => q.eq('engagementId', engagementId))
      .collect(),
});

// ---------------------------------------------------------------------------
// PRs
// ---------------------------------------------------------------------------
export const upsertPr = mutation({
  args: {
    prId: v.string(),
    engagementId: v.string(),
    number: v.optional(v.number()),
    url: v.optional(v.string()),
    title: v.optional(v.string()),
    pitchId: v.optional(v.string()),
    metricBefore: v.optional(v.number()),
    metricAfter: v.optional(v.number()),
    metricUnit: v.optional(v.string()),
    state: v.optional(v.union(v.literal('open'), v.literal('merged'), v.literal('closed'))),
  },
  handler: async (ctx, args) => {
    const existing = await findRow(ctx, 'prs', 'prId', args.engagementId, args.prId);
    if (existing) {
      await ctx.db.patch(existing._id, definedOnly({ ...args, prId: undefined, engagementId: undefined }));
      return existing._id;
    }
    return ctx.db.insert('prs', {
      prId: args.prId,
      engagementId: args.engagementId,
      number: args.number ?? 0,
      url: args.url ?? '',
      title: args.title ?? '',
      pitchId: args.pitchId ?? '',
      metricBefore: args.metricBefore,
      metricAfter: args.metricAfter,
      metricUnit: args.metricUnit,
      state: args.state ?? 'open',
      createdAt: Date.now(),
    });
  },
});

export const prsByEngagement = query({
  args: { engagementId: v.string() },
  handler: async (ctx, { engagementId }) =>
    ctx.db
      .query('prs')
      .withIndex('by_engagementId', (q) => q.eq('engagementId', engagementId))
      .collect(),
});
