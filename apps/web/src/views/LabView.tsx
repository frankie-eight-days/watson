/**
 * Lab — the WOW canvas. AgentTree (left) + the live time-horizon MetricChart
 * (baseline vs candidate, climbing 23 → 41 days as the cursor advances) + a
 * headline delta + experiment cards flipping proposed → testing → validated.
 */
import { useMemo } from 'react';
import { useEngagementEvents } from '@/state/hooks';
import { artifactsOfKind, foldMetricSeries, latestMetric } from '@/lib/fold';
import { Canvas, SectionHeader, TreeLayout } from './_layout';
import { MetricChart } from '@/components/MetricChart';
import { EventCard } from '@/components/EventCard';
import { Eyebrow, Pill, EmptyState } from '@/components/primitives';
import { formatNum, formatUsd } from '@/lib/format';

export function LabView() {
  const events = useEngagementEvents();

  const series = useMemo(() => foldMetricSeries(events, 'agent_time_horizon'), [events]);
  const baseline = series.find((s) => /base/i.test(s.label));
  const candidate = series.find((s) => !/base/i.test(s.label));
  const speedup = useMemo(() => latestMetric(events, 'summarizer_speedup'), [events]);

  const headlineBase = baseline?.latest;
  const headlineCand = candidate?.latest ?? baseline?.latest;
  const delta =
    headlineBase != null && headlineCand != null ? headlineCand - headlineBase : undefined;

  const experiments = useMemo(() => artifactsOfKind(events, 'experiment'), [events]);
  const validated = experiments.some((e) => /validated/i.test(e.payload.title));

  return (
    <TreeLayout>
      <Canvas>
        <SectionHeader
          eyebrow="Experiments"
          title="Time-horizon under test"
          right={
            validated ? (
              <Pill tone="good">✓ Validated — PR opened</Pill>
            ) : candidate ? (
              <Pill tone="accent">Candidate running</Pill>
            ) : (
              <Pill tone="neutral">Baseline</Pill>
            )
          }
        />

        {/* headline numbers */}
        <div className="hairline-card mb-4 p-5">
          <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
            <div>
              <Eyebrow>Baseline</Eyebrow>
              <div className="tnum text-3xl font-semibold text-ink">
                {headlineBase != null ? formatNum(headlineBase, 1) : '—'}
                <span className="ml-1 text-base font-normal text-ink-3">days</span>
              </div>
            </div>
            <div className="pb-1 text-2xl text-ink-3">→</div>
            <div>
              <Eyebrow>Candidate</Eyebrow>
              <div className="tnum text-3xl font-semibold text-accent-ink">
                {headlineCand != null ? formatNum(headlineCand, 1) : '—'}
                <span className="ml-1 text-base font-normal text-ink-3">days</span>
              </div>
            </div>
            {delta != null && delta > 0 && (
              <div className="pb-1">
                <span
                  className="tnum rounded-pill px-2.5 py-1 text-sm font-semibold"
                  style={{ color: 'var(--good)', background: 'var(--good-soft)' }}
                >
                  +{formatNum(delta, 1)} days
                </span>
              </div>
            )}
            {speedup && (
              <div className="pb-1">
                <Eyebrow>Summarizer</Eyebrow>
                <div className="tnum text-sm font-medium text-ink">{formatNum(speedup.value, 2)}× faster</div>
              </div>
            )}
          </div>

          <div className="mt-4 border-t border-hairline pt-4">
            {series.length === 0 ? (
              <div className="py-10 text-center text-sm text-ink-3">Awaiting the first benchmark run…</div>
            ) : (
              <MetricChart series={series} unit={candidate?.unit ?? baseline?.unit} yFloor={0} />
            )}
          </div>
        </div>

        {/* experiment cards */}
        <SectionHeader eyebrow="Sandbox" title="Experiments" />
        {experiments.length === 0 ? (
          <EmptyState title="No experiments yet" hint="Pitches become experiments once the orchestrator queues a sandbox run." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {experiments.map((e) => (
              <EventCard
                key={e.seq}
                artifact={e}
                accent={/validated/i.test(e.payload.title) ? 'var(--good)' : 'var(--accent)'}
                meta={
                  /validated/i.test(e.payload.title) ? (
                    <Pill tone="good">validated</Pill>
                  ) : (
                    <Pill tone="accent">testing</Pill>
                  )
                }
                footer={<span className="tnum text-[0.6875rem] text-ink-3">{formatUsd(e.costUsd ?? 0)}</span>}
              />
            ))}
          </div>
        )}
      </Canvas>
    </TreeLayout>
  );
}
