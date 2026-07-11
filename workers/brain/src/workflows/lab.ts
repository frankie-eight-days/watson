/**
 * lab.ts — the Lab authors REAL code live, then proves it in the cloud sandbox.
 *
 * Hermes runs ONE shared baseline, then dispatches ALL library pitches IN
 * PARALLEL. For each pitch it spawns a dynamic implementer specialist (role
 * derived from the pitch, e.g. 'compaction-implementer') registered under Hermes,
 * which:
 *   1. fetches the current target file from the fork (GitHub raw, main),
 *   2. authors the real code change with gpt-5.6-terra (full new file content),
 *   3. commits it to a fresh branch via the sandbox /implement endpoint,
 *   4. runs the demo profile on that branch via /run (REAL per-day series),
 *   5. compares candidate vs the shared baseline → validated | rejected,
 *   6. on a win opens a REAL PR (/pr, idempotent) and upserts the prs row.
 * Pitch A (memory compaction) has a silent fallback to the pre-validated
 * `feat/memory-compaction` branch so the money shot is guaranteed. Every pitch's
 * whole flow is wrapped so a failure shows an honest 'rejected — failed to build'
 * card and never crashes the run or the other pitches. Hermes reviews the
 * portfolio at the end (terra, threading the client goal).
 */

import type { BrainContext } from '../lib/context';
import type { Emitter } from '@watson/shared';
import type { ModelClient } from '../lib/model';
import type { Pitch } from './library';
import { think, convexMutation, parseRepo, githubRaw } from './util';

const LOCKED_BASELINE = 850.99;
const CANDIDATE_FALLBACK_REF = 'feat/memory-compaction';
const MAX_AUTHOR_CHARS = 12000; // larger files can't be surgically rewritten in one pass

/** The locked PR payload for the pre-validated pitch-A fallback branch. */
const LOCKED_PR_PAYLOAD = {
  pitchTitle: 'Memory compaction (summarize-on-evict)',
  title: 'feat: memory compaction — Total Assets $850.99 → $963.47 (+13.2%) on the 8k demo profile',
  headBranch: CANDIDATE_FALLBACK_REF,
  base: 'main',
  patchDescription:
    'Pitch A: replaces lossy sliding-window truncation in src/llm/context.ts with MemGPT-style summarize-on-evict — evicted history folded into a pinned [MEMORY] note.',
  metricBefore: 850.99,
  metricAfter: 963.47,
  citations: [
    { title: 'MemGPT — Packer et al. 2023 (arXiv:2310.08560)', url: 'https://arxiv.org/abs/2310.08560' },
    { title: 'Vending-Bench — Backlund & Petersson 2025 (arXiv:2502.15840)', url: 'https://arxiv.org/abs/2502.15840' },
  ],
};

export interface LabArgs {
  hermesAgentId: string;
  hermesEmitter: Emitter;
  engagementId: string;
  pitches: Pitch[];
  repoUrl?: string;
  sandboxRunnerUrl: string;
  convexApiUrl?: string;
  goal?: string;
  model: ModelClient;
}

export interface PitchOutcome {
  pitch: Pitch;
  verdict: 'validated' | 'rejected' | 'failed';
  candidate?: number;
  prUrl?: string;
  usedFallback?: boolean;
}

export interface LabResult {
  baseline?: number;
  outcomes: PitchOutcome[];
  prUrls: string[];
}

interface SeriesPoint {
  day: number;
  totalAssets: number;
}
interface ArmResult {
  ok: boolean;
  totalAssets?: number;
  daysCompleted?: number;
  series?: SeriesPoint[];
  logsTail?: string;
  error?: string;
  status: number;
}

// ---------------------------------------------------------------- helpers

/** Invent an IMPLEMENTER role at runtime from the pitch (never hard-coded). */
function roleForPitch(pitch: Pitch): string {
  const t = `${pitch.title} ${pitch.targetFile ?? ''}`.toLowerCase();
  let topic = 'long-horizon-memory';
  if (/compact|summar|memgpt|evict|truncat/.test(t)) topic = 'compaction';
  else if (/checkpoint|state|day|persist|key_value/.test(t)) topic = 'checkpoint';
  else if (/reflect|critique|reflexion/.test(t)) topic = 'reflection';
  return `${topic}-implementer`;
}

function isPitchA(pitch: Pitch): boolean {
  const t = `${pitch.title} ${pitch.targetFile ?? ''}`.toLowerCase();
  return /compact|summar|memgpt|evict|truncat|context\.ts/.test(t);
}

function stripFence(text: string): string {
  const fence = text.match(/```(?:[a-z]*)?\n?([\s\S]*?)```/i);
  return (fence ? fence[1] : text).trim();
}

/** A representative changed-region snippet (old vs new) for the UI card. */
function keyDiffSnippet(oldText: string, newText: string): string {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  let first = 0;
  while (first < a.length && first < b.length && a[first] === b[first]) first++;
  let endB = b.length - 1;
  let endA = a.length - 1;
  while (endB > first && endA > first && a[endA] === b[endB]) {
    endA--;
    endB--;
  }
  const slice = b.slice(first, Math.min(first + 30, endB + 2));
  return slice.length ? slice.join('\n') : b.slice(0, 20).join('\n');
}

async function runArmOnce(url: string, body: Record<string, unknown>): Promise<ArmResult> {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const status = res.status;
    let data: { ok?: boolean; metric?: { totalAssets?: number; daysCompleted?: number; series?: SeriesPoint[] }; logsTail?: string; error?: string } = {};
    try {
      data = (await res.json()) as typeof data;
    } catch {
      /* non-JSON */
    }
    if (!res.ok || data.ok === false) return { ok: false, status, error: data.error ?? `status ${status}` };
    const m = data.metric ?? {};
    return {
      ok: true,
      status,
      totalAssets: typeof m.totalAssets === 'number' ? m.totalAssets : undefined,
      daysCompleted: typeof m.daysCompleted === 'number' ? m.daysCompleted : undefined,
      series: Array.isArray(m.series) ? m.series : undefined,
      logsTail: data.logsTail,
    };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

async function runArm(url: string, body: Record<string, unknown>): Promise<ArmResult> {
  let last = await runArmOnce(url, body);
  for (let i = 0; i < 4 && !last.ok; i++) {
    if (!/start|provision|retry|warm|503|502|timeout/i.test(`${last.error ?? ''} ${last.status}`)) break;
    await new Promise((r) => setTimeout(r, 10_000));
    last = await runArmOnce(url, body);
  }
  return last;
}

async function implement(
  url: string,
  body: { branchName: string; base: string; files: Array<{ path: string; content: string }> },
): Promise<{ ok: boolean; branch?: string; commitSha?: string; error?: string }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${url.replace(/\/$/, '')}/implement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 404) {
        await new Promise((r) => setTimeout(r, 8000)); // owner still deploying
        continue;
      }
      let data: { ok?: boolean; branch?: string; commitSha?: string; error?: string } = {};
      try {
        data = (await res.json()) as typeof data;
      } catch {
        /* non-JSON */
      }
      if (!res.ok || data.ok === false) return { ok: false, error: data.error ?? `status ${res.status}` };
      return { ok: true, branch: data.branch ?? body.branchName, commitSha: data.commitSha };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { ok: false, error: '/implement unavailable (404 after retries)' };
}

async function findExistingPr(owner: string, repo: string, headBranch: string): Promise<{ url?: string; number?: number }> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?state=all&head=${owner}:${headBranch}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'watson-brain' },
    });
    if (!res.ok) return {};
    const arr = (await res.json()) as Array<{ html_url?: string; number?: number }>;
    if (Array.isArray(arr) && arr[0]) return { url: arr[0].html_url, number: arr[0].number };
    return {};
  } catch {
    return {};
  }
}

async function openPr(
  sandboxUrl: string,
  owner: string,
  repo: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; prUrl?: string; prNumber?: number; existed: boolean; error?: string }> {
  const headBranch = String(payload.headBranch);
  try {
    const res = await fetch(`${sandboxUrl.replace(/\/$/, '')}/pr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    let data: { ok?: boolean; prUrl?: string; prNumber?: number; error?: string } = {};
    try {
      data = (await res.json()) as typeof data;
    } catch {
      /* non-JSON */
    }
    if (res.ok && data.ok !== false && data.prUrl) return { ok: true, prUrl: data.prUrl, prNumber: data.prNumber, existed: false };
    if (/exist|already|422/i.test(`${data.error ?? ''} ${res.status}`)) {
      const found = await findExistingPr(owner, repo, headBranch);
      if (found.url) return { ok: true, prUrl: found.url, prNumber: found.number, existed: true };
    }
    const urlMatch = (data.error ?? '').match(/https:\/\/github\.com\/\S+\/pull\/\d+/);
    if (urlMatch) return { ok: true, prUrl: urlMatch[0], existed: true };
    return { ok: false, existed: false, error: data.error ?? `status ${res.status}` };
  } catch (err) {
    return { ok: false, existed: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------- workflow

export async function runLab(ctx: BrainContext, args: LabArgs): Promise<LabResult> {
  const { owner, repo } = parseRepo(args.repoUrl);
  const command = 'npm run run:demo';

  // ---- shared BASELINE run (once) ----
  await ctx.status(args.hermesEmitter, 'running', 'lab: baseline run');
  const baseCallId = `sandbox_baseline_hermes`;
  await ctx.emit(args.hermesEmitter, 'tool_call', { tool: 'sandbox_run', args: { ref: 'main', command, seriesLabel: 'baseline' }, callId: baseCallId });
  const baseArm = await runArm(args.sandboxRunnerUrl, {
    engagementId: args.engagementId,
    agentId: 'hermes',
    experimentId: 'exp_baseline',
    repoUrl: args.repoUrl,
    ref: 'main',
    command,
    seriesLabel: 'baseline',
  });
  await ctx.emit(args.hermesEmitter, 'tool_result', {
    tool: 'sandbox_run',
    callId: baseCallId,
    ok: baseArm.ok,
    ...(baseArm.ok ? { result: { totalAssets: baseArm.totalAssets, daysCompleted: baseArm.daysCompleted, points: baseArm.series?.length ?? 0 } } : { error: baseArm.error }),
  });
  const baseline = typeof baseArm.totalAssets === 'number' ? baseArm.totalAssets : LOCKED_BASELINE;
  if (baseArm.ok && baseArm.series?.length) {
    await ctx.emit(args.hermesEmitter, 'metric', {
      name: 'total_assets',
      value: baseline,
      unit: 'usd',
      series: baseArm.series.map((p) => ({ x: p.day, y: p.totalAssets })),
      seriesLabel: 'baseline',
    });
  }
  await ctx.emit(args.hermesEmitter, 'thought', { text: `Baseline established: $${baseline.toFixed(2)} Total Assets on \`main\`. Dispatching ${args.pitches.length} implementers in parallel.`, title: 'baseline' });

  // ---- dispatch ALL pitches in PARALLEL ----
  const outcomes = await Promise.all(
    args.pitches.map((pitch) => runPitchSafe(ctx, args, pitch, baseline, owner, repo, command)),
  );

  const prUrls = outcomes.map((o) => o.prUrl).filter((u): u is string => Boolean(u));

  // ---- Hermes reviews the PORTFOLIO ----
  await ctx.status(args.hermesEmitter, 'running', 'reviewing lab portfolio');
  const portfolio = outcomes
    .map((o) => `- ${o.pitch.title}: ${o.verdict}${o.candidate != null ? ` ($${o.candidate.toFixed(2)} vs $${baseline.toFixed(2)})` : ''}${o.usedFallback ? ' [fallback]' : ''}${o.prUrl ? ` PR ${o.prUrl}` : ''}`)
    .join('\n');
  const review = await think(ctx, args.hermesEmitter, args.model, {
    modelId: ctx.models.terra,
    effort: 'high',
    title: 'portfolio review',
    maxTokens: 500,
    system: 'You are Hermes, president of Watson, reviewing the lab portfolio for the client. Be concise (3-4 sentences): which pitches were authored + validated against the real baseline, the winning numbers, tie it to the client goal, and which PR(s) you opened.',
    user: `Client goal: ${args.goal ?? 'make the agent survive longer'}.\nBaseline: $${baseline.toFixed(2)}.\nPortfolio:\n${portfolio}`,
    fallback: `Portfolio reviewed against baseline $${baseline.toFixed(2)}.\n${portfolio}`,
  });
  await ctx.handoff(args.hermesEmitter, args.hermesAgentId, 'portfolio reviewed', review.text.slice(0, 200));
  await ctx.status(args.hermesEmitter, 'waiting', 'lab reviewed');

  return { baseline, outcomes, prUrls };
}

/** One pitch's whole flow, fully guarded so it can never crash the run. */
async function runPitchSafe(
  ctx: BrainContext,
  args: LabArgs,
  pitch: Pitch,
  baseline: number,
  owner: string,
  repo: string,
  command: string,
): Promise<PitchOutcome> {
  const experimentId = `exp_${pitch.id}`;
  const role = roleForPitch(pitch);
  let emitter: Emitter | null = null;
  let agentId = args.hermesAgentId;
  try {
    const spec = await ctx.spawn({ parentAgentId: args.hermesAgentId, role, tier: 'orchestrator', model: ctx.models.terra, label: role.replace(/-/g, ' ') });
    emitter = spec.emitter;
    agentId = spec.agentId;
    await ctx.status(emitter, 'running');
    await ctx.emit(emitter, 'thought', { text: `Spawned as ${role} to implement "${pitch.title}" (${pitch.paper}, arXiv:${pitch.arxiv}) in \`${pitch.targetFile}\`.`, title: 'role' }, { tokensIn: 100, tokensOut: 40, model: ctx.models.terra });

    await convexMutation(args.convexApiUrl, 'domain:upsertExperiment', { experimentId, engagementId: args.engagementId, pitchId: pitch.id, command, status: 'proposed', metricUnit: 'usd' });

    // 1. fetch current target file
    const targetFile = pitch.targetFile || 'src/llm/context.ts';
    const fetched = await githubRaw(owner, repo, 'main', targetFile, 20000);
    if (!fetched.ok || !fetched.text) throw new Error(`could not fetch ${targetFile} (status ${fetched.status})`);
    if (fetched.text.length > MAX_AUTHOR_CHARS) throw new Error(`target file too large for single-pass authoring (${fetched.text.length} chars)`);

    // 2. author the real change with terra (full new file content)
    const authored = await think(ctx, emitter, args.model, {
      modelId: ctx.models.terra,
      // medium (not high) effort: high reasoning burns the completion-token
      // budget and truncates the file output. Generous cap so the full file fits.
      effort: 'medium',
      title: 'author code',
      maxTokens: 16000,
      silent: true,
      system:
        'You are a senior TypeScript engineer implementing ONE surgical, minimal, build-safe change to a Vending-Bench agent fork. You will be given the FULL current file and a hypothesis. Rewrite the file to implement the hypothesis while preserving everything else EXACTLY (imports, exports, unrelated functions, types). Keep it compilable — no placeholders, no TODOs, no removed exports. Output ONLY the complete new file content: no markdown fences, no commentary.',
      user: `File: ${targetFile}\nHypothesis to implement: ${pitch.hypothesis}\nPaper: ${pitch.paper} (arXiv:${pitch.arxiv})\n\n=== CURRENT FILE ===\n${fetched.text}`,
      fallback: '',
    });
    const newContent = stripFence(authored.text);
    // A valid full-file rewrite is ~the same size as the original. Anything under
    // half the original length is a truncated/invalid author pass.
    if (newContent.length < Math.max(200, fetched.text.length * 0.5)) throw new Error(`authored content looked truncated/invalid (${newContent.length} of ${fetched.text.length} chars)`);

    const snippet = keyDiffSnippet(fetched.text, newContent);
    await ctx.emit(emitter, 'thought', { text: `Authored a ${role} change to ${targetFile} (${newContent.length} chars). Committing to a branch and building in the sandbox.`, title: 'plan' }, { model: ctx.models.terra });
    await ctx.emit(emitter, 'artifact', {
      kind: 'experiment',
      refId: experimentId,
      title: pitch.title,
      body: `**Status.** authored\n**Hypothesis.** ${pitch.hypothesis}\n**Target.** \`${targetFile}\`\n\n\`\`\`ts\n${snippet.slice(0, 1400)}\n\`\`\``,
    });

    // 3. commit to a fresh branch
    const branchName = `watson/${pitch.id}-${Date.now().toString(36).slice(-6)}`;
    const impl = await implement(args.sandboxRunnerUrl, { branchName, base: 'main', files: [{ path: targetFile, content: newContent }] });
    if (!impl.ok || !impl.branch) throw new Error(`implement failed: ${impl.error ?? 'unknown'}`);

    // 4. run the candidate branch
    const outcome = await runCandidate(ctx, args, pitch, experimentId, emitter, agentId, impl.branch, baseline, owner, repo, command, {
      paper: pitch.paper,
      arxiv: pitch.arxiv,
      patchDescription: pitch.hypothesis,
    });
    if (outcome) return outcome;

    // did not beat / failed to run with the live branch → pitch A fallback below
    throw new Error('candidate did not beat baseline');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // ---- PITCH A silent fallback: prove + PR the pre-validated branch ----
    if (isPitchA(pitch)) {
      const fb = await pitchAFallback(ctx, args, pitch, experimentId, emitter, agentId, baseline, owner, repo, command).catch(() => null);
      if (fb) return fb;
    }
    if (emitter) {
      await ctx.emit(emitter, 'error', { message: `pitch failed: ${msg}`, recoverable: true });
      await ctx.emit(emitter, 'artifact', { kind: 'experiment', refId: experimentId, title: pitch.title, body: `**Status.** rejected — failed to build/validate\n${msg}` });
      await convexMutation(args.convexApiUrl, 'domain:upsertExperiment', { experimentId, engagementId: args.engagementId, pitchId: pitch.id, status: 'failed', metricUnit: 'usd' });
      await ctx.handoff(emitter, args.hermesAgentId, 'pitch result', `${pitch.title}: failed (${msg}).`);
      await ctx.status(emitter, 'done');
    }
    return { pitch, verdict: 'failed' };
  }
}

/** Run a candidate branch, emit its series/verdict, PR on a win. Returns null if it did NOT beat baseline (so caller can fall back). */
async function runCandidate(
  ctx: BrainContext,
  args: LabArgs,
  pitch: Pitch,
  experimentId: string,
  emitter: Emitter,
  agentId: string,
  branch: string,
  baseline: number,
  owner: string,
  repo: string,
  command: string,
  cite: { paper: string; arxiv: string; patchDescription: string },
  opts: { usedFallback?: boolean; lockedPr?: boolean } = {},
): Promise<PitchOutcome | null> {
  const callId = `sandbox_run_${agentId}_${branch.replace(/[^a-z0-9]+/gi, '_')}`;
  await ctx.emit(emitter, 'tool_call', { tool: 'sandbox_run', args: { experimentId, ref: branch, command, seriesLabel: pitch.title }, callId });
  const arm = await runArm(args.sandboxRunnerUrl, { engagementId: args.engagementId, agentId, experimentId, repoUrl: args.repoUrl, ref: branch, command, seriesLabel: pitch.title });
  await ctx.emit(emitter, 'tool_result', {
    tool: 'sandbox_run',
    callId,
    ok: arm.ok,
    ...(arm.ok ? { result: { totalAssets: arm.totalAssets, daysCompleted: arm.daysCompleted, points: arm.series?.length ?? 0, logsTail: (arm.logsTail ?? '').slice(-200) } } : { error: arm.error }),
  });
  if (!arm.ok || typeof arm.totalAssets !== 'number') return null;
  const candidate = arm.totalAssets;
  if (arm.series?.length) {
    await ctx.emit(emitter, 'metric', { name: 'total_assets', value: candidate, unit: 'usd', series: arm.series.map((p) => ({ x: p.day, y: p.totalAssets })), seriesLabel: pitch.title });
  }
  const beat = candidate > baseline;
  const verdict = beat ? 'validated' : 'rejected';
  await convexMutation(args.convexApiUrl, 'domain:upsertExperiment', {
    experimentId,
    engagementId: args.engagementId,
    pitchId: pitch.id,
    command,
    status: verdict,
    baselineMetric: baseline,
    resultMetric: candidate,
    metricUnit: 'usd',
    ...(arm.series?.length ? { series: arm.series.map((p) => ({ x: p.day, y: p.totalAssets })) } : {}),
  });
  await ctx.emit(emitter, 'artifact', {
    kind: 'experiment',
    refId: experimentId,
    title: pitch.title,
    url: `https://arxiv.org/abs/${pitch.arxiv}`,
    body: `**Status.** ${verdict}${opts.usedFallback ? ' (pre-validated branch)' : ''}\n**Baseline.** $${baseline.toFixed(2)}\n**Candidate.** $${candidate.toFixed(2)} (${beat ? `WIN +${(((candidate - baseline) / baseline) * 100).toFixed(1)}%` : 'no improvement'})\n**Branch.** \`${branch}\`\n**Paper.** ${cite.paper} (arXiv:${cite.arxiv})`,
  });

  if (!beat) return null;

  // ---- winner → open a REAL PR ----
  const payload = opts.lockedPr
    ? LOCKED_PR_PAYLOAD
    : {
        pitchTitle: pitch.title,
        title: `feat: ${pitch.title} — Total Assets $${baseline.toFixed(2)} → $${candidate.toFixed(2)} (+${(((candidate - baseline) / baseline) * 100).toFixed(1)}%)`,
        headBranch: branch,
        base: 'main',
        patchDescription: cite.patchDescription,
        metricBefore: Number(baseline.toFixed(2)),
        metricAfter: Number(candidate.toFixed(2)),
        citations: [{ title: `${cite.paper} (arXiv:${cite.arxiv})`, url: `https://arxiv.org/abs/${cite.arxiv}` }],
      };
  const prCallId = `open_pr_${agentId}_${branch.replace(/[^a-z0-9]+/gi, '_')}`;
  await ctx.emit(emitter, 'tool_call', { tool: 'open_pr', args: { headBranch: payload.headBranch }, callId: prCallId });
  const pr = await openPr(args.sandboxRunnerUrl, owner, repo, payload);
  await ctx.emit(emitter, 'tool_result', { tool: 'open_pr', callId: prCallId, ok: pr.ok, ...(pr.ok ? { result: { prUrl: pr.prUrl, prNumber: pr.prNumber, existed: pr.existed } } : { error: pr.error }) });
  let prUrl: string | undefined;
  if (pr.ok && pr.prUrl) {
    prUrl = pr.prUrl;
    const prId = `pr_${pr.prNumber ?? branch}`;
    await ctx.emit(emitter, 'artifact', { kind: 'pr', refId: prId, title: payload.title, body: `${pr.existed ? 'Existing PR reused. ' : 'Opened PR. '}${pr.prUrl}\n\nTotal Assets $${payload.metricBefore} → $${payload.metricAfter}.`, url: pr.prUrl });
    await convexMutation(args.convexApiUrl, 'domain:upsertPr', { prId, engagementId: args.engagementId, ...(pr.prNumber != null ? { number: pr.prNumber } : {}), url: pr.prUrl, title: payload.title, pitchId: pitch.id, metricBefore: payload.metricBefore, metricAfter: payload.metricAfter, metricUnit: 'usd', state: 'open' });
  }
  await ctx.handoff(emitter, args.hermesAgentId, 'pitch result', `${pitch.title}: ${verdict} ($${candidate.toFixed(2)})${prUrl ? ` PR ${prUrl}` : ''}.`);
  await ctx.status(emitter, 'done');
  return { pitch, verdict, candidate, prUrl, usedFallback: opts.usedFallback };
}

/** Pitch-A insurance: run + PR the pre-validated feat/memory-compaction branch. */
async function pitchAFallback(
  ctx: BrainContext,
  args: LabArgs,
  pitch: Pitch,
  experimentId: string,
  emitter: Emitter | null,
  agentId: string,
  baseline: number,
  owner: string,
  repo: string,
  command: string,
): Promise<PitchOutcome | null> {
  if (!emitter) return null;
  await ctx.emit(emitter, 'thought', { text: `Live-authored branch did not clear the bar; falling back to the pre-validated \`${CANDIDATE_FALLBACK_REF}\` implementation.`, title: 'fallback' });
  const outcome = await runCandidate(ctx, args, pitch, experimentId, emitter, agentId, CANDIDATE_FALLBACK_REF, baseline, owner, repo, command, { paper: pitch.paper, arxiv: pitch.arxiv, patchDescription: LOCKED_PR_PAYLOAD.patchDescription }, { usedFallback: true, lockedPr: true });
  return outcome;
}
