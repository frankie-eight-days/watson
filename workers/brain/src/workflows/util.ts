/**
 * util.ts — shared helpers for the real workflows (watercooler / library / lab).
 *
 * Keeps GitHub raw fetching, repo-url parsing, and resilient model calls in one
 * place. Every model call here is wrapped so a venue/network failure emits a
 * recoverable `error` and returns a canned fallback — the EVENT PIPE never dies
 * mid-workflow (same philosophy as harness.ts).
 */

import type { BrainContext } from '../lib/context';
import type { Emitter } from '@watson/shared';
import type { ModelClient, Effort } from '../lib/model';

/** Parse an owner/repo out of a GitHub URL (or `owner/repo` shorthand). */
export function parseRepo(repoUrl?: string): { owner: string; repo: string } {
  const fallback = { owner: 'frankie-eight-days', repo: 'watson-vending-bench' };
  if (!repoUrl) return fallback;
  const m = repoUrl.match(/github\.com[/:]([^/]+)\/([^/#?]+)/i) ?? repoUrl.match(/^([^/]+)\/([^/#?]+)$/);
  if (!m) return fallback;
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
}

/** Fetch a file from GitHub raw. Returns text (may be truncated by `maxChars`). */
export async function githubRaw(
  owner: string,
  repo: string,
  ref: string,
  path: string,
  maxChars = 6000,
): Promise<{ ok: boolean; text: string; status: number }> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, text: '', status: res.status };
    const body = await res.text();
    return { ok: true, text: body.slice(0, maxChars), status: res.status };
  } catch (err) {
    return { ok: false, text: String(err instanceof Error ? err.message : err), status: 0 };
  }
}

/**
 * One resilient model round-trip that emits a `thought` with the answer + token
 * usage. On failure emits a recoverable `error` and returns `fallback`.
 */
export async function think(
  ctx: BrainContext,
  emitter: Emitter,
  model: ModelClient,
  args: {
    modelId: string;
    effort?: Effort;
    system: string;
    user: string;
    fallback: string;
    title?: string;
    maxTokens?: number;
    /** If true, do NOT emit a thought (caller emits its own artifact). */
    silent?: boolean;
  },
): Promise<{ text: string; tokensIn: number; tokensOut: number; ok: boolean }> {
  try {
    const res = await model.call({
      model: args.modelId,
      effort: args.effort,
      messages: [
        { role: 'system', content: args.system },
        { role: 'user', content: args.user },
      ],
      ...(args.maxTokens ? { maxTokens: args.maxTokens } : {}),
    });
    const text = res.text || args.fallback;
    if (!args.silent) {
      await ctx.emit(
        emitter,
        'thought',
        { text, ...(args.title ? { title: args.title } : {}) },
        { tokensIn: res.usage.tokensIn, tokensOut: res.usage.tokensOut, model: args.modelId },
      );
    }
    return { text, tokensIn: res.usage.tokensIn, tokensOut: res.usage.tokensOut, ok: true };
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    await ctx.emit(emitter, 'error', { message: `model call failed (${args.title ?? 'think'}): ${m}`, recoverable: true });
    if (!args.silent) {
      await ctx.emit(emitter, 'thought', { text: args.fallback, ...(args.title ? { title: `${args.title} (fallback)` } : {}) });
    }
    return { text: args.fallback, tokensIn: 0, tokensOut: 0, ok: false };
  }
}

/**
 * Fire a Convex mutation over the standard function HTTP API
 * (`${apiUrl}/api/mutation`, the *.cloud* URL). Best-effort: returns null on any
 * error so a domain-projection write never breaks a run.
 */
export async function convexMutation(
  apiUrl: string | undefined,
  path: string,
  args: Record<string, unknown>,
): Promise<unknown | null> {
  if (!apiUrl) return null;
  try {
    const res = await fetch(`${apiUrl.replace(/\/$/, '')}/api/mutation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, args, format: 'json' }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { status?: string; value?: unknown };
    return data.status === 'success' ? (data.value ?? null) : null;
  } catch {
    return null;
  }
}

/** Best-effort extraction of the first JSON object/array from an LLM reply. */
export function extractJson<T = unknown>(text: string): T | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  const start = candidate.search(/[[{]/);
  if (start === -1) return null;
  // Try progressively shorter suffixes from the last bracket back.
  for (let end = candidate.length; end > start; end--) {
    const slice = candidate.slice(start, end).trim();
    const last = slice[slice.length - 1];
    if (last !== '}' && last !== ']') continue;
    try {
      return JSON.parse(slice) as T;
    } catch {
      /* keep shrinking */
    }
  }
  return null;
}
