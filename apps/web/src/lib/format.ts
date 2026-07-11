/**
 * format.ts — numeric & time formatting. Every metric/cost/token number in the
 * product is rendered through these and wears `.tnum` (tabular figures).
 */

/** USD with adaptive precision — sub-dollar shows cents/mills, else 2dp. */
export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd)) return '$0.00';
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Compact token counts: 1234 -> 1.23k, 1_200_000 -> 1.20M. */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 2 : 1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/** Plain grouped integer, e.g. 129000 -> 129,000. */
export function formatInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** A number with fixed decimals for chart/metric readouts. */
export function formatNum(n: number, dp = 1): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Clock time HH:MM:SS from epoch ms. */
export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Elapsed since a reference ts, as m:ss (used for replay position readout). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Relative "how long ago" — coarse, for card timestamps within a replay. */
export function relativeFromStart(ts: number, startTs: number): string {
  return `+${formatElapsed(ts - startTs)}`;
}
