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
import { CONVEX_URL } from './config';

export const convex: ConvexReactClient | null = CONVEX_URL
  ? new ConvexReactClient(CONVEX_URL)
  : null;
