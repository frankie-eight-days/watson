/**
 * TopBar — the app's single horizontal chrome: wordmark, the five workflow views
 * as a slim top nav, the engagement switcher (with a DEMO badge when the demo
 * engagement is selected), the inferred phase, and the running cost. Replaces the
 * old left rail + header to reclaim vertical space on small screens.
 */
import { NavLink } from 'react-router-dom';
import { useEngagement } from '@/state/hooks';
import { useAppMode } from '@/state/switcher';
import { inferPhase } from '@/lib/fold';
import { CostTicker } from './CostTicker';

const icon = (d: string) => (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const VIEWS = [
  { to: '/bench', label: 'Bench', icon: icon('M3 5h14M3 10h14M3 15h9') },
  { to: '/watercooler', label: 'Watercooler', icon: icon('M10 2v7m0 0a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z') },
  { to: '/library', label: 'Library', icon: icon('M4 4h5v12H4zM11 4h5v12h-5z') },
  { to: '/lab', label: 'Lab', icon: icon('M8 2v5l-4 8a2 2 0 0 0 2 3h8a2 2 0 0 0 2-3l-4-8V2M7 2h6') },
  { to: '/conference', label: 'Conference', icon: icon('M3 4h14v9H3zM7 17h6M10 13v4') },
];

export function TopBar() {
  const { events, engagementTotals } = useEngagement();
  const { options, engagementId, setEngagementId, isDemo } = useAppMode();
  const phase = inferPhase(events);

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-hairline bg-surface/85 px-4 backdrop-blur">
      {/* wordmark */}
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-accent text-white">
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 5l3 10 4-8 4 8 3-10" />
          </svg>
        </div>
        <span className="hidden text-[0.9375rem] font-semibold tracking-tight text-ink sm:block">Watson</span>
      </div>

      <div className="hidden h-6 w-px bg-hairline lg:block" />

      {/* workflow nav */}
      <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
        {VIEWS.map((v) => (
          <NavLink
            key={v.to}
            to={v.to}
            className={({ isActive }) =>
              `focus-ring flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[0.8125rem] font-medium transition-colors ${
                isActive ? 'bg-accent-soft text-accent-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={isActive ? 'text-accent-ink' : 'text-ink-3'}>{v.icon}</span>
                <span className="hidden md:block">{v.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-3">
        {/* engagement switcher */}
        <div className="flex items-center gap-1.5">
          {isDemo && (
            <span className="rounded-pill bg-[color:var(--warning-soft)] px-1.5 py-0.5 text-[0.5625rem] font-bold uppercase tracking-wider text-[color:var(--warning)]">
              Demo
            </span>
          )}
          <div className="relative">
            <select
              value={engagementId}
              onChange={(e) => setEngagementId(e.target.value)}
              className="focus-ring max-w-[190px] appearance-none truncate rounded-lg border border-hairline bg-surface-2 py-1.5 pl-2.5 pr-7 text-[0.8125rem] font-medium text-ink"
            >
              {options.length === 0 ? (
                <option value="">No live engagements</option>
              ) : (
                options.map((opt) => (
                  <option key={opt.engagementId} value={opt.engagementId}>
                    {opt.demo ? '◆ ' : ''}
                    {opt.title}
                  </option>
                ))
              )}
            </select>
            <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-3" width="9" height="9" viewBox="0 0 10 10">
              <path d="M2 3.5 L5 6.5 L8 3.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        <span className="hidden rounded-pill bg-surface-2 px-2 py-0.5 text-[0.625rem] font-medium text-ink-2 lg:block">
          {phase}
        </span>

        {/* running cost */}
        <div className="hidden flex-col items-end sm:flex">
          <span className="eyebrow leading-none">Cost</span>
          <CostTicker value={engagementTotals.costUsd} />
        </div>
      </div>
    </header>
  );
}
