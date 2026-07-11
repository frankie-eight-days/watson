/**
 * Conference — the deliverables. PR cards (with the live GitHub URL), the report
 * artifact rendered, and the before/after headline numbers. All event-derived.
 */
import { useMemo } from 'react';
import { useEngagementEvents } from '@/state/hooks';
import { artifactsOfKind, foldMetricSeries, latestArtifactByRef, latestMetric } from '@/lib/fold';
import { Canvas, SectionHeader } from './_layout';
import { EventCard } from '@/components/EventCard';
import { Stat, Eyebrow, Pill, EmptyState } from '@/components/primitives';
import { formatNum, formatUsd } from '@/lib/format';

export function ConferenceView() {
  const events = useEngagementEvents();

  const prs = useMemo(() => latestArtifactByRef(artifactsOfKind(events, 'pr')), [events]);
  const report = useMemo(() => artifactsOfKind(events, 'report').at(-1) ?? null, [events]);
  const series = useMemo(() => foldMetricSeries(events, 'agent_time_horizon'), [events]);
  const cost = useMemo(() => latestMetric(events, 'engagement_cost'), [events]);

  const before = series.find((s) => /base/i.test(s.label))?.latest;
  const after = series.find((s) => !/base/i.test(s.label))?.latest;

  return (
    <Canvas>
      <SectionHeader
        eyebrow="Deliverables"
        title="The Conference"
        right={prs.length > 0 ? <Pill tone="good">{prs.length} PR live</Pill> : undefined}
      />

      {/* before / after strip */}
      <div className="hairline-card mb-6 flex flex-wrap items-center gap-x-12 gap-y-4 p-5">
        <Stat label="Time horizon · before" value={<>{before != null ? formatNum(before, 1) : '—'}<span className="ml-1 text-base font-normal text-ink-3">d</span></>} />
        <div className="text-xl text-ink-3">→</div>
        <Stat
          label="Time horizon · after"
          accent
          value={<>{after != null ? formatNum(after, 1) : '—'}<span className="ml-1 text-base font-normal text-ink-3">d</span></>}
          sub={before != null && after != null ? `+${formatNum(after - before, 1)} days` : undefined}
        />
        {cost && (
          <Stat label="Engagement cost" value={formatUsd(cost.value)} sub="terra + luna" />
        )}
      </div>

      {/* PRs */}
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

      {/* report */}
      <SectionHeader eyebrow="Report" title="Engagement write-up" />
      {report ? (
        <article className="hairline-card animate-fade-slide-in p-6">
          <Eyebrow>{report.payload.kind}</Eyebrow>
          <h3 className="mt-1 text-lg font-semibold tracking-tight text-ink">{report.payload.title}</h3>
          {report.payload.body && (
            <div className="prose mt-3 max-w-none whitespace-pre-line text-[0.875rem] leading-relaxed text-ink-2">
              {report.payload.body}
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
