/**
 * config.ts — the ONE swap seam.
 *
 * Watson's UI renders identically whether events come from the offline fixture
 * or a live Convex deployment. The active source is resolved once at boot:
 *
 *   1. `?source=fixture` / `?source=convex` in the URL   (demo insurance — no rebuild)
 *   2. VITE_EVENT_SOURCE at build time
 *   3. default: 'convex' when VITE_CONVEX_URL is set, else 'fixture'
 *
 * For the demo, appending `?source=fixture` to the deployed URL instantly falls
 * back to the frozen fixture through the identical render path.
 */
// Bundled fixtures (raw) — the demo engagement id is DERIVED from whichever one
// is active, so swapping the JSONL never desyncs the id again.
import mockRaw from '@fixtures/mock-engagement.jsonl?raw';
import demoRaw from '@fixtures/demo-run.jsonl?raw';

export type EventSourceKind = 'fixture' | 'convex';

/**
 * DEMO_LOCKED — the isolated presentation build (VITE_DEMO_LOCKED=1, deployed as
 * `watson-demo`). It reads ONLY the bundled demo fixture (no live Convex, so it
 * can never surface test/junk engagements), hides the source toggle + engagement
 * switcher, and locks to the single demo engagement — while keeping the ReplayBar
 * scrubber (it's a recorded run; scrubbing is the point).
 */
export const DEMO_LOCKED: boolean = import.meta.env.VITE_DEMO_LOCKED === '1';

/**
 * AUTO_TOUR — captured at module load (before the router runs any redirect that
 * would drop the query), so the marketing-site CTA `?tour=1` reliably auto-starts
 * the guided tour on the demo mirror.
 */
export const AUTO_TOUR: boolean = (() => {
  if (!DEMO_LOCKED || typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('tour') === '1';
  } catch {
    return false;
  }
})();

/** The Convex deployment URL, read from Vite env when running live. */
export const CONVEX_URL: string | undefined = import.meta.env.VITE_CONVEX_URL;

function resolveSource(): EventSourceKind {
  if (DEMO_LOCKED) return 'fixture';
  if (typeof window !== 'undefined') {
    const q = new URLSearchParams(window.location.search).get('source');
    if (q === 'fixture' || q === 'convex') return q;
  }
  const env = import.meta.env.VITE_EVENT_SOURCE;
  if (env === 'fixture' || env === 'convex') return env;
  return CONVEX_URL ? 'convex' : 'fixture';
}

// ▼▼▼ THE SWAP SEAM — resolved from URL param → env → CONVEX_URL presence. ▼▼▼
export const EVENT_SOURCE: EventSourceKind = resolveSource();
// ▲▲▲

/** The engagementId of a fixture's first event (future-proofs id swaps). */
function firstEngagementId(raw: string, fallback: string): string {
  try {
    const line = raw.split('\n').find((l) => l.trim().length > 0);
    if (!line) return fallback;
    const id = (JSON.parse(line) as { engagementId?: string }).engagementId;
    return typeof id === 'string' && id ? id : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Default engagement the switcher opens on. In the locked demo mirror it is the
 * bundled demo-run.jsonl's engagement; otherwise the mock fixture's (which is
 * also the Convex demo engagement). Derived from the fixture so replacing the
 * JSONL never desyncs the id.
 */
export const DEFAULT_ENGAGEMENT_ID: string = DEMO_LOCKED
  ? firstEngagementId(demoRaw, 'eng_demo')
  : firstEngagementId(mockRaw, 'eng_vb_001');

/**
 * The hand-authored demo engagement(s) — shown only when "Demo replay" is on and
 * always labeled DEMO so fixture data is never mistaken for a live run. Every
 * OTHER engagement (probes, anything the brain creates) is live.
 */
export const DEMO_ENGAGEMENT_IDS: readonly string[] = [DEFAULT_ENGAGEMENT_ID];
export const isDemoEngagement = (id: string) => DEMO_ENGAGEMENT_IDS.includes(id);

/** Soft engagement-cost threshold ($). Crossing it raises the alert banner. */
export const COST_ALERT_USD = 5;

/** The brain (Tab B) WebSocket + HTTP endpoints for the Bench view. */
export const BRAIN_WS_BASE: string =
  import.meta.env.VITE_BRAIN_WS ?? 'wss://watson-brain.frankkevinwalsh.workers.dev';
export const BRAIN_HTTP_BASE: string =
  import.meta.env.VITE_BRAIN_HTTP ?? 'https://watson-brain.frankkevinwalsh.workers.dev';

/**
 * Replay timing: the auto-play cursor advances by each event's real inter-event
 * `ts` gap divided by the active speed multiplier. These bounds keep long real
 * gaps from stalling the demo and same-`ts` bursts from flashing past.
 */
export const REPLAY = {
  /** Speed multipliers offered by the ReplayBar. Default is the middle one. */
  speeds: [1, 5, 15, 30] as const,
  defaultSpeed: 15,
  /** Floor on the delay between two events (ms) so bursts still animate. */
  minStepMs: 45,
  /** Ceiling on a single inter-event delay (ms) so we never stall. */
  maxStepMs: 1400,
};
