/**
 * NavRail — left navigation: Watson wordmark, the five views with active state,
 * and an engagement switcher at the foot.
 */
import { NavLink } from 'react-router-dom';
import { useEngagement } from '@/state/hooks';
import { useSwitcher } from '@/state/switcher';
import { inferPhase } from '@/lib/fold';

interface ViewDef {
  to: string;
  label: string;
  hint: string;
  icon: JSX.Element;
}

const icon = (d: string) => (
  <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const VIEWS: ViewDef[] = [
  { to: '/bench', label: 'Bench', hint: 'Scope the engagement', icon: icon('M3 5h14M3 10h14M3 15h9') },
  { to: '/watercooler', label: 'Watercooler', hint: 'Read the repo', icon: icon('M10 2v7m0 0a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z') },
  { to: '/library', label: 'Library', hint: 'Paper pipeline', icon: icon('M4 4h5v12H4zM11 4h5v12h-5z') },
  { to: '/lab', label: 'Lab', hint: 'Run experiments', icon: icon('M8 2v5l-4 8a2 2 0 0 0 2 3h8a2 2 0 0 0 2-3l-4-8V2M7 2h6') },
  { to: '/conference', label: 'Conference', hint: 'Ship PRs & report', icon: icon('M3 4h14v9H3zM7 17h6M10 13v4') },
];

export function NavRail() {
  const { events, engagementTotals } = useEngagement();
  const { engagements, engagementId, setEngagementId } = useSwitcher();
  const phase = inferPhase(events);

  return (
    <nav className="flex w-[232px] shrink-0 flex-col border-r border-hairline bg-surface">
      {/* wordmark */}
      <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-accent text-white">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 5l3 10 4-8 4 8 3-10" />
          </svg>
        </div>
        <div>
          <div className="text-[0.9375rem] font-semibold leading-none tracking-tight text-ink">Watson</div>
          <div className="mt-0.5 text-[0.625rem] tracking-wide text-ink-3">research agency</div>
        </div>
      </div>

      <div className="mx-4 mb-2 border-t border-hairline" />

      {/* views */}
      <div className="flex flex-1 flex-col gap-0.5 px-3">
        {VIEWS.map((v) => (
          <NavLink
            key={v.to}
            to={v.to}
            className={({ isActive }) =>
              `focus-ring group flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors ${
                isActive ? 'bg-accent-soft text-accent-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={isActive ? 'text-accent-ink' : 'text-ink-3 group-hover:text-ink-2'}>
                  {v.icon}
                </span>
                <span className="flex-1">
                  <span className="block text-[0.8125rem] font-medium leading-tight">{v.label}</span>
                  <span className="block text-[0.625rem] leading-tight text-ink-3">{v.hint}</span>
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>

      {/* engagement switcher */}
      <div className="border-t border-hairline p-3">
        <label className="eyebrow mb-1.5 block px-1">Engagement</label>
        <div className="relative">
          <select
            value={engagementId}
            className="focus-ring w-full appearance-none rounded-lg border border-hairline bg-surface-2 py-2 pl-3 pr-8 text-[0.8125rem] font-medium text-ink"
            onChange={(e) => setEngagementId(e.target.value)}
          >
            {engagements.map((opt) => (
              <option key={opt.engagementId} value={opt.engagementId}>
                {opt.title}
              </option>
            ))}
          </select>
          <svg className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3" width="10" height="10" viewBox="0 0 10 10">
            <path d="M2 3.5 L5 6.5 L8 3.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="mt-2 flex items-center justify-between px-1">
          <span className="tnum text-[0.625rem] text-ink-3">{engagementTotals.eventCount} events</span>
          <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-[0.625rem] font-medium text-ink-2">{phase}</span>
        </div>
      </div>
    </nav>
  );
}
