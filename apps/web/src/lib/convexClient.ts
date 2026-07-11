/**
 * convexClient.ts — the single Convex browser client (a reactive websocket).
 *
 * Created once when VITE_CONVEX_URL is present, shared by both the event stream
 * (EngagementProvider → ConvexEventSource, via watchQuery) and the engagement
 * switcher (ConvexProvider → useQuery). One socket, two consumers.
 *
 * `null` in pure-offline builds (no CONVEX_URL) — the app then runs the fixture.
 */
import { ConvexReactClient } from 'convex/react';
import { CONVEX_URL, DEMO_LOCKED } from './config';

// Never connect to live Convex in the locked demo build — the mirror is
// fixture-only and must never surface live/test engagements.
export const convex: ConvexReactClient | null =
  !DEMO_LOCKED && CONVEX_URL ? new ConvexReactClient(CONVEX_URL) : null;
