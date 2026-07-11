/**
 * convex/podcast.ts — Watson research-podcast storage + discovery.
 * ================================================================
 * Three functions used by the `watson-podcast` Cloudflare Worker:
 *   - generateUploadUrl:  mint a Convex file-storage upload URL.
 *   - finalizePodcast:    turn a storageId into a servable URL.
 *   - podcastByEngagement: find the latest podcast report artifact.
 *
 * This is the ONLY podcast-owned Convex file; everything else is frozen.
 */

import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';

// Mint an upload URL the Worker POSTs the MP3 bytes to.
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

// Turn the storageId returned by the upload into a servable URL string.
export const finalizePodcast = mutation({
  args: { storageId: v.string() },
  handler: async (ctx, { storageId }) => {
    return await ctx.storage.getUrl(storageId as Id<'_storage'>);
  },
});

// Latest podcast report artifact for an engagement (or null).
export const podcastByEngagement = query({
  args: { engagementId: v.string() },
  handler: async (ctx, { engagementId }) => {
    const events = await ctx.db
      .query('events')
      .withIndex('by_engagement_seq', (q) => q.eq('engagementId', engagementId))
      .order('desc')
      .collect();

    for (const e of events) {
      const payload = e.payload as any;
      if (
        e.type === 'artifact' &&
        payload &&
        payload.kind === 'report' &&
        payload.title === 'podcast'
      ) {
        return { url: (payload.body ?? payload.url) as string, ts: e.ts };
      }
    }
    return null;
  },
});
