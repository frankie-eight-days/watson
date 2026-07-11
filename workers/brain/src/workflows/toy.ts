/**
 * toy.ts — end-to-end PIPE PROOF workflow.
 *
 * This is not real research. Its single job is to push EVERY event type through
 * the emit pipe with a well-formed spawn tree, so Tab A / the UI / replay can be
 * validated before the real workflows (watercooler → library → lab) exist. Real
 * workflows slot into the same shape: spawn an orchestrator under Hermes, fan
 * out workers, emit artifacts/metrics, hand results back to Hermes.
 *
 * Tool logic here is canned (no repo, no model needed) — the point is the event
 * stream, not the content. It exercises all ten types:
 *   spawn · thought · tool_call · tool_result · handoff · status · artifact ·
 *   metric · steering · error
 */

import type { BrainContext } from '../lib/context';

export interface ToyWorkflowArgs {
  /** The agent handing off INTO this workflow (Hermes for the top-level call). */
  parentAgentId: string;
  /** Emitter of the parent, so we can hand results back to it. */
  parentEmitter?: import('@watson/shared').Emitter;
}

export interface ToyWorkflowResult {
  orchestratorId: string;
  dossierTitle: string;
  headlineMetric: { name: string; value: number; unit: string };
}

/**
 * Spawn a toy orchestrator under `parentAgentId`, fan out two luna workers, run
 * canned tool calls, publish a metric series + an artifact, then hand back to
 * the parent. Returns a small result the caller (Hermes) can report.
 */
export async function runToyWorkflow(
  ctx: BrainContext,
  args: ToyWorkflowArgs,
): Promise<ToyWorkflowResult> {
  // --- orchestrator (terra) under Hermes ---
  const orch = ctx.spawn({
    parentAgentId: args.parentAgentId,
    role: 'toy-ingestion-orchestrator',
    tier: 'orchestrator',
    model: ctx.models.terra,
    label: 'Toy Orchestrator',
  });
  ctx.status(orch.emitter, 'running');
  orch.emitter.emit(
    'thought',
    { text: 'Kicking off the toy ingestion sweep; fanning out two scouts.', title: 'plan' },
    { tokensIn: 180, tokensOut: 60, model: ctx.models.terra },
  );

  // --- two luna workers, each doing a canned tool call/result ---
  const findings: string[] = [];
  const workerSpecs = [
    { role: 'toy-repo-scout', target: 'README.md', found: 'agentic loop entrypoint' },
    { role: 'toy-metric-scout', target: 'bench/run.py', found: 'time-horizon metric hook' },
  ];

  for (const [i, spec] of workerSpecs.entries()) {
    const worker = ctx.spawn({
      parentAgentId: orch.agentId,
      role: spec.role,
      tier: 'worker',
      model: ctx.models.luna,
      label: `Scout ${i + 1}`,
    });
    ctx.status(worker.emitter, 'running');
    worker.emitter.emit(
      'thought',
      { text: `Scanning ${spec.target} for the ${spec.found}.` },
      { tokensIn: 90, tokensOut: 30, model: ctx.models.luna },
    );

    const callId = `toolcall_${worker.agentId}_read`;
    worker.emitter.emit('tool_call', {
      tool: 'read_file',
      args: { path: spec.target },
      callId,
    });

    // First scout demonstrates a recoverable error before succeeding.
    if (i === 0) {
      worker.emitter.emit('error', {
        message: `transient: ${spec.target} not found on first attempt, retrying`,
        recoverable: true,
      });
    }

    worker.emitter.emit('tool_result', {
      tool: 'read_file',
      callId,
      ok: true,
      result: { path: spec.target, summary: `Located the ${spec.found}.` },
    });

    findings.push(spec.found);
    ctx.status(worker.emitter, 'done');
    await worker.emitter.flush();
  }

  // --- demonstrate the steering seam flowing through the pipe ---
  orch.emitter.emit('steering', {
    text: 'Operator: prioritize the time-horizon metric in the dossier.',
    from: 'frank',
  });

  orch.emitter.emit(
    'thought',
    { text: `Scouts returned: ${findings.join('; ')}. Compiling the dossier.`, title: 'synthesis' },
    { tokensIn: 240, tokensOut: 110, model: ctx.models.terra },
  );

  // --- metric with a series (powers the Lab-style chart) ---
  const series = [
    { x: 0, y: 23.0 },
    { x: 1, y: 27.5 },
    { x: 2, y: 33.2 },
    { x: 3, y: 41.0 },
  ];
  orch.emitter.emit('metric', {
    name: 'time_horizon',
    value: 41.0,
    unit: 'days',
    series,
    seriesLabel: 'candidate',
  });

  // --- durable artifact (dossier card) ---
  const dossierTitle = 'Toy Repo Dossier';
  orch.emitter.emit('artifact', {
    kind: 'dossier',
    title: dossierTitle,
    body:
      `# ${dossierTitle}\n\n` +
      `- Entry point: agentic loop in \`README.md\`\n` +
      `- Metric hook: time-horizon in \`bench/run.py\`\n` +
      `- Headline metric (toy): 41.0 days\n`,
  });

  // --- hand results back to the parent (Hermes) and finish ---
  ctx.handoff(
    orch.emitter,
    args.parentAgentId,
    'toy workflow complete',
    `Dossier ready ("${dossierTitle}"); toy time-horizon 41.0 days across ${series.length} points.`,
  );
  ctx.status(orch.emitter, 'done');
  await orch.emitter.flush();

  return {
    orchestratorId: orch.agentId,
    dossierTitle,
    headlineMetric: { name: 'time_horizon', value: 41.0, unit: 'days' },
  };
}
