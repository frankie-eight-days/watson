/**
 * util.ts — small server-side helpers (NOT Convex functions).
 * id generation + cost derivation. Kept local so nothing has to import runtime
 * code from @watson/shared (only types are imported from there elsewhere).
 */

/** Model rate card (per 1M tokens), mirrors MODEL_RATES in @watson/shared. */
export const MODEL_RATES: Record<string, { in: number; out: number }> = {
  'gpt-5.6-terra': { in: 2.5, out: 15 },
  'gpt-5.6-luna': { in: 1, out: 6 },
};

/** USD cost for a step. Unknown models fall back to terra. Mirrors costFor(). */
export function costFor(model: string, tokensIn = 0, tokensOut = 0): number {
  const rate = MODEL_RATES[model] ?? MODEL_RATES['gpt-5.6-terra'];
  const usd = (tokensIn / 1_000_000) * rate.in + (tokensOut / 1_000_000) * rate.out;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/** Application id generator, e.g. genId('paper') -> 'paper_lq3x8f_a1b2'. */
export function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Strip keys whose value is `undefined` so a patch never clobbers with nothing. */
export function definedOnly<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(obj)) {
    if (val !== undefined) out[k] = val;
  }
  return out as Partial<T>;
}
