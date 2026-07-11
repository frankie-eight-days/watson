/**
 * AlertBanner — a slim observability banner surfaced purely from the event
 * stream (cursor-bound, so it also raises/clears during replay):
 *   (a) any `error` event on the active engagement (agent + one-line detail);
 *   (b) a cost spike — folded engagement cost over COST_ALERT_USD.
 * Click an alert to jump to the responsible agent's console feed. Dismissible;
 * a NEW error (higher seq) or the next dollar of cost re-raises it.
 */
import { useMemo, useState } from 'react';
import { isEventType } from '@watson/shared';
import { useEngagement } from '@/state/hooks';
import { COST_ALERT_USD } from '@/lib/config';
import { formatUsd } from '@/lib/format';

interface Alert {
  id: string;
  tone: 'critical' | 'warning';
  icon: string;
  label: string;
  detail: string;
  agentId: string | null;
}

export function AlertBanner({ onFocusAgent }: { onFocusAgent: (agentId: string) => void }) {
  const { events, engagementTotals, totals } = useEngagement();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const alerts = useMemo<Alert[]>(() => {
    const out: Alert[] = [];

    // (a) latest error event
    let lastError: (typeof events)[number] | undefined;
    for (const e of events) if (isEventType(e, 'error')) lastError = e;
    if (lastError && isEventType(lastError, 'error')) {
      out.push({
        id: `err_${lastError.seq}`,
        tone: lastError.payload.fatal ? 'critical' : 'warning',
        icon: lastError.payload.fatal ? '✗' : '⚠',
        label: lastError.payload.fatal ? 'Agent error' : 'Recovered error',
        detail: `${lastError.agentId} · ${lastError.payload.message}`,
        agentId: lastError.agentId,
      });
    }

    // (b) cost spike
    const cost = engagementTotals.costUsd;
    if (cost > COST_ALERT_USD) {
      // attribute to the highest-cost agent
      let topAgent: string | null = null;
      let topCost = -1;
      for (const [id, t] of totals) if (t.costUsd > topCost) ((topCost = t.costUsd), (topAgent = id));
      out.push({
        id: `cost_${Math.floor(cost)}`,
        tone: 'warning',
        icon: '$',
        label: 'Cost over threshold',
        detail: `${formatUsd(cost)} spent (soft cap ${formatUsd(COST_ALERT_USD)})${topAgent ? ` · top: ${topAgent}` : ''}`,
        agentId: topAgent,
      });
    }

    return out.filter((a) => !dismissed.has(a.id));
  }, [events, engagementTotals.costUsd, totals, dismissed]);

  if (alerts.length === 0) return null;

  return (
    <div className="flex shrink-0 flex-col">
      {alerts.map((a) => {
        const color = a.tone === 'critical' ? 'var(--critical)' : 'var(--warning)';
        const soft = a.tone === 'critical' ? 'var(--critical-soft)' : 'var(--warning-soft)';
        return (
          <div
            key={a.id}
            className="animate-fade-slide-in flex items-center gap-2.5 border-b px-4 py-1.5"
            style={{ background: soft, borderColor: 'var(--hairline)' }}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-bold text-white" style={{ background: color }}>
              {a.icon}
            </span>
            <span className="text-[0.75rem] font-semibold" style={{ color }}>
              {a.label}
            </span>
            <span className="min-w-0 flex-1 truncate text-[0.75rem] text-ink-2">{a.detail}</span>
            {a.agentId && (
              <button
                onClick={() => onFocusAgent(a.agentId!)}
                className="focus-ring shrink-0 rounded-md px-2 py-0.5 text-[0.6875rem] font-medium hover:bg-surface/60"
                style={{ color }}
              >
                View console →
              </button>
            )}
            <button
              onClick={() => setDismissed((s) => new Set(s).add(a.id))}
              className="focus-ring shrink-0 rounded p-0.5 text-ink-3 hover:text-ink"
              aria-label="Dismiss"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 2 L9 9 M9 2 L2 9" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
