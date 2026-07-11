/**
 * experiments.ts — the Lab fold. Turns `artifact` (kind:'experiment') + `metric`
 * events into a live, parallel set of experiment cards, each linked to its
 * candidate metric line. Pure/event-derived (replay-safe).
 *
 * Each experiment artifact is re-emitted with the same `refId` as it progresses
 * (implementing → testing → validated/rejected); the latest wins. Its markdown
 * `body` carries the hypothesis, the target file, the status, and a fenced code
 * block (the diff/snippet the agent actually wrote).
 */
import type { WatsonEvent } from '@watson/shared';
import {
  artifactsOfKind,
  foldMetricSeries,
  latestArtifactByRef,
  type ArtifactEvent,
  type MetricSeries,
} from './fold';
import { isBaselineLabel } from './vizColors';

export type ExperimentStatus = 'implementing' | 'testing' | 'validated' | 'rejected';

export interface CodeBlock {
  lang?: string;
  code: string;
  isDiff: boolean;
}

export interface ExperimentView {
  refId: string;
  title: string;
  /** Short tag shared with its chart line (P1, P2, …). */
  tag: string;
  agentId: string;
  seq: number;
  status: ExperimentStatus;
  statusReason?: string;
  hypothesis?: string;
  file?: string;
  description?: string;
  code: CodeBlock[];
  /** The candidate metric line for this experiment, if linked. */
  candidate?: MetricSeries;
  candidateValue?: number;
  baselineValue?: number;
  deltaPct?: number;
  /** Index into the candidate color palette (matches its chart line); undefined
   *  when the experiment produced no metric line (e.g. failed to build). */
  colorIndex?: number;
}

export interface LabModel {
  experiments: ExperimentView[];
  /** All series (baseline + candidates) for the combined chart, chart-labeled. */
  chartSeries: MetricSeries[];
  baselineValue?: number;
  unit?: string;
  metricLabel: string;
  /** True when x looks like a day axis (multi-point series). */
  xIsDay: boolean;
  validated: number;
  rejected: number;
  running: number;
}

// ── markdown body parsing ─────────────────────────────────────────────────

const stripMd = (s: string) => s.replace(/[*`_]/g, '').trim();

function extractCodeBlocks(body: string): { code: CodeBlock[]; rest: string } {
  const code: CodeBlock[] = [];
  const rest = body.replace(/```(\w+)?\n?([\s\S]*?)```/g, (_m, lang: string | undefined, raw: string) => {
    const text = raw.replace(/\n+$/, '');
    const lines = text.split('\n');
    const diffLines = lines.filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l)).length;
    const isDiff = (lang ?? '').toLowerCase() === 'diff' || diffLines >= Math.max(1, lines.length * 0.3);
    code.push({ lang, code: text, isDiff });
    return '';
  });
  return { code, rest };
}

function parseStatus(title: string, body: string): { status: ExperimentStatus; reason?: string } {
  const hay = `${title}\n${body}`;
  const explicit = hay.match(/status[:*\s]*\**\s*(implementing|testing|validated?|rejected?|proposed|running|building|failed)/i);
  const word = explicit?.[1]?.toLowerCase();
  const rejected = /reject|failed to (build|compile)|build failed|compile error/i.test(hay) || word === 'failed';
  if (rejected) {
    const m =
      hay.match(/reject\w*\s*[—:-]\s*([^\n.]+)/i) ||
      hay.match(/(failed to build|failed to compile|build failed|compile error)/i);
    return { status: 'rejected', reason: m?.[1] ? stripMd(m[1]) : undefined };
  }
  if (word?.startsWith('validat') || /\bvalidated\b/i.test(hay)) return { status: 'validated' };
  if (word === 'testing' || word === 'running' || /\b(testing|running the|benchmark(ing)?)\b/i.test(hay))
    return { status: 'testing' };
  return { status: 'implementing' };
}

function firstMatch(body: string, re: RegExp): string | undefined {
  const m = body.match(re);
  return m?.[1] ? stripMd(m[1]) : undefined;
}

function parseBody(title: string, body: string) {
  const { code, rest } = extractCodeBlocks(body);
  const hypothesis = firstMatch(rest, /hypothesis[:*\s]*\**\s*([^\n]+)/i);
  const file =
    firstMatch(rest, /(?:target file|file|path|target)[:*\s]*\**\s*`?([^\n`]+?)`?\s*$/im) ??
    firstMatch(rest, /(?:target file|file|path|target)[:*\s]*\**\s*`?([^\n`,]+)`?/i);
  const { status, reason } = parseStatus(title, body);
  // description = remaining prose minus the field lines we surfaced structurally.
  const description = rest
    .split('\n')
    .filter((l) => l.trim() && !/^(\s*[*>-]?\s*)(hypothesis|status|file|path|target|target file|command)\b/i.test(l))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { code, hypothesis, file, status, reason, description: description || undefined };
}

// ── metric linkage ────────────────────────────────────────────────────────

const METRIC_PREFERENCE = ['total_assets', 'totalAssets', 'agent_time_horizon'];

function pickMetricName(events: WatsonEvent[]): string | undefined {
  const present = new Set<string>();
  for (const e of events) if (e.type === 'metric') present.add((e.payload as { name: string }).name);
  const preferred = METRIC_PREFERENCE.find((n) => present.has(n));
  if (preferred) return preferred;
  return present.values().next().value as string | undefined;
}

const METRIC_LABELS: Record<string, string> = {
  total_assets: 'Total assets',
  totalAssets: 'Total assets',
  agent_time_horizon: 'Agent time-horizon',
};

/** Short chart-friendly label for a candidate line (P1, P2, …). */
function shortLabel(refId: string, index: number): string {
  const n = refId.match(/(\d+)/)?.[1];
  return `P${n ?? index + 1}`;
}

export function foldLab(events: WatsonEvent[]): LabModel {
  const arts = latestArtifactByRef(artifactsOfKind(events, 'experiment')).sort((a, b) => a.seq - b.seq);
  const metricName = pickMetricName(events);
  const series = metricName ? foldMetricSeries(events, metricName) : [];
  const baseline = series.find((s) => isBaselineLabel(s.label));
  const candidates = series.filter((s) => s !== baseline);
  const baselineValue = baseline?.latest;
  const unit = baseline?.unit ?? candidates[0]?.unit;

  const linkCandidate = (art: ArtifactEvent, idx: number): MetricSeries | undefined => {
    const ref = art.payload.refId ?? '';
    return (
      candidates.find((c) => c.label === ref) ??
      (ref ? candidates.find((c) => c.label.includes(ref) || ref.includes(c.label)) : undefined) ??
      // fall back to positional linkage when labels don't encode the refId
      (candidates.length === arts.length ? candidates[idx] : undefined)
    );
  };

  const experiments: ExperimentView[] = arts.map((art, idx) => {
    const p = art.payload;
    const parsed = parseBody(p.title, p.body ?? '');
    const candidate = linkCandidate(art, idx);
    const candidateValue = candidate?.latest;
    const deltaPct =
      candidateValue != null && baselineValue != null && baselineValue !== 0
        ? ((candidateValue - baselineValue) / Math.abs(baselineValue)) * 100
        : undefined;
    return {
      refId: p.refId ?? `exp_${art.seq}`,
      title: p.title,
      tag: shortLabel(p.refId ?? `exp_${art.seq}`, idx),
      agentId: art.agentId,
      seq: art.seq,
      status: parsed.status,
      statusReason: parsed.reason,
      hypothesis: parsed.hypothesis,
      file: parsed.file,
      description: parsed.description,
      code: parsed.code,
      candidate,
      candidateValue,
      baselineValue,
      deltaPct,
    };
  });

  // Build the chart series with readable labels: baseline + each linked candidate
  // relabeled to its experiment's short tag (P1, P2, …) so the line ties to a card.
  // Assign each linked experiment a colorIndex matching its candidate's order in
  // chartSeries — so the card's dot uses the same palette color as its line.
  const chartSeries: MetricSeries[] = [];
  if (baseline) chartSeries.push({ ...baseline, label: 'baseline' });
  let colorIdx = 0;
  experiments.forEach((e) => {
    if (e.candidate) {
      e.colorIndex = colorIdx++;
      chartSeries.push({ ...e.candidate, label: e.tag });
    }
  });
  // include any unlinked candidate lines so nothing is dropped
  for (const c of candidates) {
    if (!experiments.some((e) => e.candidate === c)) chartSeries.push(c);
  }

  const xIsDay = metricName === 'total_assets' || metricName === 'totalAssets';

  return {
    experiments,
    chartSeries,
    baselineValue,
    unit,
    metricLabel: (metricName && METRIC_LABELS[metricName]) || 'Metric',
    xIsDay,
    validated: experiments.filter((e) => e.status === 'validated').length,
    rejected: experiments.filter((e) => e.status === 'rejected').length,
    running: experiments.filter((e) => e.status === 'implementing' || e.status === 'testing').length,
  };
}
