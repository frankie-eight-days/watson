/**
 * Lab — the WOW canvas. AgentTree + console on the left; on the right a combined
 * baseline-vs-candidates chart (the money shot) and a set of PARALLEL experiment
 * cards. Each card shows the pitch, its hypothesis, the target file, a clear
 * status (implementing → testing → validated/rejected), the live metric result
 * (candidate vs baseline + delta%), and the actual code the agent wrote.
 *
 * Everything is folded from artifact(kind:'experiment') + metric events — pure
 * event-derived, so it replays.
 */
import { useMemo } from 'react';
import { useEngagementEvents } from '@/state/hooks';
import { foldLab, type ExperimentView, type ExperimentStatus } from '@/lib/experiments';
import { candidateColor } from '@/lib/vizColors';
import { Canvas, SectionHeader, TreeLayout } from './_layout';
import { MetricChart } from '@/components/MetricChart';
import { CodeBlock } from '@/components/CodeBlock';
import { Eyebrow, Pill, EmptyState } from '@/components/primitives';
import { formatNum, formatUsd } from '@/lib/format';

const STATUS_META: Record<
  ExperimentStatus,
  { label: string; color: string; soft: string; live: boolean }
> = {
  authored: { label: 'Authored', color: 'var(--accent-ink)', soft: 'var(--accent-soft)', live: true },
  implementing: { label: 'Implementing', color: 'var(--warning)', soft: 'var(--warning-soft)', live: true },
  testing: { label: 'Testing', color: 'var(--accent-ink)', soft: 'var(--accent-soft)', live: true },
  validated: { label: 'Validated', color: 'var(--good)', soft: 'var(--good-soft)', live: false },
  rejected: { label: 'Rejected', color: 'var(--critical)', soft: 'var(--critical-soft)', live: false },
};

function fmtVal(v: number | undefined, unit?: string): string {
  if (v == null) return '—';
  if (unit === 'usd') return formatUsd(v);
  return `${formatNum(v, v % 1 ? 1 : 0)}${unit ? ` ${unit}` : ''}`;
}

function StatusBadge({ status, reason }: { status: ExperimentStatus; reason?: string }) {
  const m = STATUS_META[status];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-pill px-2 py-0.5 text-[0.625rem] font-semibold"
      style={{ background: m.soft, color: m.color }}
    >
      {m.live ? (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: m.color }} />
      ) : status === 'validated' ? (
        <span>✓</span>
      ) : (
        <span>✕</span>
      )}
      {m.label}
      {status === 'rejected' && reason ? ` · ${reason}` : ''}
    </span>
  );
}

function ExperimentCard({ e, unit }: { e: ExperimentView; unit?: string }) {
  const color = e.colorIndex != null ? candidateColor(e.colorIndex) : 'var(--ink-3)';
  const rejected = e.status === 'rejected';
  const deltaGood = (e.deltaPct ?? 0) >= 0;

  return (
    <div
      className="hairline-card animate-fade-slide-in flex flex-col gap-3 p-4"
      style={{ opacity: rejected ? 0.78 : 1 }}
    >
      {/* header */}
      <div className="flex items-start gap-2.5">
        <span
          className="mt-0.5 flex h-5 shrink-0 items-center rounded-md px-1.5 text-[0.625rem] font-bold text-white"
          style={{ background: color }}
        >
          {e.tag}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[0.875rem] font-semibold leading-tight text-ink">{e.title}</div>
          <div className="mt-0.5 flex items-center gap-2">
            {e.file && <span className="truncate font-mono text-[0.6875rem] text-ink-3">{e.file}</span>}
            {e.branch && (
              <span className="shrink-0 rounded bg-surface-2 px-1 font-mono text-[0.625rem] text-ink-3">⎇ {e.branch}</span>
            )}
          </div>
        </div>
        <StatusBadge status={e.status} reason={e.statusReason} />
      </div>

      {/* hypothesis */}
      {e.hypothesis && (
        <div className="rounded-lg bg-surface-2 px-3 py-2">
          <Eyebrow>Hypothesis</Eyebrow>
          <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-ink-2">{e.hypothesis}</p>
        </div>
      )}

      {/* metric result */}
      <div className="flex items-end gap-4">
        <div>
          <Eyebrow>Baseline</Eyebrow>
          <div className="tnum text-sm font-medium text-ink-2">{fmtVal(e.baselineValue, unit)}</div>
        </div>
        <div className="pb-0.5 text-ink-3">→</div>
        <div>
          <Eyebrow>Candidate</Eyebrow>
          <div
            className="tnum text-lg font-semibold"
            style={{ color: e.candidateValue != null ? color : 'var(--ink-3)' }}
          >
            {fmtVal(e.candidateValue, unit)}
          </div>
        </div>
        {e.deltaPct != null && (
          <div className="pb-0.5">
            <span
              className="tnum rounded-pill px-2 py-0.5 text-[0.75rem] font-semibold"
              style={{
                color: deltaGood ? 'var(--good)' : 'var(--critical)',
                background: deltaGood ? 'var(--good-soft)' : 'var(--critical-soft)',
              }}
            >
              {deltaGood ? '+' : ''}
              {formatNum(e.deltaPct, 1)}%
            </span>
          </div>
        )}
        {e.candidateValue == null && rejected && (
          <div className="pb-0.5 text-[0.75rem] text-ink-3">no run — {e.statusReason ?? 'build failed'}</div>
        )}
      </div>

      {/* the code the agent wrote */}
      {e.code.length > 0 ? (
        <div className="space-y-2">
          <Eyebrow>Code change</Eyebrow>
          {e.code.map((b, i) => (
            <CodeBlock key={i} block={b} />
          ))}
        </div>
      ) : (
        e.description && <p className="text-[0.8125rem] leading-relaxed text-ink-2">{e.description}</p>
      )}

      {e.paperUrl && (
        <a
          href={e.paperUrl}
          target="_blank"
          rel="noreferrer"
          className="focus-ring inline-flex w-fit items-center gap-1 text-[0.6875rem] font-medium text-accent-ink hover:underline"
        >
          Source paper ↗
        </a>
      )}
    </div>
  );
}

export function LabView() {
  const events = useEngagementEvents();
  const lab = useMemo(() => foldLab(events), [events]);

  const bestDelta = useMemo(() => {
    const deltas = lab.experiments
      .filter((e) => e.deltaPct != null && e.status !== 'rejected')
      .map((e) => e.deltaPct as number);
    return deltas.length ? Math.max(...deltas) : undefined;
  }, [lab.experiments]);

  const hasChart = lab.chartSeries.length > 0;

  return (
    <TreeLayout>
      <Canvas>
        <SectionHeader
          eyebrow="The Lab"
          title={`${lab.metricLabel} — baseline vs candidates`}
          right={
            <div className="flex items-center gap-1.5">
              {lab.validated > 0 && <Pill tone="good">{lab.validated} validated</Pill>}
              {lab.running > 0 && <Pill tone="accent">{lab.running} running</Pill>}
              {lab.rejected > 0 && <Pill tone="neutral">{lab.rejected} rejected</Pill>}
            </div>
          }
        />

        {/* combined chart — the money shot */}
        <div data-tour="lab" className="hairline-card mb-5 p-5">
          <div className="mb-2 flex flex-wrap items-end gap-x-8 gap-y-2">
            <div>
              <Eyebrow>Baseline reference</Eyebrow>
              <div className="tnum text-2xl font-semibold text-ink">{fmtVal(lab.baselineValue, lab.unit)}</div>
            </div>
            {bestDelta != null && (
              <div>
                <Eyebrow>Best candidate</Eyebrow>
                <div
                  className="tnum text-2xl font-semibold"
                  style={{ color: bestDelta >= 0 ? 'var(--good)' : 'var(--critical)' }}
                >
                  {bestDelta >= 0 ? '+' : ''}
                  {formatNum(bestDelta, 1)}%
                </div>
              </div>
            )}
          </div>
          {hasChart ? (
            <MetricChart
              series={lab.chartSeries}
              unit={lab.unit}
              yFloor={lab.unit === 'usd' ? undefined : 0}
              xLabel={lab.xIsDay ? (x) => `d${x}` : undefined}
            />
          ) : (
            <div className="py-12 text-center text-sm text-ink-3">Awaiting the first benchmark run…</div>
          )}
        </div>

        {/* parallel experiment lanes */}
        <SectionHeader
          eyebrow="Parallel experiments"
          title="Pitches under test"
          right={<span className="tnum text-xs text-ink-3">{lab.experiments.length} in flight</span>}
        />
        {lab.experiments.length === 0 ? (
          <EmptyState
            title="No experiments yet"
            hint="Each validated pitch becomes an experiment: the agent writes a code change and runs it in the sandbox."
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {lab.experiments.map((e) => (
              <ExperimentCard key={e.refId} e={e} unit={lab.unit} />
            ))}
          </div>
        )}
      </Canvas>
    </TreeLayout>
  );
}
