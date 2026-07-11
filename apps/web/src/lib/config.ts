/**
 * config.ts — the ONE swap seam.
 *
 * Watson's UI renders identically whether events come from the offline fixture
 * or a live Convex deployment. To go live, flip EVENT_SOURCE from 'fixture' to
 * 'convex' (and set VITE_CONVEX_URL). That is the single line to change.
 *
 * Tab A owns the Convex query/HTTP names; until they exist, 'fixture' is the
 * only active path and the app runs fully offline.
 */
export type EventSourceKind = 'fixture' | 'convex';

// ▼▼▼ THE SWAP SEAM — flip to 'convex' when Tab A's deployment is live. ▼▼▼
export const EVENT_SOURCE: EventSourceKind = 'fixture';
// ▲▲▲

/** The Convex deployment URL, read from Vite env when running live. */
export const CONVEX_URL: string | undefined = import.meta.env.VITE_CONVEX_URL;

/** The only engagement in the fixture. The switcher control is built regardless. */
export const DEFAULT_ENGAGEMENT_ID = 'eng_vb_001';

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
