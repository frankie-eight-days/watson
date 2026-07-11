/**
 * eventSource.ts — the swap seam interface + its two implementations.
 *
 * An EngagementSource answers exactly one question: "what events exist (so far)
 * for this engagement?" It knows NOTHING about replay — the shared cursor
 * (state/EngagementProvider) is the single time mechanism and walks whatever
 * events the source delivers. That is what makes the fixture "live stream" and
 * the Convex live stream render through one identical path.
 *
 *   FixtureEventSource — parses the frozen JSONL once, delivers all 175 events.
 *   ConvexEventSource  — a typed stub wired to convex/react (NOT active yet).
 *
 * Swap between them with EVENT_SOURCE in config.ts.
 */
import type { WatsonEvent } from '@watson/shared';
// The fixture is imported as a raw asset (Vite ?raw) — single source of truth,
// never copied into this app. This is the offline event stream.
import fixtureRaw from '@fixtures/mock-engagement.jsonl?raw';

/** Callback receives the full, seq-sorted event set each time it grows. */
export type EventsCallback = (events: WatsonEvent[]) => void;

export interface EngagementSource {
  /**
   * Subscribe to the seq-sorted events for an engagement. `cb` fires once
   * immediately with everything known, then again whenever more arrive (live).
   * Returns an unsubscribe function.
   */
  subscribe(engagementId: string, cb: EventsCallback): () => void;
}

const bySeq = (a: WatsonEvent, b: WatsonEvent) => a.seq - b.seq;

/** Parse the fixture JSONL into a seq-sorted WatsonEvent[]. */
export function parseFixture(raw: string): WatsonEvent[] {
  return raw
    .trim()
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as WatsonEvent)
    .sort(bySeq);
}

/**
 * FixtureEventSource — offline. Delivers the whole recorded engagement at once;
 * the replay cursor produces the "comes alive on load" motion by walking it.
 */
export class FixtureEventSource implements EngagementSource {
  private readonly all: WatsonEvent[];

  constructor(raw: string = fixtureRaw) {
    this.all = parseFixture(raw);
  }

  subscribe(engagementId: string, cb: EventsCallback): () => void {
    const events = this.all.filter((e) => e.engagementId === engagementId);
    // Deliver on a microtask so subscribers can finish mounting first.
    queueMicrotask(() => cb(events));
    return () => {};
  }
}

/**
 * ConvexEventSource — LIVE (stub, not active). When Tab A's deployment exists,
 * this subscribes to the events table via the Convex browser client and pushes
 * the growing, seq-sorted list to `cb`. Query name is a placeholder Tab A owns.
 *
 * Intentionally decoupled from React so the EngagementSource interface stays
 * identical to the fixture. See state/EngagementProvider for where it's chosen.
 */
export class ConvexEventSource implements EngagementSource {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly client: any /* ConvexClient from convex/browser */) {}

  subscribe(engagementId: string, cb: EventsCallback): () => void {
    // ── Placeholder wiring — Tab A owns the real query name/args. ──
    // import { api } from '../../../../convex/_generated/api';
    // return this.client.onUpdate(
    //   api.events.byEngagement,            // <- Tab A's query (name TBD)
    //   { engagementId },
    //   (rows: WatsonEvent[]) => cb([...rows].sort(bySeq)),
    // );
    void this.client;
    void engagementId;
    void cb;
    throw new Error(
      'ConvexEventSource is not active yet. Set EVENT_SOURCE = "fixture" in config.ts. ' +
        'Tab A owns the Convex query names; wire them in subscribe() to go live.',
    );
  }
}
