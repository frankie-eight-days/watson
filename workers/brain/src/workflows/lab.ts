/**
 * lab.ts — experiment workflow for the top pitch.
 *
 * Hermes spawns a DYNAMIC specialist role invented at runtime from the pitch
 * (e.g. 'memory-compaction-specialist') — org-structure L5 proof. The specialist
 * emits the experiment lifecycle as `experiment` artifacts (proposed → testing →
 * validated), calls Tab C's sandbox-runner /run (which itself emits metric/status
 * events + returns {ok, metric, logsTail}), then Hermes reviews the result via a
 * terra call and emits a handoff + status chain.
 *
 * If the sandbox-runner isn't live yet, the call fails soft: a recoverable
 * `error` is emitted, everything up to the call is exercised, and the pitch is
 * marked pending — the pipe survives.
 */

import type { BrainContext } from '../lib/context';
import type { Emitter } from '@watson/shared';
import type { ModelClient } from '../lib/model';
import type { Pitch } from './library';
import { think } from './util';

export interface LabArgs {
  /** Hermes agent id (parent of the dynamic specialist) + Hermes's emitter for review. */
  hermesAgentId: string;
  hermesEmitter: Emitter;
  engagementId: string;
  pitch: Pitch;
  repoUrl?: string;
  ref?: string;
  sandboxRunnerUrl: string;
  baselineMean?: number;
  model: ModelClient;
}

export interface LabResult {
  specialistId: string;
  experimentId: string;
  ran: boolean;
  metric?: number;
  verdict: 'validated' | 'pending' | 'rejected';
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

async function callSandboxOnce(
  url: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; metric?: number; logsTail?: string; error?: string; status: number }> {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const status = res.status;
    let data: { ok?: boolean; metric?: number; logsTail?: string; error?: string } = {};
    try {
      data = (await res.json()) as typeof data;
    } catch {
      /* non-JSON */
    }
    if (!res.ok) return { ok: false, status, error: data.error ?? `status ${status}` };
    return { ok: data.ok !== false, metric: data.metric, logsTail: data.logsTail, status };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Sandbox cold-start ("Container is starting") is transient — retry a few times. */
async function callSandbox(
  url: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; metric?: number; logsTail?: string; error?: string; status: number }> {
  let last = await callSandboxOnce(url, body);
  for (let i = 0; i < 4 && !last.ok; i++) {
    const transient = /start|provision|retry|warm|503|502|timeout/i.test(`${last.error ?? ''} ${last.status}`);
    if (!transient) break;
    await new Promise((r) => setTimeout(r, 10_000));
    last = await callSandboxOnce(url, body);
  }
  return last;
}

export async function runLab(ctx: BrainContext, args: LabArgs): Promise<LabResult> {
  const role = roleForPitch(args.pitch);
  const ref = args.ref ?? 'main';
  const experimentId = `exp_${args.pitch.id}`;
  const baseline = args.baselineMean ?? 821.8;

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
    { text: `Spawned as a ${role} to validate "${args.pitch.title}" (${args.pitch.paper}, arXiv:${args.pitch.arxiv}) against \`${args.pitch.targetFile}\`.`, title: 'role' },
    { tokensIn: 120, tokensOut: 50, model: ctx.models.terra },
  );

  // --- experiment: proposed ---
  await ctx.emit(spec.emitter, 'artifact', {
    kind: 'experiment',
    refId: experimentId,
    title: `Experiment: ${args.pitch.title}`,
    body: `**Status.** proposed\n**Hypothesis.** ${args.pitch.hypothesis}\n**Target.** \`${args.pitch.targetFile}\`\n**Baseline mean.** $${baseline} Total Assets\n**Command.** \`npm run run:demo\` on \`${ref}\``,
  });

  // --- experiment: testing (call the sandbox runner) ---
  await ctx.emit(spec.emitter, 'artifact', {
    kind: 'experiment',
    refId: experimentId,
    title: `Experiment: ${args.pitch.title}`,
    body: `**Status.** testing\nDispatching benchmark run to the cloud sandbox…`,
  });

  const command = 'npm run run:demo';
  const callId = `sandbox_${spec.agentId}`;
  await ctx.emit(spec.emitter, 'tool_call', {
    tool: 'sandbox_run',
    args: { experimentId, repoUrl: args.repoUrl, ref, command },
    callId,
  });

  const sandbox = await callSandbox(args.sandboxRunnerUrl, {
    engagementId: args.engagementId,
    agentId: spec.agentId,
    experimentId,
    repoUrl: args.repoUrl,
    ref,
    command,
  });

  await ctx.emit(spec.emitter, 'tool_result', {
    tool: 'sandbox_run',
    callId,
    ok: sandbox.ok,
    ...(sandbox.ok
      ? { result: { metric: sandbox.metric, logsTail: (sandbox.logsTail ?? '').slice(-500) } }
      : { error: sandbox.error ?? 'sandbox run failed' }),
  });

  let verdict: LabResult['verdict'] = 'pending';
  let ran = false;
  let metric: number | undefined;

  if (sandbox.ok && typeof sandbox.metric === 'number') {
    ran = true;
    metric = sandbox.metric;
    const beat = metric > baseline;
    verdict = beat ? 'validated' : 'rejected';

    // Metric event with a baseline-vs-candidate comparison series.
    await ctx.emit(spec.emitter, 'metric', {
      name: 'total_assets',
      value: metric,
      unit: 'usd',
      series: [
        { x: 0, y: baseline },
        { x: 1, y: metric },
      ],
      seriesLabel: 'baseline→candidate',
    });

    await ctx.emit(spec.emitter, 'artifact', {
      kind: 'experiment',
      refId: experimentId,
      title: `Experiment: ${args.pitch.title}`,
      body: `**Status.** ${verdict}\n**Candidate.** $${metric} vs baseline $${baseline} (${beat ? 'WIN' : 'no improvement'})\n**Paper.** ${args.pitch.paper} (arXiv:${args.pitch.arxiv})`,
      url: `https://arxiv.org/abs/${args.pitch.arxiv}`,
    });
  } else {
    await ctx.emit(spec.emitter, 'error', {
      message: `sandbox-runner unavailable (${sandbox.error ?? 'unknown'}); experiment left in testing/pending`,
      recoverable: true,
    });
    await ctx.emit(spec.emitter, 'artifact', {
      kind: 'experiment',
      refId: experimentId,
      title: `Experiment: ${args.pitch.title}`,
      body: `**Status.** pending\nSandbox run could not be completed (${sandbox.error ?? 'runner offline'}). Ready to retry once the runner is live.`,
    });
  }

  await ctx.handoff(spec.emitter, args.hermesAgentId, 'experiment result', `${args.pitch.title}: ${verdict}${metric != null ? ` ($${metric})` : ''}.`);
  await ctx.status(spec.emitter, 'done');

  // --- Hermes reviews the result (terra) + status chain ---
  await ctx.status(args.hermesEmitter, 'running', 'reviewing lab result');
  const review = await think(ctx, args.hermesEmitter, args.model, {
    modelId: ctx.models.terra,
    effort: 'high',
    title: 'review',
    maxTokens: 400,
    system: 'You are Hermes, president of Watson, reviewing a lab experiment result for the client. Be concise (2-3 sentences): state the verdict, the numbers if any, and the next action (open PR on a win / retry if the runner was offline).',
    user: `Pitch: ${args.pitch.title} (${args.pitch.paper}, arXiv:${args.pitch.arxiv}).\nVerdict: ${verdict}. Candidate metric: ${metric != null ? `$${metric}` : 'n/a'}. Baseline: $${baseline}. Ran: ${ran}.`,
    fallback:
      verdict === 'validated'
        ? `Result: candidate beat baseline ($${metric} vs $${baseline}). Approving a PR on ${args.pitch.targetFile}.`
        : ran
          ? `Result: candidate did not beat baseline; hold the PR and iterate on the next pitch.`
          : `The sandbox runner was offline, so the experiment is pending — we will retry the run once it is live.`,
  });

  await ctx.handoff(args.hermesEmitter, spec.agentId, 'review complete', review.text.slice(0, 200));
  await ctx.status(args.hermesEmitter, 'waiting', 'lab reviewed');

  return { specialistId: spec.agentId, experimentId, ran, metric, verdict };
}
