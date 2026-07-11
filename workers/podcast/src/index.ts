/**
 * watson-podcast — Cloudflare Worker.
 * ===================================
 * POST /generate {engagementId}  → generates a 2-3 min two-host podcast MP3
 *   recapping a completed research engagement, stores it in Convex file
 *   storage, and emits a discovery `artifact` event. Returns the servable URL.
 * GET  /health                   → {ok:true}
 */

import OpenAI from 'openai';

export interface Env {
  CONVEX_URL: string;
  CONVEX_SITE_URL: string;
  MODEL_TERRA: string;
  VOICE_HOST: string;
  VOICE_WATSON: string;
  OPENAI_API_KEY: string;
  ELEVENLABS_API_KEY: string;
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// ---------------------------------------------------------------------------
// Convex HTTP helpers (plain fetch, no SDK)
// ---------------------------------------------------------------------------
async function convexQuery<T = any>(env: Env, path: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${env.CONVEX_URL}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, args, format: 'json' }),
  });
  const data: any = await res.json();
  if (data.status !== 'success') {
    throw new Error(`convex query ${path} failed: ${data.errorMessage ?? JSON.stringify(data)}`);
  }
  return data.value as T;
}

async function convexMutation<T = any>(env: Env, path: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${env.CONVEX_URL}/api/mutation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, args, format: 'json' }),
  });
  const data: any = await res.json();
  if (data.status !== 'success') {
    throw new Error(`convex mutation ${path} failed: ${data.errorMessage ?? JSON.stringify(data)}`);
  }
  return data.value as T;
}

// A query that may legitimately be missing/erroring — return fallback.
async function safeQuery<T>(env: Env, path: string, args: Record<string, unknown>, fallback: T): Promise<T> {
  try {
    return await convexQuery<T>(env, path, args);
  } catch (e) {
    console.log(`safeQuery ${path} fell back: ${(e as Error).message}`);
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Story assembly → compact facts
// ---------------------------------------------------------------------------
interface Facts {
  engagementId: string;
  repo: string;
  title?: string;
  metricName?: string;
  metricUnit?: string;
  before?: number;
  after?: number;
  delta?: number;
  papers: string[];
  winningPitch?: string;
  expectedImpact?: string;
  experimentVerdict?: string;
  secondaryMetrics: { name: string; value: number; unit?: string }[];
  prNumber?: number;
  prUrl?: string;
  totalCost?: number;
  dossierTitles: string[];
  reportTitles: string[];
}

async function buildFacts(env: Env, engagementId: string): Promise<Facts> {
  const [engagement, papers, pitches, experiments, prs, cost, maxSeq] = await Promise.all([
    safeQuery<any>(env, 'engagements:getEngagement', { engagementId }, null),
    safeQuery<any[]>(env, 'domain:papersByEngagement', { engagementId }, []),
    safeQuery<any[]>(env, 'domain:pitchesByEngagement', { engagementId }, []),
    safeQuery<any[]>(env, 'domain:experimentsByEngagement', { engagementId }, []),
    safeQuery<any[]>(env, 'domain:prsByEngagement', { engagementId }, []),
    safeQuery<any>(env, 'observability:engagementCostRollup', { engagementId }, null),
    safeQuery<number>(env, 'events:maxSeq', { engagementId }, -1),
  ]);

  const events = maxSeq >= 0
    ? await safeQuery<any[]>(env, 'events:eventsWindow', { engagementId, startSeq: 0, endSeq: maxSeq }, [])
    : [];

  // Primary + secondary metrics from the event stream.
  const metricGroups = new Map<string, any[]>();
  for (const ev of events) {
    if (ev.type === 'metric' && ev.payload?.name) {
      const arr = metricGroups.get(ev.payload.name) ?? [];
      arr.push(ev.payload);
      metricGroups.set(ev.payload.name, arr);
    }
  }

  let metricName: string | undefined;
  let metricUnit: string | undefined;
  let before: number | undefined;
  let after: number | undefined;
  const secondaryMetrics: Facts['secondaryMetrics'] = [];

  for (const [name, payloads] of metricGroups) {
    const hasBaseline = payloads.some((p) => p.seriesLabel === 'baseline');
    const hasCandidate = payloads.some((p) => p.seriesLabel === 'candidate');
    if (hasBaseline && hasCandidate && metricName === undefined) {
      metricName = name;
      metricUnit = payloads[0]?.unit;
      const baselineVals = payloads.filter((p) => p.seriesLabel === 'baseline').map((p) => p.value as number);
      const candidateVals = payloads.filter((p) => p.seriesLabel === 'candidate').map((p) => p.value as number);
      before = baselineVals[0];
      after = Math.max(...candidateVals);
    } else {
      // secondary: take the last observed value for that metric name
      const last = payloads[payloads.length - 1];
      if (last && typeof last.value === 'number') {
        secondaryMetrics.push({ name, value: last.value, unit: last.unit });
      }
    }
  }

  // Artifact titles by kind from events.
  const dossierTitles: string[] = [];
  const reportTitles: string[] = [];
  const paperTitles: string[] = [];
  let experimentVerdictFromEvents: string | undefined;
  for (const ev of events) {
    if (ev.type === 'artifact' && ev.payload) {
      const t = ev.payload.title as string | undefined;
      const kind = ev.payload.kind;
      if (kind === 'dossier' && t) dossierTitles.push(t);
      if (kind === 'report' && t && t !== 'podcast') reportTitles.push(t);
      // Real paper names live in kind==='paper' artifacts; skip placeholder
      // "Distillation: ..." / "Screened: ..." variants.
      if (kind === 'paper' && t && !/^(Distillation|Screened):/i.test(t) && !paperTitles.includes(t)) {
        paperTitles.push(t);
      }
      // Verdict lives in an experiment artifact whose title carries VALIDATED/REJECTED.
      if (kind === 'experiment' && t) {
        const m = t.match(/\b(VALIDATED|REJECTED|INCONCLUSIVE)\b/i);
        if (m) experimentVerdictFromEvents = m[1].toLowerCase();
      }
    }
  }

  // Winning pitch: prefer a validated/accepted one, else the first.
  const pitchList = pitches ?? [];
  const winning =
    pitchList.find((p) => /valid|accept|win|selected/i.test(String(p.status ?? ''))) ?? pitchList[0];

  // Experiment verdict: prefer the event-stream verdict, fall back to domain.
  const expList = experiments ?? [];
  const validated = expList.find((e) => /valid/i.test(String(e.status ?? '')));
  const experimentVerdict = experimentVerdictFromEvents ?? validated?.status ?? expList[0]?.status;

  // PR: prefer merged/open with a number.
  const prList = prs ?? [];
  const pr = prList.find((p) => typeof p.number === 'number') ?? prList[0];

  // Repo: domain rows are thin (repoUrl often empty); derive a name from the
  // PR url or the dossier title when needed.
  let repo = engagement?.repoUrl ?? '';
  if (!repo && pr?.url) {
    const m = String(pr.url).match(/github\.com\/([^/]+\/[^/]+?)(?:\/|$)/i);
    if (m) repo = m[1];
  }
  if (!repo && dossierTitles[0]) {
    const parts = dossierTitles[0].split(/[—-]/);
    repo = (parts[parts.length - 1] ?? '').trim();
  }
  if (!repo) repo = 'the target repository';

  // Prefer real paper artifact titles from events; fall back to domain rows.
  const domainPapers = (papers ?? []).map((p) => p.title).filter(Boolean);
  const finalPapers = (paperTitles.length > 0 ? paperTitles : domainPapers).slice(0, 5);

  return {
    engagementId,
    repo,
    title: engagement?.title,
    metricName,
    metricUnit,
    before,
    after,
    delta: before !== undefined && after !== undefined ? after - before : undefined,
    papers: finalPapers,
    winningPitch: winning?.hypothesis,
    expectedImpact: winning?.expectedImpact,
    experimentVerdict,
    secondaryMetrics,
    prNumber: pr?.number,
    prUrl: pr?.url,
    totalCost: cost?.costUsd,
    dossierTitles: dossierTitles.slice(0, 3),
    reportTitles: reportTitles.slice(0, 3),
  };
}

// ---------------------------------------------------------------------------
// Script generation (gpt-5.6-terra)
// ---------------------------------------------------------------------------
interface Line {
  speaker: 'A' | 'B';
  text: string;
}

function fallbackScript(f: Facts): Line[] {
  const repo = shortRepo(f.repo);
  const paper = f.papers[0] ?? 'the latest long-horizon agent research';
  const metric = f.metricName ? f.metricName.replace(/_/g, ' ') : 'the target metric';
  const unit = f.metricUnit ?? '';
  const beforeAfter =
    f.before !== undefined && f.after !== undefined
      ? `from ${f.before} ${unit} to ${f.after} ${unit}`
      : 'in the right direction';
  const pr = f.prNumber ? `PR #${f.prNumber}` : 'a fresh pull request';
  return [
    { speaker: 'A', text: `Welcome back to the Watson Research Recap! I'm your host, and with me is Watson, president of the research agency. Watson, what did the team dig into this time?` },
    { speaker: 'B', text: `A pleasure, as always. This engagement centered on the repository ${repo}. Our target: ${metric}.` },
    { speaker: 'A', text: `Ooh, I love a good target. Where did the ideas come from?` },
    { speaker: 'B', text: `The library team surfaced several papers, chief among them "${paper}." That seeded our winning hypothesis.` },
    { speaker: 'A', text: `And you actually ran the experiment?` },
    { speaker: 'B', text: `We did. The verdict: ${f.experimentVerdict ?? 'validated'}. The candidate moved ${metric} ${beforeAfter}.` },
    { speaker: 'A', text: `That is a real jump! What happened next?` },
    { speaker: 'B', text: `We shipped it. You'll find the change in ${pr}${f.prUrl ? `, at ${f.prUrl}` : ''}.` },
    { speaker: 'A', text: `Incredible work as ever. That's it for this recap, folks. Until next time, keep researching!` },
    { speaker: 'B', text: `Onward and upward. Goodbye for now.` },
  ];
}

function shortRepo(repo: string): string {
  try {
    if (repo.startsWith('http')) {
      const u = new URL(repo);
      return u.pathname.replace(/^\//, '').replace(/\.git$/, '');
    }
  } catch {
    /* noop */
  }
  return repo;
}

function stripFences(s: string): string {
  let t = s.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '');
  }
  return t.trim();
}

async function generateScript(env: Env, f: Facts): Promise<Line[]> {
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  const factsForModel = {
    repo: shortRepo(f.repo),
    targetMetric: f.metricName ? { name: f.metricName.replace(/_/g, ' '), unit: f.metricUnit } : undefined,
    before: f.before,
    after: f.after,
    delta: f.delta,
    topPapers: f.papers.slice(0, 3),
    winningHypothesis: f.winningPitch,
    expectedImpact: f.expectedImpact,
    experimentVerdict: f.experimentVerdict,
    secondaryMetrics: f.secondaryMetrics,
    pr: f.prNumber ? { number: f.prNumber, url: f.prUrl } : undefined,
    totalCostUsd: f.totalCost,
    dossierTitles: f.dossierTitles,
    reportTitles: f.reportTitles,
  };

  const system = [
    'You are the head writer for "The Watson Research Recap", a short, lively two-host podcast that recaps a completed AI-research engagement.',
    'Host A is the show host: upbeat, curious, quick to react, asks the questions a listener would.',
    'Host B is "Watson", the composed, witty president of the research agency. He recaps the work with SPECIFIC real numbers, dry humor, and quiet pride.',
    'Write 350-450 words TOTAL across roughly 12-18 short, punchy, alternating lines (A, B, A, B ...).',
    'Open with a quick show intro and close with a warm sign-off.',
    'You MUST weave in, using the provided facts verbatim where numbers are given: the repository name; that research papers were found (name one or two); the experiment that ran and its verdict; the target metric BEFORE to AFTER with its units; and the pull request (number and/or url).',
    'Keep it fun, fast, and concrete. No stage directions, no markdown, plain spoken sentences only.',
    'Return STRICT JSON and nothing else, exactly this shape: {"lines":[{"speaker":"A"|"B","text":"..."}]}',
  ].join(' ');

  try {
    const resp = await client.chat.completions.create({
      model: env.MODEL_TERRA,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content:
            'Here are the real facts from the engagement (JSON). Write the podcast script now.\n\n' +
            JSON.stringify(factsForModel, null, 2),
        },
      ],
    });

    const raw = resp.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(stripFences(raw));
    const lines = parsed?.lines;
    if (Array.isArray(lines) && lines.length > 0) {
      const clean: Line[] = lines
        .filter((l: any) => l && typeof l.text === 'string' && l.text.trim().length > 0)
        .map((l: any) => ({ speaker: l.speaker === 'B' ? 'B' : 'A', text: String(l.text).trim() }));
      if (clean.length > 0) return clean;
    }
    console.log('script parse produced no usable lines, using fallback');
  } catch (e) {
    console.log(`script generation failed, using fallback: ${(e as Error).message}`);
  }
  return fallbackScript(f);
}

// ---------------------------------------------------------------------------
// TTS via ElevenLabs
// ---------------------------------------------------------------------------
async function ttsLine(env: Env, voiceId: string, text: string): Promise<Uint8Array> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, model_id: 'eleven_turbo_v2_5' }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ElevenLabs TTS ${res.status}: ${body.slice(0, 300)}`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

// Limited-concurrency map preserving order.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let idx = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(runners);
  return results;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Storage + discovery
// ---------------------------------------------------------------------------
async function storeMp3(env: Env, bytes: Uint8Array): Promise<string> {
  const uploadUrl = await convexMutation<string>(env, 'podcast:generateUploadUrl', {});
  const upRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/mpeg' },
    body: bytes,
  });
  if (!upRes.ok) {
    const t = await upRes.text().catch(() => '');
    throw new Error(`storage upload failed ${upRes.status}: ${t.slice(0, 300)}`);
  }
  const { storageId } = (await upRes.json()) as { storageId: string };
  const url = await convexMutation<string>(env, 'podcast:finalizePodcast', { storageId });
  return url;
}

async function emitDiscovery(env: Env, engagementId: string, url: string): Promise<void> {
  const event = {
    engagementId,
    agentId: 'podcast',
    ts: Date.now(),
    type: 'artifact',
    payload: { kind: 'report', title: 'podcast', body: url, url },
  };
  const res = await fetch(`${env.CONVEX_SITE_URL}/emit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events: [event] }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`emit failed ${res.status}: ${t.slice(0, 300)}`);
  }
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------
async function generate(env: Env, engagementId: string): Promise<Response> {
  const facts = await buildFacts(env, engagementId);
  const lines = await generateScript(env, facts);

  const segments = await mapLimit(lines, 3, (line) =>
    ttsLine(env, line.speaker === 'A' ? env.VOICE_HOST : env.VOICE_WATSON, line.text),
  );

  const mp3 = concat(segments);
  const durationSec = Math.round(mp3.length / 16000);

  const url = await storeMp3(env, mp3);
  await emitDiscovery(env, engagementId, url);

  return json({ ok: true, url, durationSec, script: { lines }, facts });
}

// ---------------------------------------------------------------------------
// Fetch handler
// ---------------------------------------------------------------------------
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true });
    }

    if (request.method === 'POST' && url.pathname === '/generate') {
      try {
        let engagementId = url.searchParams.get('engagementId') ?? undefined;
        if (!engagementId) {
          const body = await request.json().catch(() => ({}));
          engagementId = (body as any)?.engagementId;
        }
        if (!engagementId) {
          return json({ ok: false, error: 'engagementId is required' }, 400);
        }
        return await generate(env, engagementId);
      } catch (e) {
        const err = e as Error;
        console.log(`generate failed: ${err.stack ?? err.message}`);
        return json({ ok: false, error: err.message }, 500);
      }
    }

    return json({ ok: false, error: 'not found' }, 404);
  },
};
