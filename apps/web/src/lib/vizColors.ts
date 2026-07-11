/**
 * vizColors.ts — the shared series palette so a candidate's chart line and its
 * experiment card use the SAME color. Colors follow the entity (fixed order),
 * never the rank; the baseline is the recessive dashed reference.
 */
export const BASELINE_COLOR = 'var(--baseline-line)';

export const SERIES_COLORS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
] as const;

export const candidateColor = (i: number): string =>
  SERIES_COLORS[((i % SERIES_COLORS.length) + SERIES_COLORS.length) % SERIES_COLORS.length];

export const isBaselineLabel = (label: string): boolean => /base/i.test(label);
