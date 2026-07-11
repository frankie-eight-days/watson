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
import { makeFunctionReference } from 'convex/server';
import type { ConvexReactClient } from 'convex/react';
import type { WatsonEvent } from '@watson/shared';
// The fixture is imported as a raw asset (Vite ?raw) — single source of truth,
// never copied into this app. This is the offline event stream.
import fixtureRaw from '@fixtures/mock-engagement.jsonl?raw';

/**
 * The one live query the stream needs: an inclusive [startSeq, endSeq] window.
 * Referenced by string (`events:eventsWindow`) so we never import Convex's
 * generated server types into the web bundle. Tab A owns this query's shape.
 */
const eventsWindowRef = makeFunctionReference<'query'>('events:eventsWindow');
/** endSeq ceiling — the fixture has 175 events; any real run stays far below. */
const SEQ_CEILING = 1_000_000_000;

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
 * ConvexEventSource — LIVE. Subscribes to the engagement's event window via the
 * shared Convex reactive client and pushes the growing, seq-sorted list to `cb`.
 *
 * Uses `client.watchQuery(...)` (the non-hook reactive API) so this stays fully
 * decoupled from React — the EngagementSource interface is identical to the
 * fixture's, which is what makes "live stream" and "replay" render through one
 * path. The query re-runs reactively as Tab A/B insert new events; each re-run
 * delivers a fresh, complete, seq-sorted snapshot to the cursor.
 */
export class ConvexEventSource implements EngagementSource {
  constructor(private readonly client: ConvexReactClient) {}

  subscribe(engagementId: string, cb: EventsCallback): () => void {
    const watch = this.client.watchQuery(eventsWindowRef, {
      engagementId,
      startSeq: 0,
      endSeq: SEQ_CEILING,
    });
    const push = () => {
      const rows = watch.localQueryResult() as WatsonEvent[] | undefined;
      if (rows) cb([...rows].sort(bySeq));
    };
    const unsub = watch.onUpdate(push);
    push(); // deliver whatever is already cached immediately
    return unsub;
  }
}
