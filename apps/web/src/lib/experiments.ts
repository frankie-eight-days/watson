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
import { artifactsOfKind, foldMetricSeries, type ArtifactEvent, type MetricSeries } from './fold';
import { isBaselineLabel } from './vizColors';

export type ExperimentStatus = 'authored' | 'implementing' | 'testing' | 'validated' | 'rejected';

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
  branch?: string;
  paperUrl?: string;
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

/**
 * Read a labeled field in the brain's markdown format. Handles the bold-dot form
 * `**Label.** value` and `**Label:** value`, plus a plain `Label: value` legacy
 * line. Returns the rest of that line, markdown-stripped.
 */
function field(body: string, label: string): string | undefined {
  const re = new RegExp(
    `\\*\\*\\s*${label}\\s*[.:]?\\s*\\*\\*\\s*([^\\n]+)|(?:^|\\n)\\s*${label}\\s*[.:]\\s*([^\\n]+)`,
    'i',
  );
  const m = body.match(re);
  const v = m?.[1] ?? m?.[2];
  return v ? stripMd(v) : undefined;
}

function parseMoney(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = s.replace(/,/g, '').match(/-?\$?\s*(-?\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : undefined;
}

/** delta from a candidate field like "$807 (WIN +39%)" or "(no improvement)". */
function parseDelta(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = s.match(/([+-]?\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : undefined;
}

/**
 * Status from the LATEST emission. Vocabulary: proposed | authored | testing |
 * running | validated | rejected (+ optional suffix after an em-dash / parens).
 */
function parseStatus(title: string, body: string): { status: ExperimentStatus; reason?: string } {
  const raw = (field(body, 'status') ?? '').trim();
  const hay = `${title}\n${raw}\n${body}`;
  const rejected = /^reject/i.test(raw) || /reject|failed to (build|validate|compile)|build failed|compile error/i.test(hay);
  if (rejected) {
    const m =
      raw.match(/reject\w*\s*[—:-]\s*(.+)/i) ||
      raw.match(/\((.+?)\)/) ||
      hay.match(/(failed to (?:build|validate|compile)|build failed|compile error)/i);
    return { status: 'rejected', reason: m?.[1] ? stripMd(m[1]) : undefined };
  }
  if (/^validat/i.test(raw) || /\bvalidated\b/i.test(hay)) return { status: 'validated' };
  if (/^authored/i.test(raw)) return { status: 'authored' };
  if (/^(testing|running)/i.test(raw) || /\b(testing|running the arms|benchmark(ing)?)\b/i.test(hay))
    return { status: 'testing' };
  if (/^(proposed|implementing|building)/i.test(raw)) return { status: 'implementing' };
  return { status: 'implementing' };
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
  // Group experiment artifacts by refId (an experiment is emitted MULTIPLE times
  // as it progresses: proposed/authored carries hypothesis + code; the final
  // emission carries the status + result). Merge across emissions so nothing is
  // lost — the frozen 'latest wins' collapse would drop the code.
  const groups = new Map<string, ArtifactEvent[]>();
  for (const a of artifactsOfKind(events, 'experiment')) {
    const ref = a.payload.refId ?? `exp_${a.seq}`;
    const arr = groups.get(ref);
    if (arr) arr.push(a);
    else groups.set(ref, [a]);
  }
  const ordered = [...groups.entries()]
    .map(([ref, arr]) => ({ ref, arr: [...arr].sort((x, y) => x.seq - y.seq) }))
    .sort((a, b) => a.arr[0].seq - b.arr[0].seq);

  const metricName = pickMetricName(events);
  const series = metricName ? foldMetricSeries(events, metricName) : [];
  const baseline = series.find((s) => isBaselineLabel(s.label));
  const candidates = series.filter((s) => s !== baseline);
  const baselineValue = baseline?.latest;
  const unit = baseline?.unit ?? candidates[0]?.unit;

  const linkCandidate = (title: string, ref: string, idx: number): MetricSeries | undefined =>
    // Preferred: seriesLabel === pitch title (== card title) in the new format.
    candidates.find((c) => c.label === title) ??
    candidates.find((c) => c.label === ref) ??
    (title ? candidates.find((c) => c.label.includes(title) || title.includes(c.label)) : undefined) ??
    // positional / single-candidate fallback (generic 'candidate' seriesLabel)
    (candidates.length === ordered.length ? candidates[idx] : undefined) ??
    (candidates.length === 1 && ordered.length === 1 ? candidates[0] : undefined);

  const experiments: ExperimentView[] = ordered.map((g, idx) => {
    const emissions = g.arr;
    const latest = emissions[emissions.length - 1];
    const title = emissions.find((e) => e.payload.title)?.payload.title ?? latest.payload.title;
    const mergedBody = emissions.map((e) => e.payload.body ?? '').join('\n\n');

    const { status, reason } = parseStatus(latest.payload.title, latest.payload.body ?? '');
    const { code } = extractCodeBlocks(mergedBody);
    const hypothesis = field(mergedBody, 'hypothesis');
    const fileRaw = field(mergedBody, 'target') ?? field(mergedBody, 'file') ?? field(mergedBody, 'path');
    const branch = field(mergedBody, 'branch');
    const paperUrl = emissions.map((e) => e.payload.url).find(Boolean) ?? undefined;

    const candidate = linkCandidate(title, g.ref, idx);
    // Metric-derived values win; else fall back to the values stated in the body.
    const candField = field(mergedBody, 'candidate');
    const candidateValue = candidate?.latest ?? parseMoney(candField);
    const bValue = baselineValue ?? parseMoney(field(mergedBody, 'baseline'));
    const deltaPct =
      candidateValue != null && bValue != null && bValue !== 0
        ? ((candidateValue - bValue) / Math.abs(bValue)) * 100
        : parseDelta(candField);

    // description: prose left after removing code + the labeled field lines.
    const description =
      code.length === 0
        ? extractCodeBlocks(mergedBody)
            .rest.split('\n')
            .filter(
              (l) =>
                l.trim() &&
                !/^\s*(?:\*\*)?\s*(hypothesis|status|target|file|path|baseline|candidate|branch|paper|arms|command)\b/i.test(
                  l,
                ),
            )
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim() || undefined
        : undefined;

    return {
      refId: g.ref,
      title,
      tag: shortLabel(g.ref, idx),
      agentId: latest.agentId,
      seq: latest.seq,
      status,
      statusReason: reason,
      hypothesis,
      file: fileRaw ? fileRaw.replace(/`/g, '').trim() : undefined,
      branch,
      paperUrl,
      description,
      code,
      candidate,
      candidateValue,
      baselineValue: bValue,
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
    running: experiments.filter(
      (e) => e.status === 'authored' || e.status === 'implementing' || e.status === 'testing',
    ).length,
  };
}
