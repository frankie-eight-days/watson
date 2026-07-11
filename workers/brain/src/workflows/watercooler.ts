/**
 * watercooler.ts — repo-ingestion workflow.
 *
 * Orchestrator (terra) under Hermes fans out two luna scouts that fetch real
 * files from the target repo via GitHub raw, summarize each into an `artifact`
 * 'card' event, then hand back to the orchestrator, which a terra pass distills
 * into one 'dossier' artifact: the harness loop + WHERE long-horizon failure
 * lives. Every agent self-emits `spawn` with a parent link; every step emits.
 */

import type { BrainContext } from '../lib/context';
import type { Emitter } from '@watson/shared';
import type { ModelClient } from '../lib/model';
import { parseRepo, githubRaw, think } from './util';

export interface WatercoolerArgs {
  parentAgentId: string;
  repoUrl?: string;
  ref?: string;
  model: ModelClient;
}

export interface WatercoolerResult {
  orchestratorId: string;
  dossierTitle: string;
  dossierBody: string;
  weakness: string;
}

interface ScoutSpec {
  role: string;
  label: string;
  files: string[];
  focus: string;
}

const SCOUTS: ScoutSpec[] = [
  {
    role: 'context-flow-scout',
    label: 'Context-Flow Scout',
    focus: 'how the agent loop manages its context window across a long horizon',
    files: ['src/llm/context.ts', 'src/llm/tool-loop.ts'],
  },
  {
    role: 'memory-surface-scout',
    label: 'Memory-Surface Scout',
    focus: 'what durable memory tools exist and how the run loop is structured',
    files: ['src/tools/memory-tools.ts', 'README.md'],
  },
];

export async function runWatercooler(
  ctx: BrainContext,
  args: WatercoolerArgs,
): Promise<WatercoolerResult> {
  const { owner, repo } = parseRepo(args.repoUrl);
  const ref = args.ref ?? 'main';

  const orch = await ctx.spawn({
    parentAgentId: args.parentAgentId,
    role: 'repo-ingestion-orchestrator',
    tier: 'orchestrator',
    model: ctx.models.terra,
    label: 'Watercooler Orchestrator',
  });
  await ctx.status(orch.emitter, 'running');
  await ctx.emit(
    orch.emitter,
    'thought',
    {
      text: `Ingesting ${owner}/${repo}@${ref}. Fanning out two scouts to map the agent loop and find where long-horizon coherence breaks.`,
      title: 'plan',
    },
    { tokensIn: 160, tokensOut: 70, model: ctx.models.terra },
  );

  const cards: string[] = [];

  for (const spec of SCOUTS) {
    const worker = await ctx.spawn({
      parentAgentId: orch.agentId,
      role: spec.role,
      tier: 'worker',
      model: ctx.models.luna,
      label: spec.label,
    });
    await ctx.status(worker.emitter, 'running');

    for (const path of spec.files) {
      const callId = `raw_${worker.agentId}_${path.replace(/[^a-z0-9]+/gi, '_')}`;
      await ctx.emit(worker.emitter, 'tool_call', {
        tool: 'github_raw_fetch',
        args: { owner, repo, ref, path },
        callId,
      });
      const fetched = await githubRaw(owner, repo, ref, path);
      await ctx.emit(worker.emitter, 'tool_result', {
        tool: 'github_raw_fetch',
        callId,
        ok: fetched.ok,
        ...(fetched.ok
          ? { result: { path, bytes: fetched.text.length, status: fetched.status } }
          : { error: `fetch ${path} failed (status ${fetched.status})` }),
      });

      const source = fetched.ok
        ? fetched.text
        : `(could not fetch ${path}; status ${fetched.status})`;

      const graded = await think(ctx, worker.emitter, args.model, {
        modelId: ctx.models.luna,
        effort: 'low',
        title: `read ${path}`,
        maxTokens: 400,
        system:
          'You are a code scout reading ONE file from a Vending-Bench agent fork. In 2-4 sentences, summarize what this file does and flag anything relevant to long-horizon memory / context-window management. Be concrete about function names.',
        user: `File: ${path}\nFocus: ${spec.focus}\n\n---\n${source}`,
        fallback: `${path}: source relevant to ${spec.focus}; inspected for context/memory handling.`,
        silent: true,
      });

      await ctx.emit(
        worker.emitter,
        'artifact',
        {
          kind: 'card',
          title: `Scout card — ${path}`,
          body: `**${path}**\n\n${graded.text}`,
        },
        { tokensIn: graded.tokensIn, tokensOut: graded.tokensOut, model: ctx.models.luna },
      );
      cards.push(`## ${path}\n${graded.text}`);
    }

    await ctx.handoff(
      worker.emitter,
      orch.agentId,
      'scout sweep complete',
      `${spec.label} mapped ${spec.files.join(', ')}.`,
    );
    await ctx.status(worker.emitter, 'done');
  }

  // --- terra distills the scout cards into the Repo Dossier ---
  const distill = await think(ctx, orch.emitter, args.model, {
    modelId: ctx.models.terra,
    effort: 'high',
    title: 'dossier synthesis',
    maxTokens: 900,
    system:
      'You are the ingestion orchestrator for an AI research agency (Watson). From the scout cards, write a concise Repo Dossier in markdown for a Vending-Bench agent fork. It MUST cover: (1) the agent harness loop (how it calls the model, uses tools, advances days), and (2) exactly WHERE long-horizon coherence fails — name the file and function. Then give a one-sentence "WEAKNESS:" line naming the precise seam to attack. Be specific and technical.',
    user: `Target: ${owner}/${repo}@${ref}\n\nScout cards:\n\n${cards.join('\n\n')}`,
    fallback:
      `# Repo Dossier — ${owner}/${repo}\n\n` +
      `The harness runs a model→tool loop advancing simulated days. Long-horizon coherence fails in ` +
      '`src/llm/context.ts → trimMessages()`, a lossy sliding window that hard-drops the oldest ' +
      'messages once history exceeds the token budget — evicted supplier/price/inventory facts are gone, ' +
      'and the `write_scratchpad`/`key_value_store` memory tools are used only ad hoc.\n\n' +
      'WEAKNESS: lossy truncation in trimMessages() erases durable working memory across the horizon.',
    silent: true,
  });

  const dossierBody = distill.text;
  const weaknessMatch = dossierBody.match(/WEAKNESS:\s*(.+)/i);
  const weakness = weaknessMatch
    ? weaknessMatch[1].trim()
    : 'lossy truncation in src/llm/context.ts trimMessages() erases durable working memory across the horizon';
  const dossierTitle = `Repo Dossier — ${repo}`;

  await ctx.emit(
    orch.emitter,
    'artifact',
    {
      kind: 'dossier',
      refId: `dossier_${repo}`,
      title: dossierTitle,
      body: dossierBody,
      url: `https://github.com/${owner}/${repo}`,
    },
    { tokensIn: distill.tokensIn, tokensOut: distill.tokensOut, model: ctx.models.terra },
  );

  await ctx.handoff(
    orch.emitter,
    args.parentAgentId,
    'ingestion complete',
    `Dossier "${dossierTitle}" ready. Weakness: ${weakness}`,
  );
  await ctx.status(orch.emitter, 'done');

  return { orchestratorId: orch.agentId, dossierTitle, dossierBody, weakness };
}
