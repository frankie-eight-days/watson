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
  const reports = useMemo(() => artifactsOfKind(events, 'report'), [events]);
  // The podcast announces itself as a report artifact titled 'podcast' whose body
  // is the MP3 URL; the written report is any other report artifact.
  const podcast = useMemo(() => reports.find((r) => /podcast/i.test(r.payload.title)) ?? null, [reports]);
  const podcastUrl = (podcast?.payload.body ?? podcast?.payload.url ?? '').trim();
  const report = useMemo(() => reports.filter((r) => r !== podcast).at(-1) ?? null, [reports, podcast]);
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
      <div data-tour="conference" className="hairline-card mb-6 flex flex-wrap items-center gap-x-12 gap-y-4 p-5">
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

      {/* podcast — only when the pipeline has emitted the report/podcast artifact */}
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
