/**
 * memory.ts — three-layer memory CRUD (task / client / rules).
 * Upsert key is (layer, engagementId, key).
 */

import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { genId } from './util';

const layerV = v.union(v.literal('task'), v.literal('client'), v.literal('rules'));

export const putMemory = mutation({
  args: {
    layer: layerV,
    engagementId: v.optional(v.string()),
    key: v.string(),
    value: v.string(),
  },
  handler: async (ctx, args) => {
    const candidates = await ctx.db
      .query('memory')
      .withIndex('by_layer', (q) => q.eq('layer', args.layer))
      .collect();
    const existing = candidates.find(
      (m) => m.key === args.key && (m.engagementId ?? undefined) === (args.engagementId ?? undefined),
    );
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { value: args.value, updatedAt: now });
      return existing.memoryId;
    }
    const memoryId = genId('mem');
    await ctx.db.insert('memory', {
      memoryId,
      layer: args.layer,
      engagementId: args.engagementId,
      key: args.key,
      value: args.value,
      createdAt: now,
    });
    return memoryId;
  },
});

export const getMemory = query({
  args: { layer: layerV, engagementId: v.optional(v.string()), key: v.string() },
  handler: async (ctx, args) => {
    const candidates = await ctx.db
      .query('memory')
      .withIndex('by_layer', (q) => q.eq('layer', args.layer))
      .collect();
    return (
      candidates.find(
        (m) =>
          m.key === args.key &&
          (m.engagementId ?? undefined) === (args.engagementId ?? undefined),
      ) ?? null
    );
  },
});

export const listMemory = query({
  args: { layer: layerV, engagementId: v.optional(v.string()) },
  handler: async (ctx, { layer, engagementId }) => {
    const rows = await ctx.db
      .query('memory')
      .withIndex('by_layer', (q) => q.eq('layer', layer))
      .collect();
    if (engagementId === undefined) return rows;
    return rows.filter((m) => m.engagementId === engagementId);
  },
});

export const deleteMemory = mutation({
  args: { memoryId: v.string() },
  handler: async (ctx, { memoryId }) => {
    const row = await ctx.db
      .query('memory')
      .filter((q) => q.eq(q.field('memoryId'), memoryId))
      .first();
    if (row) await ctx.db.delete(row._id);
  },
});
