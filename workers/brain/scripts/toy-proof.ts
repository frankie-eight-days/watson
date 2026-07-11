/**
 * toy-proof.ts — offline end-to-end PIPE proof (no Cloudflare, no network).
 *
 * Runs the toy workflow under a mock-mode BrainContext, writing a JSONL event
 * stream, then validates it against the contract: a spawn tree rooted at Hermes
 * (parentAgentId null ONLY for Hermes), gapless monotonic seq from 0, monotonic
 * ts, correlated tool_call/tool_result pairs, a metric with a series, an
 * artifact, handoffs, and full coverage of all ten event types.
 *
 *   npm run proof      # from workers/brain
 */

import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WatsonEvent } from '@watson/shared';
import { BrainContext } from '../src/lib/context';
import { runToyWorkflow } from '../src/workflows/toy';

const ALL_TYPES = [
  'spawn',
  'thought',
  'tool_call',
  'tool_result',
  'handoff',
  'status',
  'artifact',
  'metric',
  'steering',
  'error',
] as const;

async function main(): Promise<void> {
  const filePath = join(tmpdir(), `watson-toy-proof-${Date.now()}.jsonl`);
  const engagementId = 'eng_toy_proof';

  const ctx = new BrainContext({
    engagementId,
    convexUrl: 'http://unused-in-mock',
    emitMode: 'mock',
    mockFilePath: filePath,
    models: { terra: 'gpt-5.6-terra', luna: 'gpt-5.6-luna' },
  });

  // Hermes is the root — spawn it first (parentAgentId null only here).
  const hermes = await ctx.spawn({
    parentAgentId: null,
    role: 'president',
    tier: 'hermes',
    model: 'gpt-5.6-terra',
    label: 'Hermes',
  });
  await ctx.status(hermes.emitter, 'running', 'engagement opened');
  await ctx.emit(hermes.emitter, 'thought', {
    text: 'Scope confirmed. Dispatching the toy ingestion team.',
    title: 'commence',
  });

  await runToyWorkflow(ctx, { parentAgentId: hermes.agentId, parentEmitter: hermes.emitter });

  await ctx.status(hermes.emitter, 'done', 'engagement complete');
  await ctx.close();

  // ---- validate ----
  const events = readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as WatsonEvent);

  const errors: string[] = [];
  const check = (cond: boolean, msg: string) => {
    if (!cond) errors.push(msg);
  };

  // seq gapless from 0, monotonic ts, right engagement
  events.forEach((e, i) => {
    check(e.seq === i, `seq gap at index ${i}: got ${e.seq}`);
    check(e.engagementId === engagementId, `wrong engagementId at seq ${e.seq}`);
    if (i > 0) check(e.ts >= events[i - 1].ts, `ts not monotonic at seq ${e.seq}`);
  });

  // spawn tree: parentAgentId null ONLY for hermes; every non-root parent exists
  const spawnedIds = new Set<string>();
  let roots = 0;
  for (const e of events) {
    if (e.type !== 'spawn') continue;
    spawnedIds.add(e.agentId);
    if (e.payload.parentAgentId === null) {
      roots++;
      check(e.agentId === 'hermes', `non-Hermes agent ${e.agentId} has null parent`);
    }
  }
  check(roots === 1, `expected exactly one root (Hermes), got ${roots}`);
  for (const e of events) {
    if (e.type !== 'spawn' || e.payload.parentAgentId === null) continue;
    check(
      spawnedIds.has(e.payload.parentAgentId),
      `spawn ${e.agentId} references unknown parent ${e.payload.parentAgentId}`,
    );
  }
  // every emitting agent must have a spawn
  for (const e of events) {
    check(spawnedIds.has(e.agentId), `agent ${e.agentId} emitted without a spawn (seq ${e.seq})`);
  }

  // tool_call/tool_result correlation by callId
  const calls = new Map<string, boolean>();
  for (const e of events) if (e.type === 'tool_call' && e.payload.callId) calls.set(e.payload.callId, false);
  for (const e of events) if (e.type === 'tool_result' && e.payload.callId) {
    check(calls.has(e.payload.callId), `tool_result for unknown callId ${e.payload.callId}`);
    calls.set(e.payload.callId, true);
  }
  for (const [id, matched] of calls) check(matched, `tool_call ${id} has no matching tool_result`);

  // metric with a series, an artifact, a handoff
  const metricSeries = events.find((e) => e.type === 'metric' && (e.payload.series?.length ?? 0) > 1);
  check(!!metricSeries, 'no metric with a multi-point series');
  check(events.some((e) => e.type === 'artifact'), 'no artifact event');
  check(events.some((e) => e.type === 'handoff'), 'no handoff event');

  // full vocabulary coverage
  const seen = new Set(events.map((e) => e.type));
  for (const t of ALL_TYPES) check(seen.has(t), `missing event type: ${t}`);

  // ---- report ----
  console.log(`\n=== TOY WORKFLOW PROOF ===`);
  console.log(`events: ${events.length}  file: ${filePath}`);
  console.log(`types present: ${[...seen].sort().join(', ')}`);
  console.log(`agents spawned: ${[...spawnedIds].join(', ')}`);
  console.log(`\n--- first 12 events ---`);
  for (const e of events.slice(0, 12)) {
    console.log(JSON.stringify({ seq: e.seq, agentId: e.agentId, type: e.type, payload: e.payload }));
  }

  rmSync(filePath, { force: true });

  if (errors.length) {
    console.error(`\nFAILED (${errors.length}):`);
    for (const err of errors) console.error('  - ' + err);
    process.exit(1);
  }
  console.log(`\nOK — event stream is contract-valid.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
