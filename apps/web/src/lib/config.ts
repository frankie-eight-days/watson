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
 * back to the frozen 175-event fixture through the identical render path.
 */
export type EventSourceKind = 'fixture' | 'convex';

/** The Convex deployment URL, read from Vite env when running live. */
export const CONVEX_URL: string | undefined = import.meta.env.VITE_CONVEX_URL;

function resolveSource(): EventSourceKind {
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

/** Default engagement the switcher opens on (the fixture engagement). */
export const DEFAULT_ENGAGEMENT_ID = 'eng_vb_001';

/**
 * The hand-authored demo engagement(s) — shown only when "Demo replay" is on and
 * always labeled DEMO so fixture data is never mistaken for a live run. Every
 * OTHER engagement (probes, anything the brain creates) is live. One list so a
 * second demo can be added in one place.
 */
export const DEMO_ENGAGEMENT_IDS: readonly string[] = ['eng_vb_001'];
export const isDemoEngagement = (id: string) => DEMO_ENGAGEMENT_IDS.includes(id);

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
