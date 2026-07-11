/**
 * Header — engagement title, live status pill, running cost ticker, token count.
 * All values fold from the visible event stream at the current cursor.
 */
import { useEngagement, useReplay } from '@/state/hooks';
import { inferPhase } from '@/lib/fold';
import { formatTokens } from '@/lib/format';
import { CostTicker } from './CostTicker';

export function Header({ title, subtitle }: { title: string; subtitle: string }) {
  const { events, engagementTotals } = useEngagement();
  const r = useReplay();
  const phase = inferPhase(events);
  const live = r.playing && !r.atEnd;

  return (
    <header className="flex items-center justify-between border-b border-hairline bg-surface/80 px-6 py-3.5 backdrop-blur">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <h1 className="truncate text-[0.9375rem] font-semibold tracking-tight text-ink">{title}</h1>
          <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-[0.625rem] font-medium text-ink-2">{phase}</span>
        </div>
        <p className="mt-0.5 truncate text-xs text-ink-3">{subtitle}</p>
      </div>

      <div className="flex items-center gap-6">
        {/* status pill */}
        <div className="flex items-center gap-2 rounded-pill border border-hairline bg-surface-2 px-3 py-1.5">
          <span className="relative flex h-2 w-2">
            {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--good)] opacity-60" />}
            <span
              className="relative inline-flex h-2 w-2 rounded-full"
              style={{ background: live ? 'var(--good)' : 'var(--ink-3)' }}
            />
          </span>
          <span className="text-xs font-medium text-ink-2">{live ? 'Live · replaying' : r.atEnd ? 'Complete' : 'Paused'}</span>
        </div>

        {/* tokens */}
        <div className="hidden flex-col items-end md:flex">
          <span className="eyebrow">Tokens</span>
          <span className="tnum text-sm font-medium text-ink">{formatTokens(engagementTotals.tokens)}</span>
        </div>

        {/* cost ticker */}
        <div className="flex flex-col items-end">
          <span className="eyebrow">Engagement cost</span>
          <CostTicker value={engagementTotals.costUsd} />
        </div>
      </div>
    </header>
  );
}
