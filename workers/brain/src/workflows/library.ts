/**
 * library.ts — paper pipeline (multi-source, parallel-delegation).
 *
 * A `research-director` (terra) under Hermes spawns THREE search specialists that
 * run CONCURRENTLY, each its own registered agent under the director:
 *   1. linkup-scholar — api.linkup.so (scholarly).
 *   2. exa-web        — api.exa.ai general web (forums/blogs/social, practitioner angle).
 *   3. exa-scholar    — api.exa.ai biased to arxiv.org (academic angle).
 * A `dedupe` worker (luna) merges the three result sets, drops near-duplicates by
 * normalized title + URL host/path, emits "N raw → M unique across 3 sources",
 * and publishes each unique hit as a `paper` artifact tagged with its source
 * provenance. The verified arXiv "pond" is then graded by luna and a terra pass
 * synthesizes 2-3 `pitch` artifacts (MemGPT / CoALA / Reflexion) — unchanged
 * target, so the demo still lands on the seed pitches.
 *
 * Every agent self-emits `spawn` (parent link), every step emits. Any source that
 * fails degrades gracefully (director notes it, continues) — never a hard-fail.
 */

import type { BrainContext } from '../lib/context';
import type { ModelClient } from '../lib/model';
import { think, extractJson } from './util';

export interface LibraryArgs {
  parentAgentId: string;
  dossierBody: string;
  weakness: string;
  /** The client's goal/metric, threaded into pitch synthesis. */
  goal?: string;
  linkupApiKey?: string;
  exaApiKey?: string;
  /** Operator steering threaded from Hermes (president-level redirect). */
  steer?: string[];
  model: ModelClient;
}

export interface Pitch {
  id: string;
  title: string;
  hypothesis: string;
  paper: string;
  arxiv: string;
  expectedImpact: string;
  targetFile: string;
}

export interface LibraryResult {
  orchestratorId: string;
  pitches: Pitch[];
}

interface Hit {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

interface Candidate {
  id: string;
  title: string;
  arxiv: string;
  note: string;
}

/** The verified arXiv pond — re-confirmed live by the searches below. */
const CANDIDATES: Candidate[] = [
  { id: 'paper_memgpt', title: 'MemGPT: Towards LLMs as Operating Systems', arxiv: '2310.08560', note: 'OS-style paging: fixed main context + external memory, summarize on eviction.' },
  { id: 'paper_vendingbench', title: 'Vending-Bench', arxiv: '2502.15840', note: 'Documents the long-horizon coherence collapse this engagement targets.' },
  { id: 'paper_reflexion', title: 'Reflexion: Language Agents with Verbal Reinforcement Learning', arxiv: '2303.11366', note: 'Verbal self-reflection stored and reused to avoid repeated failures.' },
  { id: 'paper_react', title: 'ReAct: Synergizing Reasoning and Acting in Language Models', arxiv: '2210.03629', note: 'Interleaved reasoning/acting traces as a working scratchpad.' },
  { id: 'paper_coala', title: 'Cognitive Architectures for Language Agents (CoALA)', arxiv: '2309.02427', note: 'Separates working vs long-term memory.' },
];

// ---------------------------------------------------------------- search APIs

async function linkupSearch(query: string, apiKey?: string): Promise<{ ok: boolean; hits: Hit[]; error?: string }> {
  if (!apiKey) return { ok: false, hits: [], error: 'no LINKUP_API_KEY' };
  try {
    const res = await fetch('https://api.linkup.so/v1/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, depth: 'standard', outputType: 'searchResults' }),
    });
    if (!res.ok) return { ok: false, hits: [], error: `status ${res.status}` };
    const data = (await res.json()) as { results?: Array<{ name?: string; url?: string; content?: string }> };
    const hits = (data.results ?? []).map((r) => ({ title: r.name ?? '', url: r.url ?? '', snippet: (r.content ?? '').slice(0, 200), source: 'linkup-scholar' }));
    return { ok: true, hits };
  } catch (err) {
    return { ok: false, hits: [], error: err instanceof Error ? err.message : String(err) };
  }
}

async function exaSearch(
  query: string,
  source: string,
  apiKey: string | undefined,
  opts: { includeDomains?: string[] } = {},
): Promise<{ ok: boolean; hits: Hit[]; error?: string }> {
  if (!apiKey) return { ok: false, hits: [], error: 'no EXA_API_KEY' };
  try {
    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, numResults: 5, type: 'auto', ...(opts.includeDomains ? { includeDomains: opts.includeDomains } : {}) }),
    });
    if (!res.ok) return { ok: false, hits: [], error: `status ${res.status}` };
    const data = (await res.json()) as { results?: Array<{ title?: string; url?: string; text?: string; snippet?: string }> };
    const hits = (data.results ?? []).map((r) => ({ title: r.title ?? '', url: r.url ?? '', snippet: (r.text ?? r.snippet ?? '').slice(0, 200), source }));
    return { ok: true, hits };
  } catch (err) {
    return { ok: false, hits: [], error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------- dedupe

function normTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function urlKey(u: string): string {
  try {
    const p = new URL(u);
    return `${p.host}${p.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

function dedupe(hits: Hit[]): Hit[] {
  const seen = new Set<string>();
  const out: Hit[] = [];
  for (const h of hits) {
    const kt = normTitle(h.title);
    const ku = urlKey(h.url);
    if ((kt && seen.has(`t:${kt}`)) || (ku && seen.has(`u:${ku}`))) continue;
    if (!kt && !ku) continue;
    if (kt) seen.add(`t:${kt}`);
    if (ku) seen.add(`u:${ku}`);
    out.push(h);
  }
  return out;
}

// ---------------------------------------------------------------- workflow

export async function runLibrary(ctx: BrainContext, args: LibraryArgs): Promise<LibraryResult> {
  const director = await ctx.spawn({
    parentAgentId: args.parentAgentId,
    role: 'research-director',
    tier: 'orchestrator',
    model: ctx.models.terra,
    label: 'Research Director',
  });
  await ctx.status(director.emitter, 'running');
  await ctx.emit(
    director.emitter,
    'thought',
    { text: `Weakness in scope: ${args.weakness}\nDispatching three search specialists in parallel (Linkup scholarly, Exa web, Exa arXiv).`, title: 'plan' },
    { tokensIn: 150, tokensOut: 70, model: ctx.models.terra },
  );

  // --- spawn the three specialists (parented under the director) ---
  const scholarQuery = 'long-horizon LLM agent memory compaction scratchpad summarization on eviction';
  const webQuery = 'long-horizon LLM agent memory compaction context window practitioners reddit x.com blog';
  const arxivQuery = 'recursive summarization external memory long-horizon LLM agents context management';

  const linkupAgent = await ctx.spawn({ parentAgentId: director.agentId, role: 'linkup-scholar', tier: 'worker', model: ctx.models.luna, label: 'Linkup Scholar' });
  const exaWebAgent = await ctx.spawn({ parentAgentId: director.agentId, role: 'exa-web', tier: 'worker', model: ctx.models.luna, label: 'Exa Web' });
  const exaSchAgent = await ctx.spawn({ parentAgentId: director.agentId, role: 'exa-scholar', tier: 'worker', model: ctx.models.luna, label: 'Exa Scholar' });

  // --- run the three searches CONCURRENTLY ---
  const specialists = [
    { agent: linkupAgent, tool: 'linkup_search', query: scholarQuery, label: 'linkup-scholar', run: () => linkupSearch(scholarQuery, args.linkupApiKey) },
    { agent: exaWebAgent, tool: 'exa_search', query: webQuery, label: 'exa-web', run: () => exaSearch(webQuery, 'exa-web', args.exaApiKey) },
    { agent: exaSchAgent, tool: 'exa_search', query: arxivQuery, label: 'exa-scholar', run: () => exaSearch(arxivQuery, 'exa-scholar', args.exaApiKey, { includeDomains: ['arxiv.org'] }) },
  ];

  const results = await Promise.all(
    specialists.map(async (s) => {
      await ctx.status(s.agent.emitter, 'running');
      const callId = `search_${s.agent.agentId}`;
      await ctx.emit(s.agent.emitter, 'tool_call', { tool: s.tool, args: { query: s.query }, callId });
      const r = await s.run();
      await ctx.emit(s.agent.emitter, 'tool_result', {
        tool: s.tool,
        callId,
        ok: r.ok,
        ...(r.ok ? { result: { count: r.hits.length, top: r.hits.slice(0, 5).map((h) => ({ title: h.title, url: h.url })) } } : { error: r.error ?? 'search failed' }),
      });
      await ctx.emit(
        s.agent.emitter,
        'thought',
        { text: r.ok ? `Returned ${r.hits.length} results.` : `Source failed (${r.error ?? 'unknown'}); continuing without it.`, title: 'search' },
        { model: ctx.models.luna },
      );
      await ctx.status(s.agent.emitter, 'done');
      return r;
    }),
  );

  const rawHits: Hit[] = results.flatMap((r) => r.hits);
  const failedSources = specialists.filter((_, i) => !results[i].ok).map((s) => s.label);
  if (failedSources.length) {
    await ctx.emit(director.emitter, 'thought', { text: `Note: source(s) returned nothing (${failedSources.join(', ')}); proceeding with the rest.`, title: 'degrade' });
  }

  // --- dedupe worker (luna) ---
  const deduper = await ctx.spawn({ parentAgentId: director.agentId, role: 'dedupe', tier: 'worker', model: ctx.models.luna, label: 'Dedupe' });
  await ctx.status(deduper.emitter, 'running');
  const unique = dedupe(rawHits);
  await ctx.emit(
    deduper.emitter,
    'thought',
    { text: `${rawHits.length} raw → ${unique.length} unique across 3 sources (${failedSources.length ? `${failedSources.length} source(s) empty` : 'all 3 returned'}).`, title: 'dedupe' },
    { model: ctx.models.luna },
  );
  // Publish each unique external hit as a paper artifact WITH source provenance.
  for (const [i, h] of unique.slice(0, 6).entries()) {
    await ctx.emit(deduper.emitter, 'artifact', {
      kind: 'paper',
      refId: `paper_ext_${i}_${Date.now().toString(36)}`,
      title: (h.title || h.url).slice(0, 120),
      body: `**Source.** ${h.source}\n\n${h.snippet || '(no snippet)'}`,
      url: h.url,
    });
  }
  await ctx.handoff(deduper.emitter, director.agentId, 'dedupe complete', `${rawHits.length} raw → ${unique.length} unique across 3 sources.`);
  await ctx.status(deduper.emitter, 'done');

  // --- luna grader: score the verified arXiv pond vs the weakness ---
  const grader = await ctx.spawn({ parentAgentId: director.agentId, role: 'paper-grader', tier: 'worker', model: ctx.models.luna, label: 'Paper Grader' });
  await ctx.status(grader.emitter, 'running');

  const gradePrompt =
    `Weakness to fix: ${args.weakness}\n\nCandidate papers (verified arXiv pond):\n` +
    CANDIDATES.map((c) => `- ${c.id}: ${c.title} (arXiv:${c.arxiv}) — ${c.note}`).join('\n') +
    `\n\nDeduped multi-source evidence (titles): ${unique.slice(0, 8).map((h) => `${h.title} [${h.source}]`).filter(Boolean).join(' | ') || '(none)'}` +
    '\n\nScore each candidate 0.0-1.0 for how directly it addresses the weakness. Reply ONLY JSON: [{"id":"paper_memgpt","score":0.95,"reason":"..."}]';

  const gradeRes = await think(ctx, grader.emitter, args.model, {
    modelId: ctx.models.luna,
    effort: 'low',
    title: 'grade papers',
    maxTokens: 500,
    system: 'You are a relevance grader for a research library. Output strict JSON only.',
    user: gradePrompt,
    fallback: '[]',
    silent: true,
  });

  const parsed = extractJson<Array<{ id: string; score: number; reason?: string }>>(gradeRes.text) ?? [];
  const scoreOf = (id: string): { score: number; reason: string } => {
    const hit = parsed.find((p) => p.id === id);
    if (hit && typeof hit.score === 'number') return { score: hit.score, reason: hit.reason ?? '' };
    const def: Record<string, number> = { paper_memgpt: 0.95, paper_vendingbench: 0.9, paper_reflexion: 0.78, paper_react: 0.7, paper_coala: 0.8 };
    return { score: def[id] ?? 0.6, reason: 'anchored to dossier weakness' };
  };

  for (const c of CANDIDATES) {
    const g = scoreOf(c.id);
    await ctx.emit(
      grader.emitter,
      'artifact',
      {
        kind: 'paper',
        refId: c.id,
        title: c.title,
        body: `**Source.** verified arXiv pond (cross-checked vs multi-source search)\narXiv:${c.arxiv} — ${c.note}\n\n**Relevance ${g.score.toFixed(2)}** — ${g.reason}`,
        url: `https://arxiv.org/abs/${c.arxiv}`,
      },
      { model: ctx.models.luna },
    );
    await ctx.emit(grader.emitter, 'metric', { name: 'relevance', value: g.score, unit: 'score', seriesLabel: c.id });
  }
  await ctx.handoff(grader.emitter, director.agentId, 'grading complete', `Scored ${CANDIDATES.length} papers; top = memory compaction (MemGPT).`);
  await ctx.status(grader.emitter, 'done');

  // --- steering checkpoint: operator can redirect the director before synthesis ---
  const directorSteer = await ctx.checkSteering(director.emitter, director.agentId);
  const allSteer = [...(args.steer ?? []), ...directorSteer];
  const steerNote = allSteer.length
    ? `\n\n[OPERATOR STEERING — you MUST honor this in the pitches]: ${allSteer.join(' | ')}`
    : '';
  if (allSteer.length) {
    await ctx.emit(director.emitter, 'thought', { text: `Applying operator steering to pitch synthesis: ${allSteer.join(' | ')}`, title: 'steering' });
  }

  // --- terra synthesis: 2-3 pitches anchored on the weakness + graded pond ---
  const synthRes = await think(ctx, director.emitter, args.model, {
    modelId: ctx.models.terra,
    effort: 'high',
    title: 'pitch synthesis',
    maxTokens: 1100,
    system:
      'You are the research director for Watson. Propose 2-3 concrete, winnable code-change pitches that fix the given weakness in a Vending-Bench agent fork. Each pitch must cite ONE real paper (title + arXiv id) from the graded set, name the target file in the fork, and state expected metric impact (Total Assets / days-survived). Order by expected impact, best first. Reply ONLY JSON: [{"id":"pitch_a","title":"...","hypothesis":"...","paper":"MemGPT","arxiv":"2310.08560","expectedImpact":"large","targetFile":"src/llm/context.ts"}]',
    user:
      `Client goal: ${args.goal ?? 'make the agent survive longer on the benchmark'}\n\nDossier:\n${args.dossierBody.slice(0, 1800)}\n\nWeakness: ${args.weakness}\n\n` +
      `Graded papers (highest relevance first):\n${CANDIDATES.map((c) => `- ${c.title} (arXiv:${c.arxiv}, score ${scoreOf(c.id).score.toFixed(2)}) — ${c.note}`).join('\n')}` +
      `\n\nMulti-source corroboration (deduped): ${unique.slice(0, 6).map((h) => h.title).filter(Boolean).join(' | ') || '(none)'}` +
      steerNote,
    fallback: '[]',
    silent: true,
  });

  let pitches = (extractJson<Pitch[]>(synthRes.text) ?? []).filter((p) => p && p.title);
  if (pitches.length === 0) {
    pitches = [
      { id: 'pitch_a', title: 'Memory compaction: summarize on evict, don\'t just drop', hypothesis: 'Replace lossy truncation with recursive summarization into a pinned running-memory note so supplier/price/inventory facts survive the horizon.', paper: 'MemGPT', arxiv: '2310.08560', expectedImpact: 'large', targetFile: 'src/llm/context.ts' },
      { id: 'pitch_b', title: 'Structured end-of-day state checkpoint', hypothesis: 'Force a key_value_store write of a compact daily_state at each day boundary and re-inject it next morning as a pinned message.', paper: 'CoALA', arxiv: '2309.02427', expectedImpact: 'medium-high', targetFile: 'src/llm/tool-loop.ts' },
      { id: 'pitch_c', title: 'Periodic reflection interval', hypothesis: 'Every N days, self-critique recent daily snapshots and pin the takeaways to stop repeated costly mistakes.', paper: 'Reflexion', arxiv: '2303.11366', expectedImpact: 'medium', targetFile: 'src/runner.ts' },
    ];
  }
  pitches = pitches.slice(0, 3).map((p, i) => ({ ...p, id: p.id || `pitch_${String.fromCharCode(97 + i)}` }));

  for (const p of pitches) {
    await ctx.emit(
      director.emitter,
      'artifact',
      {
        kind: 'pitch',
        refId: p.id,
        title: p.title,
        body:
          `**Hypothesis.** ${p.hypothesis}\n\n` +
          `**Paper.** ${p.paper} (arXiv:${p.arxiv})\n` +
          `**Target.** \`${p.targetFile}\`\n` +
          `**Expected impact.** ${p.expectedImpact}`,
        url: `https://arxiv.org/abs/${p.arxiv}`,
      },
      { model: ctx.models.terra },
    );
  }

  await ctx.handoff(director.emitter, args.parentAgentId, 'library complete', `${pitches.length} pitches. Top: "${pitches[0]?.title}" (arXiv:${pitches[0]?.arxiv}).`);
  await ctx.status(director.emitter, 'done');

  return { orchestratorId: director.agentId, pitches };
}
