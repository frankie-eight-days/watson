/**
 * Conference — the results dashboard. Everything is folded from the event stream
 * up to the replay cursor, so each section appears as its data arrives and the
 * page is safe to scrub. Structure:
 *   1. Hero delta strip — the headline before/after (this run vs its baseline)
 *   2. Hypothesis comparison — horizontal bars, candidates vs baseline
 *   3. Pull requests — the PRs shipped to the fork
 *   4. Run stats — a compact derived-from-events strip
 *   5. Report — the written write-up (markdown)
 *   6. Podcast — the audio briefing, when present
 */
import { useMemo } from 'react';
import { useEngagement, useEngagementEvents } from '@/state/hooks';
import {
  artifactsOfKind,
  latestArtifactByRef,
  latestMetric,
} from '@/lib/fold';
import { foldLab, type ExperimentView } from '@/lib/experiments';
import { candidateColor } from '@/lib/vizColors';
import { Canvas, SectionHeader } from './_layout';
import { EventCard } from '@/components/EventCard';
import { Eyebrow, Pill, EmptyState } from '@/components/primitives';
import { MarkdownLite } from '@/components/Markdown';
import { formatInt, formatNum, formatUsd } from '@/lib/format';

/** Integer-percent delta (truncated, signed) for headline figures. */
function pctInt(p: number): string {
  return `${p >= 0 ? '+' : ''}${Math.trunc(p)}%`;
}

/** Unit-aware hero formatting: usd → $, days → "41.0d", else a plain number. */
function fmtHero(v: number, unit?: string): string {
  if (unit === 'usd') return formatUsd(v);
  if (unit === 'days') return `${formatNum(v, 1)}d`;
  return formatNum(v, v % 1 ? 1 : 0);
}

function bestCandidate(experiments: ExperimentView[]): ExperimentView | undefined {
  return experiments.reduce<ExperimentView | undefined>(
    (best, e) =>
      e.status !== 'rejected' &&
      e.candidateValue != null &&
      (best?.candidateValue == null || e.candidateValue > best.candidateValue)
        ? e
        : best,
    undefined,
  );
}

// ── Hypothesis comparison bars ────────────────────────────────────────────────

function ComparisonBars({
  baseline,
  experiments,
  unit,
}: {
  baseline: number;
  experiments: ExperimentView[];
  unit?: string;
}) {
  const rows = experiments.filter((e) => e.candidateValue != null);
  if (rows.length === 0) return null;

  const winnerVal = Math.max(...rows.map((e) => e.candidateValue as number));
  const maxV = Math.max(baseline, winnerVal) * 1.06 || 1;
  const w = (v: number) => `${Math.max(1.5, (v / maxV) * 100)}%`;

  return (
    <div className="hairline-card mb-6 p-5">
      <SectionHeader eyebrow="Hypothesis comparison" title="Candidates vs baseline" />

      <div className="mt-1 flex flex-col gap-3">
        {/* baseline — recessive reference */}
        <div className="flex items-center gap-3">
          <div className="w-40 shrink-0 truncate text-[0.8125rem] text-ink-2 sm:w-52">Baseline · this run</div>
          <div className="relative h-6 min-w-0 flex-1 rounded bg-surface-2">
            <div
              className="absolute inset-y-0 left-0 rounded"
              style={{
                width: w(baseline),
                backgroundImage:
                  'repeating-linear-gradient(45deg, var(--baseline-line) 0 6px, transparent 6px 11px)',
                opacity: 0.6,
              }}
            />
          </div>
          <div className="tnum w-20 shrink-0 text-right text-[0.8125rem] font-medium text-ink-2">
            {fmtHero(baseline, unit)}
          </div>
          <div className="w-16 shrink-0" />
        </div>

        {/* candidates */}
        {rows.map((e) => {
          const v = e.candidateValue as number;
          const isWinner = v === winnerVal;
          const color = e.colorIndex != null ? candidateColor(e.colorIndex) : 'var(--series-1)';
          const delta = ((v - baseline) / Math.abs(baseline)) * 100;
          return (
            <div key={e.refId} className="flex items-center gap-3">
              <div className="flex w-40 shrink-0 items-center gap-1.5 sm:w-52">
                <span
                  className="flex h-4 shrink-0 items-center rounded px-1 text-[0.5625rem] font-bold text-white"
                  style={{ background: color }}
                >
                  {e.tag}
                </span>
                <span
                  className={`truncate text-[0.8125rem] ${isWinner ? 'font-semibold text-ink' : 'text-ink-2'}`}
                  title={e.title}
                >
                  {e.title}
                </span>
              </div>
              <div className="relative h-6 min-w-0 flex-1 rounded bg-surface-2">
                <div
                  className="absolute inset-y-0 left-0 rounded transition-[width] duration-500"
                  style={{
                    width: w(v),
                    background: color,
                    boxShadow: isWinner ? '0 0 0 1.5px var(--surface), 0 0 0 3px var(--good)' : undefined,
                  }}
                />
              </div>
              <div
                className="tnum w-20 shrink-0 text-right text-[0.8125rem] font-semibold"
                style={{ color: isWinner ? 'var(--good)' : 'var(--ink)' }}
              >
                {fmtHero(v, unit)}
              </div>
              <div className="flex w-16 shrink-0 items-center justify-end">
                {isWinner ? (
                  <Pill tone="good">WINNER</Pill>
                ) : (
                  <span
                    className="tnum text-[0.75rem] font-medium"
                    style={{ color: delta >= 0 ? 'var(--good)' : 'var(--critical)' }}
                  >
                    {pctInt(delta)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-[0.6875rem] leading-relaxed text-ink-3">
        Each arm is a single 30-day sandbox run, measured against the{' '}
        <span className="tnum">{fmtHero(baseline, unit)}</span> in-run baseline. Deltas are this run's
        result, not an average.
      </p>
    </div>
  );
}

// ── Run stats strip ───────────────────────────────────────────────────────────

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="tnum text-lg font-semibold leading-none text-ink">{value}</span>
      <Eyebrow>{label}</Eyebrow>
    </div>
  );
}

export function ConferenceView() {
  const events = useEngagementEvents();
  const { agents, engagementTotals } = useEngagement();
  const lab = useMemo(() => foldLab(events), [events]);

  const prs = useMemo(() => latestArtifactByRef(artifactsOfKind(events, 'pr')), [events]);
  const reports = useMemo(() => artifactsOfKind(events, 'report'), [events]);
  // The podcast announces itself as a report artifact titled 'podcast' whose body
  // is the MP3 URL; the written report is any other report artifact.
  const podcast = useMemo(() => reports.find((r) => /podcast/i.test(r.payload.title)) ?? null, [reports]);
  const podcastUrl = (podcast?.payload.body ?? podcast?.payload.url ?? '').trim();
  const report = useMemo(() => reports.filter((r) => r !== podcast).at(-1) ?? null, [reports, podcast]);

  // Hero + comparison derivation — the in-run baseline vs the best candidate.
  const winner = useMemo(() => bestCandidate(lab.experiments), [lab.experiments]);
  const heroBaseline = lab.baselineValue;
  const heroWinner = winner?.candidateValue;
  const heroReady = heroBaseline != null && heroWinner != null;
  const heroDelta =
    heroReady && heroBaseline !== 0 ? ((heroWinner! - heroBaseline!) / Math.abs(heroBaseline!)) * 100 : undefined;
  const hasMetrics = lab.chartSeries.length > 0;

  // Honesty caption: the aggregated means, used ONLY for disclosure wording.
  const variance = useMemo(() => {
    const b = latestMetric(events, 'baseline_mean');
    const w = latestMetric(events, 'winner_mean');
    if (!b || !w || b.value === 0 || heroBaseline == null || heroBaseline === 0) return null;
    return {
      meanLo: Math.trunc(((w.value - b.value) / Math.abs(b.value)) * 100),
      meanHi: Math.trunc(((w.value - heroBaseline) / Math.abs(heroBaseline)) * 100),
    };
  }, [events, heroBaseline]);

  // Run stats (all event-derived).
  const paperCount = useMemo(
    () => new Set(artifactsOfKind(events, 'paper').map((a) => a.payload.refId).filter(Boolean)).size,
    [events],
  );
  const sandboxRuns = useMemo(() => {
    const m = latestMetric(events, 'sandbox_runs');
    if (m) return Math.round(m.value);
    const days = events.filter((e) => e.type === 'metric' && e.payload.name === 'daysCompleted').length;
    return days > 0 ? days : undefined;
  }, [events]);
  const costMetric = useMemo(() => latestMetric(events, 'engagement_cost'), [events]);
  const costUsd = costMetric?.value ?? (engagementTotals.costUsd > 0 ? engagementTotals.costUsd : undefined);

  const unit = lab.unit;

  return (
    <Canvas>
      <SectionHeader
        eyebrow="Deliverables"
        title="The Conference"
        right={prs.length > 0 ? <Pill tone="good">{prs.length} PRs live</Pill> : undefined}
      />

      {/* 1 — HERO DELTA STRIP */}
      <div data-tour="conference" className="hairline-card mb-6 p-5">
        {heroReady ? (
          <>
            <Eyebrow>{lab.metricLabel} · this run vs its baseline</Eyebrow>
            <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-3">
              <div className="tnum text-3xl font-semibold leading-none text-ink-2">
                {fmtHero(heroBaseline!, unit)}
              </div>
              <div className="pb-1 text-2xl text-ink-3">→</div>
              <div className="tnum text-4xl font-semibold leading-none text-ink">
                {fmtHero(heroWinner!, unit)}
              </div>
              {heroDelta != null && (
                <span
                  className="tnum mb-1 rounded-pill px-3 py-1 text-base font-semibold"
                  style={{
                    color: heroDelta >= 0 ? 'var(--good)' : 'var(--critical)',
                    background: heroDelta >= 0 ? 'var(--good-soft)' : 'var(--critical-soft)',
                  }}
                >
                  {pctInt(heroDelta)}
                </span>
              )}
            </div>
            <p className="mt-3 max-w-2xl text-[0.6875rem] leading-relaxed text-ink-3">
              This run's result vs its baseline. High-variance benchmark
              {variance
                ? `; across repeated runs the winner averages ~+${variance.meanLo}–${variance.meanHi}% over baseline (n=3) — we re-ran to confirm.`
                : '.'}
            </p>
          </>
        ) : (
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 shrink-0 rounded-full border border-dashed border-[color:var(--hairline-strong)]" />
            <div>
              <div className="text-sm font-medium text-ink-2">
                {hasMetrics ? 'Benchmarking in progress' : 'Results pending'}
              </div>
              <div className="text-xs text-ink-3">The headline result appears once the Lab runs complete.</div>
            </div>
          </div>
        )}
      </div>

      {/* 2 — HYPOTHESIS COMPARISON */}
      {heroReady && <ComparisonBars baseline={heroBaseline!} experiments={lab.experiments} unit={unit} />}

      {/* 4 — RUN STATS */}
      <div className="hairline-card mb-6 flex flex-wrap items-center gap-x-8 gap-y-4 px-5 py-4">
        <StatChip label="Agents" value={formatInt(agents.length)} />
        <StatChip label="Papers read" value={formatInt(paperCount)} />
        <StatChip label="Hypotheses tested" value={formatInt(lab.experiments.length)} />
        <StatChip label="PRs shipped" value={formatInt(prs.length)} />
        {sandboxRuns != null && <StatChip label="Sandbox runs" value={formatInt(sandboxRuns)} />}
        {costUsd != null && <StatChip label="Cost" value={formatUsd(costUsd)} />}
      </div>

      {/* 6 — PODCAST (only when the report/podcast artifact exists) */}
      {podcast && podcastUrl && (
        <div className="hairline-card animate-fade-slide-in mb-6 overflow-hidden">
          <div className="flex items-center gap-3 border-b border-hairline bg-accent-soft px-5 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white">
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 2a3 3 0 0 1 3 3v4a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3ZM5 9a5 5 0 0 0 10 0M10 14v3M7 17h6" />
              </svg>
            </span>
            <div className="min-w-0">
              <div className="eyebrow text-accent-ink">Audio briefing</div>
              <div className="truncate text-base font-semibold text-ink">{podcast.payload.title}</div>
            </div>
            <a
              href={podcastUrl}
              download
              className="focus-ring ml-auto shrink-0 rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-accent-ink hover:bg-accent-soft"
            >
              Download ↓
            </a>
          </div>
          <div className="px-5 py-4">
            <audio controls preload="none" src={podcastUrl} className="w-full">
              <a href={podcastUrl}>Open the audio briefing</a>
            </audio>
          </div>
        </div>
      )}

      {/* 3 — PULL REQUESTS */}
      <SectionHeader eyebrow="Pull requests" title="Shipped to the fork" />
      {prs.length === 0 ? (
        <EmptyState title="No PRs yet" hint="A validated experiment opens a pull request on the fork." />
      ) : (
        <div className="mb-6 grid gap-3 sm:grid-cols-2">
          {prs.map((pr) => (
            <EventCard
              key={pr.seq}
              artifact={pr}
              accent="var(--good)"
              meta={<Pill tone="good">open</Pill>}
              footer={<span className="tnum text-[0.6875rem] text-ink-3">{pr.payload.refId}</span>}
            />
          ))}
        </div>
      )}

      {/* 5 — REPORT */}
      <SectionHeader eyebrow="Report" title="Engagement write-up" />
      {report ? (
        <article className="hairline-card animate-fade-slide-in p-6">
          <Eyebrow>{report.payload.kind}</Eyebrow>
          <h3 className="mt-1 text-lg font-semibold tracking-tight text-ink">{report.payload.title}</h3>
          {report.payload.body && (
            <div className="mt-3 max-w-none">
              <MarkdownLite body={report.payload.body} />
            </div>
          )}
          {report.payload.url && (
            <a
              href={report.payload.url}
              target="_blank"
              rel="noreferrer"
              className="focus-ring mt-4 inline-flex rounded-lg border border-hairline px-3 py-1.5 text-xs font-medium text-accent-ink hover:bg-accent-soft"
            >
              Open full report ↗
            </a>
          )}
        </article>
      ) : (
        <EmptyState title="Report pending" hint="The conference editor compiles the report after PRs land." />
      )}
    </Canvas>
  );
}
