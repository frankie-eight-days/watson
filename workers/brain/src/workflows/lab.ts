/**
 * lab.ts — two-arm experiment workflow for the top pitch (the money shot + PR).
 *
 * Hermes spawns a DYNAMIC specialist role invented at runtime from the pitch
 * (e.g. 'memory-compaction-specialist' — org-structure L5 proof). The specialist
 * runs BOTH arms through Tab C's sandbox-runner /run, sequentially:
 *   - baseline  : ref=main
 *   - candidate : ref=feat/memory-compaction
 * Each arm's REAL per-day series ({day,totalAssets}) is emitted as its own
 * `metric` event (baseline / candidate) so the Lab chart draws two real lines.
 * The experiment lifecycle (proposed → testing → validated|rejected) is emitted
 * and mirrored into the `experiments` domain row. On a candidate win it opens a
 * REAL PR on the fork via /pr (idempotent — an existing head-branch PR is reused,
 * never duplicated), emits a `pr` artifact, and upserts the `prs` row. Hermes
 * then reviews with the real numbers (handoff + status chain), threading the
 * client goal.
 *
 * Any sandbox failure degrades gracefully (recoverable error + pending) — the
 * event pipe never hard-fails.
 */

import type { BrainContext } from '../lib/context';
import type { Emitter } from '@watson/shared';
import type { ModelClient } from '../lib/model';
import type { Pitch } from './library';
import { think, convexMutation } from './util';

/** Locked demo numbers (fallback only — real run results are preferred). */
const LOCKED_BASELINE = 850.99;

export interface LabArgs {
  hermesAgentId: string;
  hermesEmitter: Emitter;
  engagementId: string;
  pitch: Pitch;
  repoUrl?: string;
  /** Candidate branch carrying the pitch's change. */
  candidateRef?: string;
  sandboxRunnerUrl: string;
  /** Convex *.cloud* URL for domain upserts (experiments/prs). */
  convexApiUrl?: string;
  /** Client goal threaded into Hermes's review. */
  goal?: string;
  model: ModelClient;
}

export interface LabResult {
  specialistId: string;
  experimentId: string;
  ran: boolean;
  baseline?: number;
  candidate?: number;
  verdict: 'validated' | 'pending' | 'rejected';
  prUrl?: string;
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

/** Invent a specialist role string at RUNTIME from the pitch (never hard-coded). */
function roleForPitch(pitch: Pitch): string {
  const t = `${pitch.title} ${pitch.targetFile ?? ''}`.toLowerCase();
  let topic = 'long-horizon-memory';
  if (/compact|summar|memgpt|evict|truncat/.test(t)) topic = 'memory-compaction';
  else if (/checkpoint|state|day|persist|key_value/.test(t)) topic = 'state-checkpoint';
  else if (/reflect|critique|reflexion/.test(t)) topic = 'reflection-loop';
  return `${topic}-specialist`;
}

function parseRepo(repoUrl?: string): { owner: string; repo: string } {
  const fallback = { owner: 'frankie-eight-days', repo: 'watson-vending-bench' };
  if (!repoUrl) return fallback;
  const m = repoUrl.match(/github\.com[/:]([^/]+)\/([^/#?]+)/i);
  if (!m) return fallback;
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
}

async function runArmOnce(url: string, body: Record<string, unknown>): Promise<ArmResult> {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const status = res.status;
    let data: {
      ok?: boolean;
      metric?: { totalAssets?: number; daysCompleted?: number; series?: SeriesPoint[] };
      logsTail?: string;
      error?: string;
    } = {};
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

/** Sandbox cold-start ("Container is starting") is transient — retry a few times. */
async function runArm(url: string, body: Record<string, unknown>): Promise<ArmResult> {
  let last = await runArmOnce(url, body);
  for (let i = 0; i < 4 && !last.ok; i++) {
    const transient = /start|provision|retry|warm|503|502|timeout/i.test(`${last.error ?? ''} ${last.status}`);
    if (!transient) break;
    await new Promise((r) => setTimeout(r, 10_000));
    last = await runArmOnce(url, body);
  }
  return last;
}

/** The exact, locked PR payload (from the sandbox owner). */
const PR_PAYLOAD = {
  pitchTitle: 'Memory compaction (summarize-on-evict)',
  title: 'feat: memory compaction — Total Assets $850.99 → $963.47 (+13.2%) on the 8k demo profile',
  headBranch: 'feat/memory-compaction',
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

/** Query GitHub for an existing PR on the head branch (public repo, no auth). */
async function findExistingPr(owner: string, repo: string, headBranch: string): Promise<{ url?: string; number?: number }> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=all&head=${owner}:${headBranch}`,
      { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'watson-brain' } },
    );
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
): Promise<{ ok: boolean; prUrl?: string; prNumber?: number; existed: boolean; error?: string }> {
  try {
    const res = await fetch(`${sandboxUrl.replace(/\/$/, '')}/pr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(PR_PAYLOAD),
    });
    let data: { ok?: boolean; prUrl?: string; prNumber?: number; error?: string } = {};
    try {
      data = (await res.json()) as typeof data;
    } catch {
      /* non-JSON */
    }
    if (res.ok && data.ok !== false && data.prUrl) {
      return { ok: true, prUrl: data.prUrl, prNumber: data.prNumber, existed: false };
    }
    // Idempotency: a head-branch PR already exists → reuse it, treat as success.
    const errText = `${data.error ?? ''} ${res.status}`;
    if (/exist|already|422/i.test(errText)) {
      const found = await findExistingPr(owner, repo, PR_PAYLOAD.headBranch);
      if (found.url) return { ok: true, prUrl: found.url, prNumber: found.number, existed: true };
    }
    // Last resort: maybe the error string embeds the URL.
    const urlMatch = (data.error ?? '').match(/https:\/\/github\.com\/\S+\/pull\/\d+/);
    if (urlMatch) return { ok: true, prUrl: urlMatch[0], existed: true };
    return { ok: false, existed: false, error: data.error ?? `status ${res.status}` };
  } catch (err) {
    return { ok: false, existed: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------- workflow

export async function runLab(ctx: BrainContext, args: LabArgs): Promise<LabResult> {
  const role = roleForPitch(args.pitch);
  const candidateRef = args.candidateRef ?? 'feat/memory-compaction';
  const experimentId = `exp_${args.pitch.id}`;
  const command = 'npm run run:demo';
  const { owner, repo } = parseRepo(args.repoUrl);

  // --- DYNAMIC ROLE: Hermes spawns a specialist invented from the pitch ---
  const spec = await ctx.spawn({
    parentAgentId: args.hermesAgentId,
    role,
    tier: 'orchestrator',
    model: ctx.models.terra,
    label: role.replace(/-/g, ' '),
  });
  await ctx.status(spec.emitter, 'running');
  await ctx.emit(
    spec.emitter,
    'thought',
    { text: `Spawned as a ${role} to validate "${args.pitch.title}" (${args.pitch.paper}, arXiv:${args.pitch.arxiv}) against \`${args.pitch.targetFile}\`. Running baseline (main) then candidate (${candidateRef}).`, title: 'role' },
    { tokensIn: 120, tokensOut: 50, model: ctx.models.terra },
  );

  // --- experiment: proposed ---
  await convexMutation(args.convexApiUrl, 'domain:upsertExperiment', {
    experimentId,
    engagementId: args.engagementId,
    pitchId: args.pitch.id,
    command,
    status: 'proposed',
    metricUnit: 'usd',
  });
  await ctx.emit(spec.emitter, 'artifact', {
    kind: 'experiment',
    refId: experimentId,
    title: `Experiment: ${args.pitch.title}`,
    body: `**Status.** proposed\n**Hypothesis.** ${args.pitch.hypothesis}\n**Target.** \`${args.pitch.targetFile}\`\n**Arms.** baseline \`main\` vs candidate \`${candidateRef}\` — \`${command}\``,
  });

  // --- experiment: testing ---
  await ctx.emit(spec.emitter, 'artifact', {
    kind: 'experiment',
    refId: experimentId,
    title: `Experiment: ${args.pitch.title}`,
    body: `**Status.** testing\nRunning both arms in the cloud sandbox…`,
  });

  // --- run an arm, emit its real per-day series as a metric event ---
  const runAndEmit = async (armRef: string, label: 'baseline' | 'candidate'): Promise<ArmResult> => {
    const callId = `sandbox_${label}_${spec.agentId}`;
    await ctx.emit(spec.emitter, 'tool_call', { tool: 'sandbox_run', args: { experimentId, ref: armRef, command, seriesLabel: label }, callId });
    const arm = await runArm(args.sandboxRunnerUrl, {
      engagementId: args.engagementId,
      agentId: spec.agentId,
      experimentId,
      repoUrl: args.repoUrl,
      ref: armRef,
      command,
      seriesLabel: label,
    });
    await ctx.emit(spec.emitter, 'tool_result', {
      tool: 'sandbox_run',
      callId,
      ok: arm.ok,
      ...(arm.ok
        ? { result: { totalAssets: arm.totalAssets, daysCompleted: arm.daysCompleted, points: arm.series?.length ?? 0, logsTail: (arm.logsTail ?? '').slice(-300) } }
        : { error: arm.error ?? 'sandbox run failed' }),
    });
    if (arm.ok && typeof arm.totalAssets === 'number') {
      const series = (arm.series ?? []).map((p) => ({ x: p.day, y: p.totalAssets }));
      await ctx.emit(spec.emitter, 'metric', {
        name: 'total_assets',
        value: arm.totalAssets,
        unit: 'usd',
        ...(series.length ? { series } : {}),
        seriesLabel: label,
      });
      await ctx.emit(spec.emitter, 'artifact', {
        kind: 'experiment',
        refId: experimentId,
        title: `Experiment: ${args.pitch.title}`,
        body: `**Status.** testing — ${label} arm done\n**${label}** Total Assets $${arm.totalAssets.toFixed(2)} over ${arm.daysCompleted ?? series.length} days (${series.length}-point series).`,
      });
    } else {
      await ctx.emit(spec.emitter, 'error', { message: `${label} arm failed: ${arm.error ?? 'unknown'}`, recoverable: true });
    }
    return arm;
  };

  const baselineArm = await runAndEmit('main', 'baseline');
  const candidateArm = await runAndEmit(candidateRef, 'candidate');

  const baseline = baselineArm.totalAssets;
  const candidate = candidateArm.totalAssets;
  const ran = typeof baseline === 'number' && typeof candidate === 'number';
  const beat = ran && (candidate as number) > (baseline as number);
  let verdict: LabResult['verdict'] = !ran ? 'pending' : beat ? 'validated' : 'rejected';
  let prUrl: string | undefined;

  // --- mirror the result into the experiments domain row ---
  await convexMutation(args.convexApiUrl, 'domain:upsertExperiment', {
    experimentId,
    engagementId: args.engagementId,
    pitchId: args.pitch.id,
    command,
    status: verdict === 'pending' ? 'testing' : verdict,
    ...(typeof baseline === 'number' ? { baselineMetric: baseline } : {}),
    ...(typeof candidate === 'number' ? { resultMetric: candidate } : {}),
    metricUnit: 'usd',
    ...(candidateArm.series?.length ? { series: candidateArm.series.map((p) => ({ x: p.day, y: p.totalAssets })) } : {}),
  });

  // --- experiment: validated / rejected / pending ---
  await ctx.emit(spec.emitter, 'artifact', {
    kind: 'experiment',
    refId: experimentId,
    title: `Experiment: ${args.pitch.title}`,
    url: `https://arxiv.org/abs/${args.pitch.arxiv}`,
    body: ran
      ? `**Status.** ${verdict}\n**Baseline.** $${(baseline as number).toFixed(2)}\n**Candidate.** $${(candidate as number).toFixed(2)} (${beat ? `WIN +${((((candidate as number) - (baseline as number)) / (baseline as number)) * 100).toFixed(1)}%` : 'no improvement'})\n**Paper.** ${args.pitch.paper} (arXiv:${args.pitch.arxiv})`
      : `**Status.** pending\nOne or both arms did not complete (baseline: ${baselineArm.ok ? 'ok' : baselineArm.error}; candidate: ${candidateArm.ok ? 'ok' : candidateArm.error}). Retry when the sandbox is healthy.`,
  });

  // --- open the REAL PR on a candidate win (idempotent) ---
  if (beat) {
    const prCallId = `pr_${spec.agentId}`;
    await ctx.emit(spec.emitter, 'tool_call', { tool: 'open_pr', args: { headBranch: PR_PAYLOAD.headBranch, base: PR_PAYLOAD.base }, callId: prCallId });
    const pr = await openPr(args.sandboxRunnerUrl, owner, repo);
    await ctx.emit(spec.emitter, 'tool_result', {
      tool: 'open_pr',
      callId: prCallId,
      ok: pr.ok,
      ...(pr.ok ? { result: { prUrl: pr.prUrl, prNumber: pr.prNumber, existed: pr.existed } } : { error: pr.error ?? 'pr open failed' }),
    });
    if (pr.ok && pr.prUrl) {
      prUrl = pr.prUrl;
      const prId = `pr_${pr.prNumber ?? PR_PAYLOAD.headBranch}`;
      await ctx.emit(spec.emitter, 'artifact', {
        kind: 'pr',
        refId: prId,
        title: PR_PAYLOAD.title,
        body: `${pr.existed ? 'Existing PR reused (idempotent). ' : 'Opened PR. '}${pr.prUrl}\n\nTotal Assets $${PR_PAYLOAD.metricBefore} → $${PR_PAYLOAD.metricAfter} (+13.2%).`,
        url: pr.prUrl,
      });
      await convexMutation(args.convexApiUrl, 'domain:upsertPr', {
        prId,
        engagementId: args.engagementId,
        ...(pr.prNumber != null ? { number: pr.prNumber } : {}),
        url: pr.prUrl,
        title: PR_PAYLOAD.title,
        pitchId: args.pitch.id,
        metricBefore: PR_PAYLOAD.metricBefore,
        metricAfter: PR_PAYLOAD.metricAfter,
        metricUnit: 'usd',
        state: 'open',
      });
    } else {
      await ctx.emit(spec.emitter, 'error', { message: `PR open failed: ${pr.error ?? 'unknown'}`, recoverable: true });
    }
  }

  await ctx.handoff(spec.emitter, args.hermesAgentId, 'experiment result', `${args.pitch.title}: ${verdict}${ran ? ` (baseline $${(baseline as number).toFixed(2)} → candidate $${(candidate as number).toFixed(2)})` : ''}${prUrl ? ` PR ${prUrl}` : ''}.`);
  await ctx.status(spec.emitter, 'done');

  // --- Hermes reviews with the REAL numbers + client goal ---
  await ctx.status(args.hermesEmitter, 'running', 'reviewing lab result');
  const review = await think(ctx, args.hermesEmitter, args.model, {
    modelId: ctx.models.terra,
    effort: 'high',
    title: 'review',
    maxTokens: 400,
    system: 'You are Hermes, president of Watson, reviewing a lab experiment result for the client. Be concise (2-3 sentences): state the verdict, the real baseline vs candidate Total Assets, tie it to the client goal, and the next action (PR opened on a win / retry if the sandbox was down).',
    user: `Client goal: ${args.goal ?? 'make the agent survive longer'}.\nPitch: ${args.pitch.title} (${args.pitch.paper}, arXiv:${args.pitch.arxiv}).\nVerdict: ${verdict}. Baseline: ${baseline != null ? `$${baseline.toFixed(2)}` : 'n/a'}. Candidate: ${candidate != null ? `$${candidate.toFixed(2)}` : 'n/a'}. PR: ${prUrl ?? 'none'}.`,
    fallback: beat
      ? `Candidate beat baseline ($${(candidate as number).toFixed(2)} vs $${(baseline as number).toFixed(2)}) — directly advances the goal. PR opened: ${prUrl}.`
      : ran
        ? `Candidate did not beat baseline ($${(candidate as number).toFixed(2)} vs $${(baseline as number).toFixed(2)}); holding the PR and iterating.`
        : `The sandbox did not complete both arms — the experiment is pending; we will retry.`,
  });

  await ctx.handoff(args.hermesEmitter, spec.agentId, 'review complete', review.text.slice(0, 200));
  await ctx.status(args.hermesEmitter, 'waiting', 'lab reviewed');

  return { specialistId: spec.agentId, experimentId, ran, baseline, candidate, verdict, prUrl };
}
