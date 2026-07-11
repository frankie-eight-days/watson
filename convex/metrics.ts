/**
 * metrics.ts — Lab charts. Assembled FROM metric events (by_engagement_type),
 * never from a domain table, so it stays replay-faithful.
 */

import { query } from './_generated/server';
import { v } from 'convex/values';

interface MetricPoint {
  x: number;
  y: number;
}

interface MetricSeries {
  name: string;
  seriesLabel?: string;
  unit?: string;
  latestValue: number;
  latestSeq: number;
  points: MetricPoint[];
}

/**
 * Latest series per (name, seriesLabel) key. Points accumulate across all
 * metric events for that key (each event may carry an incremental series);
 * latestValue/unit come from the highest-seq event.
 */
export const latestMetrics = query({
  args: { engagementId: v.string() },
  handler: async (ctx, { engagementId }): Promise<MetricSeries[]> => {
    const rows = await ctx.db
      .query('events')
      .withIndex('by_engagement_type', (q) =>
        q.eq('engagementId', engagementId).eq('type', 'metric'),
      )
      .order('asc')
      .collect();

    const byKey = new Map<string, MetricSeries>();
    for (const ev of rows) {
      const p = ev.payload as {
        name?: string;
        value?: number;
        unit?: string;
        seriesLabel?: string;
        series?: MetricPoint[];
      };
      if (!p || typeof p.name !== 'string') continue;
      const key = `${p.name}::${p.seriesLabel ?? ''}`;
      let s = byKey.get(key);
      if (!s) {
        s = {
          name: p.name,
          seriesLabel: p.seriesLabel,
          unit: p.unit,
          latestValue: p.value ?? 0,
          latestSeq: ev.seq,
          points: [],
        };
        byKey.set(key, s);
      }
      if (ev.seq >= s.latestSeq) {
        s.latestSeq = ev.seq;
        s.latestValue = p.value ?? s.latestValue;
        if (p.unit !== undefined) s.unit = p.unit;
      }
      if (Array.isArray(p.series)) {
        for (const pt of p.series) {
          if (pt && typeof pt.x === 'number' && typeof pt.y === 'number') s.points.push(pt);
        }
      }
    }

    return Array.from(byKey.values()).sort((a, b) =>
      a.name === b.name
        ? (a.seriesLabel ?? '').localeCompare(b.seriesLabel ?? '')
        : a.name.localeCompare(b.name),
    );
  },
});
