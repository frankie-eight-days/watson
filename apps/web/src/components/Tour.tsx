/**
 * Tour — a vanilla-React guided spotlight (no tour libraries; CSP-safe). It dims
 * the page except a highlighted target (SVG-mask cutout + accent ring), shows a
 * coach-card near it, and AUTO-NAVIGATES between views so a judge sees every
 * surface. On start it seeks the replay to the end so each view is fully
 * populated. DEMO_LOCKED-only; makes no network calls.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useReplay } from '@/state/hooks';

interface TourStep {
  route: string;
  selector: string;
  title: string;
  body: string;
}

const STEPS: TourStep[] = [
  {
    route: '/bench',
    selector: '[data-tour="bench"]',
    title: 'The Bench',
    body: 'Brief Hermes, the agency’s president. Point it at your repo and say the word.',
  },
  {
    route: '/watercooler',
    selector: '[data-tour="watercooler"]',
    title: 'The Watercooler',
    body: 'Hermes dispatches a team to ingest your repo and find the real weakness.',
  },
  {
    route: '/library',
    selector: '[data-tour="library"]',
    title: 'The Library',
    body: 'It reads the latest papers across the web + arXiv (Linkup + Exa) and ranks concrete pitches.',
  },
  {
    route: '/lab',
    selector: '[data-tour="lab"]',
    title: 'The Lab',
    body: 'It writes real code and runs real 30-day benchmarks in cloud sandboxes. This is the result.',
  },
  {
    route: '/conference',
    selector: '[data-tour="conference"]',
    title: 'The Conference',
    body: 'It ships a real PR to your repo, plus a written report and a podcast.',
  },
  {
    route: '/lab',
    selector: '[data-tour="replay"]',
    title: 'Replay the whole run',
    body: 'Scrub the entire recorded engagement here anytime.',
  },
];

const PAD = 6;
const CARD_W = 340;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function Tour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const r = useReplay();
  const [rect, setRect] = useState<Rect | null>(null);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(190);

  const step = STEPS[i];
  const atEnd = i === STEPS.length - 1;

  // Reset to step 0 each time the tour opens.
  useEffect(() => {
    if (open) setI(0);
  }, [open]);

  // Seek replay to the end so every view is fully populated as the judge is
  // guided through it (re-runs once the fixture finishes loading).
  useEffect(() => {
    if (open && r.total > 0) r.seekIndex(r.total - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, r.total]);

  // Navigate to the step's view.
  useEffect(() => {
    if (!open) return;
    if (pathname !== step.route) navigate(step.route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, open]);

  // Locate the target once its view has mounted (poll a few frames).
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    let tries = 0;
    const find = () => {
      const el = document.querySelector(step.selector) as HTMLElement | null;
      if (el) {
        const b = el.getBoundingClientRect();
        setRect({ x: b.x, y: b.y, w: b.width, h: b.height });
      } else if (tries++ < 120) {
        raf = requestAnimationFrame(find);
      } else {
        setRect(null);
      }
    };
    find();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, open, pathname]);

  // Keep the cutout aligned on resize / layout drift.
  useEffect(() => {
    if (!open) return;
    const update = () => {
      setVp({ w: window.innerWidth, h: window.innerHeight });
      const el = document.querySelector(step.selector) as HTMLElement | null;
      if (el) {
        const b = el.getBoundingClientRect();
        setRect({ x: b.x, y: b.y, w: b.width, h: b.height });
      }
    };
    window.addEventListener('resize', update);
    const id = window.setInterval(update, 400);
    return () => {
      window.removeEventListener('resize', update);
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, open]);

  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [i, rect]);

  // Keyboard: Esc skips, arrows step.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') setI((n) => Math.min(n + 1, STEPS.length - 1));
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(n - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const hole = rect
    ? {
        x: clamp(rect.x - PAD, 0, vp.w),
        y: clamp(rect.y - PAD, 0, vp.h),
        w: Math.min(rect.w + PAD * 2, vp.w),
        h: Math.min(rect.h + PAD * 2, vp.h),
      }
    : null;

  // Coach-card placement: below the target, else above, else centered.
  let cardTop: number;
  let cardLeft: number;
  const M = 14;
  if (hole) {
    const below = hole.y + hole.h + M;
    const above = hole.y - cardH - M;
    cardTop = below + cardH + M <= vp.h ? below : above >= 8 ? above : clamp(hole.y, M, vp.h - cardH - M);
    cardLeft = clamp(hole.x + hole.w / 2 - CARD_W / 2, M, vp.w - CARD_W - M);
  } else {
    cardTop = vp.h / 2 - cardH / 2;
    cardLeft = vp.w / 2 - CARD_W / 2;
  }

  const next = () => (atEnd ? onClose() : setI((n) => n + 1));
  const back = () => setI((n) => Math.max(0, n - 1));

  return (
    <div className="fixed inset-0 z-[60]" aria-live="polite">
      {/* scrim with spotlight cutout */}
      <svg width={vp.w} height={vp.h} className="block">
        <defs>
          <mask id="watson-tour-hole">
            <rect x={0} y={0} width={vp.w} height={vp.h} fill="white" />
            {hole && (
              <rect
                x={hole.x}
                y={hole.y}
                width={hole.w}
                height={hole.h}
                rx={12}
                fill="black"
                style={{ transition: 'x .32s ease, y .32s ease, width .32s ease, height .32s ease' }}
              />
            )}
          </mask>
        </defs>
        <rect x={0} y={0} width={vp.w} height={vp.h} fill="rgba(15,17,22,0.55)" mask="url(#watson-tour-hole)" />
        {hole && (
          <rect
            x={hole.x}
            y={hole.y}
            width={hole.w}
            height={hole.h}
            rx={12}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
            style={{ transition: 'x .32s ease, y .32s ease, width .32s ease, height .32s ease' }}
          />
        )}
      </svg>

      {/* coach card */}
      <div
        key={i}
        ref={cardRef}
        className="animate-fade-slide-in absolute w-[340px] rounded-2xl border border-hairline bg-surface p-4 shadow-lift"
        style={{ top: cardTop, left: cardLeft, transition: 'top .3s ease, left .3s ease' }}
      >
        <div className="mb-1.5 flex items-center justify-between">
          <span className="tnum text-[0.6875rem] font-semibold text-ink-3">
            {i + 1} / {STEPS.length}
          </span>
          <button
            onClick={onClose}
            className="focus-ring text-[0.6875rem] font-medium text-ink-3 hover:text-ink"
          >
            Skip tour
          </button>
        </div>
        <h3 className="text-[0.9375rem] font-semibold tracking-tight text-ink">{step.title}</h3>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-2">{step.body}</p>

        {/* progress dots */}
        <div className="mt-3 flex items-center gap-1.5">
          {STEPS.map((_, n) => (
            <span
              key={n}
              className="h-1 rounded-full transition-all"
              style={{
                width: n === i ? 16 : 6,
                background: n === i ? 'var(--accent)' : 'var(--hairline-strong)',
              }}
            />
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between">
          <button
            onClick={back}
            disabled={i === 0}
            className="focus-ring rounded-lg px-3 py-1.5 text-[0.8125rem] font-medium text-ink-2 hover:bg-surface-2 disabled:opacity-40"
          >
            Back
          </button>
          <button
            onClick={next}
            className="focus-ring rounded-lg bg-accent px-4 py-1.5 text-[0.8125rem] font-semibold text-white transition-opacity hover:opacity-90"
          >
            {atEnd ? 'Start exploring' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  );
}
