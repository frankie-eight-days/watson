/**
 * ReplayBar — THE signature instrument. One scrubber over the engagement's seq
 * range: play/pause, speed (1x/5x/15x/30x), a draggable cursor, and a seq +
 * timestamp readout. It drives the SHARED cursor — the same one auto-play walks
 * and every component reads from. The track is annotated with artifact markers
 * so the timeline reads like a lab instrument, not a bare slider.
 */
import { useCallback, useEffect, useRef } from 'react';
import { REPLAY, DEMO_LOCKED } from '@/lib/config';
import { useEngagement, useReplay } from '@/state/hooks';
import { useAppMode } from '@/state/switcher';
import { formatClock, formatElapsed } from '@/lib/format';

const KIND_MARK: Record<string, string> = {
  dossier: 'var(--accent)',
  paper: 'var(--ink-3)',
  pitch: 'var(--warning)',
  experiment: 'var(--accent)',
  pr: 'var(--good)',
  report: 'var(--good)',
  card: 'var(--hairline-strong)',
};

export function ReplayBar() {
  const { allEvents } = useEngagement();
  const { showDemo, setShowDemo, isDemo } = useAppMode();
  const r = useReplay();
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const total = r.total;
  const ratio = total > 1 ? r.cursorIndex / (total - 1) : 0;

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el || total <= 1) return;
      const rect = el.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      r.seekIndex(Math.round(p * (total - 1)));
    },
    [r, total],
  );

  useEffect(() => {
    const move = (e: PointerEvent) => dragging.current && seekFromClientX(e.clientX);
    const up = () => (dragging.current = false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [seekFromClientX]);

  const markers = allEvents
    .map((e, i) => (e.type === 'artifact' ? { i, kind: (e.payload as { kind: string }).kind } : null))
    .filter((m): m is { i: number; kind: string } => m !== null);

  const elapsed = r.currentTs && r.startTs ? r.currentTs - r.startTs : 0;

  const live = r.playing && !r.atEnd;
  const stateLabel = live ? 'Replaying' : r.atEnd ? 'Complete' : 'Paused';
  const stateColor = live ? 'var(--good)' : r.atEnd ? 'var(--ink-3)' : 'var(--warning)';

  return (
    <div className="flex items-center gap-3 border-t border-hairline bg-surface px-4 py-2.5">
      {/* demo-replay toggle (controls demo-engagement visibility; scrubber below
          works on ANY engagement). Hidden in the locked demo mirror — there the
          whole build is the recorded run, so a toggle would be meaningless. */}
      {!DEMO_LOCKED && (
        <button
          onClick={() => setShowDemo(!showDemo)}
          role="switch"
          aria-checked={showDemo}
          className="focus-ring flex shrink-0 items-center gap-2 rounded-pill border border-hairline bg-surface-2 py-1 pl-1.5 pr-2.5"
          title={showDemo ? 'Hide the demo engagement from the switcher' : 'Show the demo engagement'}
        >
          <span
            className="relative h-4 w-7 rounded-full transition-colors"
            style={{ background: showDemo ? 'var(--accent)' : 'var(--surface-3)' }}
          >
            <span
              className="absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-card transition-transform"
              style={{ left: 2, transform: showDemo ? 'translateX(12px)' : 'translateX(0)' }}
            />
          </span>
          <span className="whitespace-nowrap text-[0.6875rem] font-medium text-ink-2">Demo replay</span>
        </button>
      )}

      {isDemo && (
        <span className="hidden shrink-0 rounded-pill bg-[color:var(--warning-soft)] px-2 py-0.5 text-[0.5625rem] font-bold uppercase tracking-wider text-[color:var(--warning)] sm:block">
          {DEMO_LOCKED ? 'Recorded run' : 'Demo data · not live'}
        </span>
      )}

      <div className="hidden h-6 w-px bg-hairline md:block" />

      {/* transport */}
      <div className="flex items-center gap-1">
        <button
          onClick={r.toggle}
          className="focus-ring flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white transition-opacity hover:opacity-90"
          aria-label={r.playing ? 'Pause' : 'Play'}
        >
          {r.playing ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <rect x="2" y="1.5" width="3" height="9" rx="1" />
              <rect x="7" y="1.5" width="3" height="9" rx="1" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M2.5 1.5 L10 6 L2.5 10.5 Z" />
            </svg>
          )}
        </button>
        <button
          onClick={r.restart}
          className="focus-ring flex h-9 w-9 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          aria-label="Restart"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 7 a4 4 0 1 0 1.2 -2.8" strokeLinecap="round" />
            <path d="M2.5 2 v2.6 h2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* track */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="tnum w-14 shrink-0 text-right text-[0.6875rem] text-ink-3">
          {formatElapsed(elapsed)}
        </span>
        <div
          ref={trackRef}
          onPointerDown={(e) => {
            dragging.current = true;
            seekFromClientX(e.clientX);
          }}
          className="group relative h-8 flex-1 cursor-pointer"
        >
          {/* rail */}
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-surface-3" />
          {/* fill */}
          <div
            className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent"
            style={{ width: `${ratio * 100}%` }}
          />
          {/* artifact markers */}
          {markers.map((m) => (
            <span
              key={m.i}
              className="absolute top-1/2 h-2.5 w-[2px] -translate-y-1/2 rounded-full opacity-70"
              style={{
                left: `${total > 1 ? (m.i / (total - 1)) * 100 : 0}%`,
                background: KIND_MARK[m.kind] ?? 'var(--hairline-strong)',
              }}
              title={m.kind}
            />
          ))}
          {/* thumb */}
          <div
            className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-surface shadow-card transition-transform group-hover:scale-110"
            style={{ left: `${ratio * 100}%` }}
          />
        </div>
      </div>

      {/* readout */}
      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-1.5 rounded-pill border border-hairline bg-surface-2 px-2.5 py-1 lg:flex">
          <span className="relative flex h-1.5 w-1.5">
            {live && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: stateColor }} />
            )}
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: stateColor }} />
          </span>
          <span className="text-[0.6875rem] font-medium text-ink-2">{stateLabel}</span>
        </div>

        <div className="hidden flex-col items-end sm:flex">
          <span className="tnum text-xs font-medium text-ink">
            seq {r.cursorSeq} <span className="text-ink-3">/ {r.maxSeq}</span>
          </span>
          <span className="tnum text-[0.625rem] text-ink-3">{formatClock(r.currentTs)}</span>
        </div>

        {/* speed segmented control */}
        <div className="flex items-center rounded-lg border border-hairline bg-surface-2 p-0.5">
          {REPLAY.speeds.map((s) => (
            <button
              key={s}
              onClick={() => r.setSpeed(s)}
              className={`tnum rounded-md px-2 py-1 text-[0.6875rem] font-medium transition-colors ${
                r.speed === s ? 'bg-surface text-accent-ink shadow-card' : 'text-ink-3 hover:text-ink'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
