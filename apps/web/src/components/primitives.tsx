/**
 * primitives.tsx — small shared UI atoms built on the design tokens.
 */
import type { ReactNode } from 'react';
import type { AgentStatus, AgentTier } from '@watson/shared';
import { STATUS_META } from '@/lib/fold';

/** A status dot colored by agent lifecycle status; pulses while running. */
export function StatusDot({ status, size = 8 }: { status: AgentStatus; size?: number }) {
  const meta = STATUS_META[status];
  return (
    <span
      className="relative inline-flex shrink-0 rounded-full"
      style={{ width: size, height: size, background: meta.token }}
      title={meta.label}
      aria-label={meta.label}
    >
      {status === 'running' && (
        <span
          className="absolute inset-0 rounded-full animate-pulse-soft"
          style={{ background: meta.token }}
        />
      )}
    </span>
  );
}

const TIER_STYLE: Record<AgentTier, { label: string; cls: string }> = {
  hermes: { label: 'Hermes', cls: 'text-accent-ink bg-accent-soft' },
  orchestrator: { label: 'Orchestrator', cls: 'text-ink-2 bg-surface-2' },
  worker: { label: 'Worker', cls: 'text-ink-3 bg-surface-2' },
};

/** A small tier chip (hermes / orchestrator / worker). */
export function TierBadge({ tier }: { tier: AgentTier }) {
  const t = TIER_STYLE[tier];
  return (
    <span
      className={`rounded-pill px-1.5 py-0.5 text-[0.625rem] font-medium tracking-wide ${t.cls}`}
    >
      {t.label}
    </span>
  );
}

type PillTone = 'neutral' | 'accent' | 'good' | 'warning' | 'critical';
const PILL_TONE: Record<PillTone, string> = {
  neutral: 'text-ink-2 bg-surface-2 border-transparent',
  accent: 'text-accent-ink bg-accent-soft border-transparent',
  good: 'text-[color:var(--good)] border-transparent',
  warning: 'text-[color:var(--warning)] border-transparent',
  critical: 'text-[color:var(--critical)] border-transparent',
};
const PILL_SOFT: Partial<Record<PillTone, string>> = {
  good: 'var(--good-soft)',
  warning: 'var(--warning-soft)',
  critical: 'var(--critical-soft)',
};

export function Pill({
  tone = 'neutral',
  children,
  className = '',
}: {
  tone?: PillTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-xs font-medium ${PILL_TONE[tone]} ${className}`}
      style={PILL_SOFT[tone] ? { background: PILL_SOFT[tone] } : undefined}
    >
      {children}
    </span>
  );
}

/** An uppercase micro eyebrow label. */
export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`eyebrow ${className}`}>{children}</div>;
}

/** A labelled metric readout with tabular figures. */
export function Stat({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <Eyebrow>{label}</Eyebrow>
      <div
        className={`tnum text-2xl font-semibold leading-none ${accent ? 'text-accent-ink' : 'text-ink'}`}
      >
        {value}
      </div>
      {sub && <div className="tnum text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

/** An empty-state block that invites the next action rather than sitting blank. */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-1 px-6 text-center">
      <div className="h-8 w-8 rounded-full border border-dashed border-[color:var(--hairline-strong)]" />
      <div className="mt-2 text-sm font-medium text-ink-2">{title}</div>
      {hint && <div className="max-w-xs text-xs text-ink-3">{hint}</div>}
    </div>
  );
}
