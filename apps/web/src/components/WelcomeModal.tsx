/**
 * WelcomeModal — the demo mirror's first-load explainer (DEMO_LOCKED only).
 *
 * A judge should read it in ~10s. It overlays the CANVAS only (not the TopBar or
 * ReplayBar), so the replay controls are never blocked. Dismiss via X, the
 * primary button, click-outside, or Esc; first-load state is remembered in
 * localStorage and re-openable from the header "?".
 */
import { useEffect } from 'react';

const LIVE_URL = 'https://watson-web.frankkevinwalsh.workers.dev';

export function WelcomeModal({
  open,
  onClose,
  onTakeTour,
}: {
  open: boolean;
  onClose: () => void;
  onTakeTour: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center p-6"
      role="dialog"
      aria-modal="true"
      aria-label="About this demo"
    >
      {/* backdrop (canvas only) */}
      <div
        className="absolute inset-0 backdrop-blur-[2px]"
        style={{ background: 'rgba(22, 24, 31, 0.22)' }}
        onClick={onClose}
      />

      {/* card */}
      <div className="animate-fade-slide-in relative w-full max-w-md overflow-hidden rounded-2xl border border-hairline bg-surface shadow-lift">
        <button
          onClick={onClose}
          aria-label="Close"
          className="focus-ring absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M2.5 2.5 L10.5 10.5 M10.5 2.5 L2.5 10.5" />
          </svg>
        </button>

        <div className="px-6 pb-6 pt-7">
          <span className="inline-flex items-center gap-1.5 rounded-pill bg-[color:var(--warning-soft)] px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wider text-[color:var(--warning)]">
            ● Recorded run
          </span>

          <h2 className="mt-3 text-lg font-semibold tracking-tight text-ink">You're watching a replay</h2>
          <p className="mt-1.5 text-[0.875rem] leading-relaxed text-ink-2">
            A real engagement Watson executed end to end — it ingested a repo, read the latest papers,
            ran real benchmarks in cloud sandboxes, and opened a real PR.
          </p>

          <div className="mt-4 rounded-xl bg-surface-2 px-4 py-3">
            <div className="eyebrow mb-1 text-accent-ink">What Watson is</div>
            <p className="text-[0.8125rem] leading-relaxed text-ink-2">
              An AI research agency in the cloud: point it at your repo, it reads the latest papers,
              runs experiments, and ships PRs.
            </p>
          </div>

          <div className="mt-3 flex items-start gap-2 text-[0.8125rem] text-ink-3">
            <svg className="mt-0.5 shrink-0 text-ink-3" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 11h12M4 8l2 2M4 8v3M9 5l2 2M9 5v6" />
            </svg>
            <span>Use the timeline at the bottom to scrub the run.</span>
          </div>

          <p className="mt-3 text-[0.8125rem] text-ink-2">
            Want to run your own? The live app is at{' '}
            <a
              href={LIVE_URL}
              target="_blank"
              rel="noreferrer"
              className="focus-ring font-medium text-accent-ink underline decoration-[color:var(--accent-ring)] underline-offset-2 hover:decoration-accent"
            >
              watson-web.frankkevinwalsh.workers.dev
            </a>
          </p>

          <div className="mt-5 flex flex-col gap-2">
            <button
              onClick={onTakeTour}
              className="focus-ring w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold tracking-wide text-white transition-opacity hover:opacity-90"
            >
              Take the tour →
            </button>
            <button
              onClick={onClose}
              className="focus-ring w-full rounded-lg border border-hairline px-4 py-2 text-[0.8125rem] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              Skip, just replay
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
