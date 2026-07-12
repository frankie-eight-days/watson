/**
 * Tour — a vanilla-React guided spotlight (no tour libraries; CSP-safe). It dims
 * the page except a highlighted target (SVG-mask cutout + accent ring), shows a
 * coach-card near it, and AUTO-NAVIGATES between views so a judge sees every
 * surface.
 *
 * The key move: each step SCRUBS the shared replay cursor to a point where its
 * phase is ACTIVELY IN FLIGHT — so the judge watches it happening, not a finished
 * view. Target positions are computed GENERICALLY from the event stream (hermes
 * `status` events whose detail is `phase: <name>`), so they survive fixture swaps.
 * When no phase markers exist we fall back to proportional fractions of the run.
 * DEMO_LOCKED-only; makes no network calls.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { WatsonEvent } from '@watson/shared';
import { useEngagement, useReplay } from '@/state/hooks';

interface SeekCtx {
  total: number;
  /** Array index of a phase's first hermes `status` marker, or undefined. */
  phaseStart: (name: string) => number | undefined;
  /** Index at `frac` through a phase's [start, next-start) range, or undefined. */
  phaseFrac: (name: string, frac: number) => number | undefined;
  /** Proportional index of the whole run (fixtures with no phase markers). */
  fallback: (frac: number) => number;
}

interface EffectCtx {
  allEvents: WatsonEvent[];
  targetIndex: number;
  focusAgent?: (agentId: string) => void;
}

interface TourStep {
  route: string;
  selector: string;
  title: string;
  body: string;
  /** Where to scrub the cursor for this step (an index into the event array). */
  seek: (ctx: SeekCtx) => number;
  /** Optional side effect after the seek (e.g. select an agent + open console). */
  effect?: (ctx: EffectCtx) => void;
}

const STEPS: TourStep[] = [
  {
    route: '/bench',
    selector: '[data-tour="bench"]',
    title: 'Point Watson at a repo',
    body: 'Every engagement starts here — the Target Repository field is where you hand Hermes, the agency’s president, a codebase to improve.',
    seek: (c) => (c.phaseStart('watercooler') ?? c.fallback(0.03)) + 3,
  },
  {
    route: '/bench',
    selector: '[data-tour="bench-terminal"]',
    title: 'The Hermes terminal',
    body: 'You talk to Hermes here to scope the brief. During a run this terminal streams the president’s working live — every spawn, thought and tool call.',
    seek: (c) => c.phaseFrac('watercooler', 0.4) ?? c.fallback(0.12),
  },
  {
    route: '/watercooler',
    selector: '[data-tour="watercooler"]',
    title: 'The Watercooler',
    body: 'The crew ingests the repo and converges on a dossier that names the exact weakness worth attacking.',
    seek: (c) => c.phaseFrac('watercooler', 0.65) ?? c.fallback(0.2),
  },
  {
    route: '/library',
    selector: '[data-tour="library"]',
    title: 'The Library',
    body: 'Watson reads the latest papers across the web and arXiv, grades their relevance live, and distills them into three concrete pitches.',
    seek: (c) => c.phaseFrac('library', 0.65) ?? c.fallback(0.42),
  },
  {
    route: '/lab',
    selector: '[data-tour="lab"]',
    title: 'The Lab',
    body: 'It writes real code and runs real 30-day benchmarks in cloud sandboxes — watch the chart race the baseline against each candidate, day by day.',
    seek: (c) => c.phaseFrac('lab', 0.65) ?? c.fallback(0.72),
  },
  {
    route: '/lab',
    selector: '[data-tour="console"]',
    title: 'Steer any agent',
    body: 'This isn’t just a replay surface. In a live run you click any agent in the org chart, inspect its console, and type here to redirect its plan mid-run.',
    seek: (c) => c.phaseFrac('lab', 0.65) ?? c.fallback(0.72),
    effect: ({ allEvents, targetIndex, focusAgent }) => {
      for (let k = Math.min(targetIndex, allEvents.length - 1); k >= 0; k--) {
        const id = allEvents[k]?.agentId;
        if (id && id !== 'hermes') {
          focusAgent?.(id);
          break;
        }
      }
    },
  },
  {
    route: '/conference',
    selector: '[data-tour="conference"]',
    title: 'The results',
    body: 'The verdict: $634.50 → $949 (+49%) over a fair baseline — with the three hypotheses compared head-to-head just below.',
    seek: (c) => c.total - 1,
  },
  {
    route: '/conference',
    selector: '[data-tour="conference-prs"]',
    title: 'Real pull requests',
    body: 'Two real PRs opened on your actual repo, plus a written report. Watson ships working code, not just advice.',
    seek: (c) => c.total - 1,
  },
  {
    route: '/lab',
    selector: '[data-tour="replay"]',
    title: 'Replay the whole run',
    body: 'Scrub the entire recorded engagement here anytime, or replay it from the top.',
    seek: (c) => c.total - 1,
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

export function Tour({
  open,
  onClose,
  focusAgent,
}: {
  open: boolean;
  onClose: () => void;
  focusAgent?: (agentId: string) => void;
}) {
  const [i, setI] = useState(0);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { allEvents } = useEngagement();
  const r = useReplay();
  const [rect, setRect] = useState<Rect | null>(null);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(190);

  const step = STEPS[i];
  const atEnd = i === STEPS.length - 1;

  // Phase markers → a generic seek context (survives fixture swaps).
  const seekCtx = useMemo<SeekCtx>(() => {
    const total = allEvents.length;
    const phases: { name: string; index: number }[] = [];
    allEvents.forEach((e, idx) => {
      if (e.type === 'status' && e.agentId === 'hermes') {
        const m = /^phase:\s*(\w+)/.exec((e.payload as { detail?: string }).detail ?? '');
        if (m) phases.push({ name: m[1], index: idx });
      }
    });
    const startOf = (name: string) => phases.find((p) => p.name === name)?.index;
    const nextOf = (name: string) => {
      const k = phases.findIndex((p) => p.name === name);
      return k < 0 ? undefined : phases[k + 1]?.index ?? Math.max(0, total - 1);
    };
    return {
      total,
      phaseStart: startOf,
      phaseFrac: (name, frac) => {
        const s = startOf(name);
        if (s == null) return undefined;
        const n = nextOf(name) ?? total - 1;
        return Math.round(s + frac * (n - s));
      },
      fallback: (frac) => Math.round(frac * Math.max(0, total - 1)),
    };
  }, [allEvents]);

  const targetIndex = useMemo(() => {
    if (seekCtx.total === 0) return 0;
    return clamp(Math.round(step.seek(seekCtx)), 0, seekCtx.total - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, seekCtx]);

  // Close/finish → land the judge on the fully populated end state.
  const finish = () => {
    if (r.total > 0) r.seekIndex(r.total - 1);
    onClose();
  };

  // Reset to step 0 each time the tour opens.
  useEffect(() => {
    if (open) setI(0);
  }, [open]);

  // Scrub the shared cursor to this step's target (re-runs on step change AND
  // once the fixture finishes loading — total flips from 0 to N).
  useEffect(() => {
    if (open && r.total > 0) r.seekIndex(targetIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, i, targetIndex, r.total]);

  // Run this step's side effect (e.g. focus a live agent + open its console).
  useEffect(() => {
    if (!open || r.total === 0) return;
    step.effect?.({ allEvents, targetIndex, focusAgent });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, i, targetIndex, r.total]);

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

  // Keyboard: arrows step. No Esc-to-dismiss — the judge goes through the tour.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setI((n) => Math.min(n + 1, STEPS.length - 1));
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(n - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  const next = () => (atEnd ? finish() : setI((n) => n + 1));
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
            {atEnd ? 'Explore the demo →' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  );
}
