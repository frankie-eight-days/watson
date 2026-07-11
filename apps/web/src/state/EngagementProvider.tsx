/**
 * EngagementProvider — the single source of app state, all of it derived from
 * the event stream.
 *
 * THE CURSOR IS THE WHOLE MODEL. There is one cursor over the seq-sorted events.
 * When `playing`, it auto-advances using each event's real inter-event `ts` gap
 * (compressed by the active speed) — that produces the "comes alive on load"
 * live-stream feel. When you drag the ReplayBar, you move the same cursor. Every
 * component reads `events` = the events with seq <= cursor. "Live" and "replay"
 * are the same interaction.
 *
 * The event SOURCE (fixture vs Convex) is chosen by one line in config.ts.
 */
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AgentRecord, WatsonEvent } from '@watson/shared';
import {
  type EngagementSource,
  FixtureEventSource,
  ConvexEventSource,
} from '@/lib/eventSource';
import { convex } from '@/lib/convexClient';
import {
  buildAgentTree,
  foldAgents,
  foldAgentTotals,
  foldEngagementTotals,
  type AgentNode,
  type AgentTotals,
  type EngagementTotals,
} from '@/lib/fold';
import { EVENT_SOURCE, REPLAY } from '@/lib/config';

// ── Steering (local stub — Tab A/B own the real injection) ────────────────
export interface LocalSteering {
  id: string;
  agentId: string;
  text: string;
  ts: number;
}

export interface ReplayControls {
  playing: boolean;
  speed: number;
  /** Cursor position as an index into the seq-sorted event array. */
  cursorIndex: number;
  /** seq at the cursor (for readout). */
  cursorSeq: number;
  /** Total events available (the scrub range is [0, total-1]). */
  total: number;
  minSeq: number;
  maxSeq: number;
  startTs: number;
  currentTs: number;
  atEnd: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  restart: () => void;
  setSpeed: (s: number) => void;
  /** Scrub directly to an index (ReplayBar drag). */
  seekIndex: (i: number) => void;
}

export interface EngagementContextValue {
  engagementId: string;
  /** Events visible up to the cursor (seq-sorted). The ONLY thing views read. */
  events: WatsonEvent[];
  /** The full recorded stream (for the scrub range only — never for rendering). */
  allEvents: WatsonEvent[];
  loading: boolean;
  agents: AgentRecord[];
  agentTree: AgentNode[];
  totals: Map<string, AgentTotals>;
  engagementTotals: EngagementTotals;
  replay: ReplayControls;
  selectedAgentId: string | null;
  selectAgent: (id: string | null) => void;
  steering: LocalSteering[];
  sendSteering: (agentId: string, text: string) => void;
}

export const EngagementContext = createContext<EngagementContextValue | null>(null);

/** Pick the active event source. THIS is the fixture↔Convex swap. */
function makeSource(): EngagementSource {
  if (EVENT_SOURCE === 'convex') {
    if (!convex) {
      throw new Error(
        'Convex source selected but VITE_CONVEX_URL is unset. ' +
          'Set it, or append ?source=fixture to run the offline fixture.',
      );
    }
    return new ConvexEventSource(convex);
  }
  return new FixtureEventSource();
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function EngagementProvider({
  engagementId,
  children,
}: {
  engagementId: string;
  children: ReactNode;
}) {
  const [allEvents, setAllEvents] = useState<WatsonEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  // Tracks the last-seen event count so live appends can follow the tail.
  const prevTotalRef = useRef(0);
  const [speed, setSpeed] = useState<number>(REPLAY.defaultSpeed);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [steering, setSteering] = useState<LocalSteering[]>([]);

  const sourceRef = useRef<EngagementSource | null>(null);
  if (!sourceRef.current) sourceRef.current = makeSource();

  // Subscribe to the source (fixture delivers all events once).
  useEffect(() => {
    setLoading(true);
    const unsub = sourceRef.current!.subscribe(engagementId, (evs) => {
      setAllEvents(evs);
      setLoading(false);
    });
    return unsub;
  }, [engagementId]);

  const total = allEvents.length;
  const maxIndex = Math.max(0, total - 1);

  // ── Live follow: when Convex appends new events and the cursor is already at
  // the old tail, advance to the new tail so a running engagement keeps flowing.
  // A user who has scrubbed back is left exactly where they are. The first
  // snapshot (prev === 0) is left at seq 0 so replay animation can play it. ──
  useEffect(() => {
    const prev = prevTotalRef.current;
    if (total > prev) {
      if (prev > 0) setCursorIndex((i) => (i >= prev - 1 ? total - 1 : i));
      prevTotalRef.current = total;
    }
  }, [total]);

  // ── Auto-play: advance the cursor by compressed real ts gaps ──
  useEffect(() => {
    if (!playing || total === 0) return;
    if (cursorIndex >= maxIndex) {
      setPlaying(false);
      return;
    }
    const cur = allEvents[cursorIndex];
    const next = allEvents[cursorIndex + 1];
    const gap = Math.max(0, next.ts - cur.ts);
    const delay = clamp(gap / speed, REPLAY.minStepMs, REPLAY.maxStepMs);
    const t = window.setTimeout(() => setCursorIndex((i) => Math.min(i + 1, maxIndex)), delay);
    return () => window.clearTimeout(t);
  }, [playing, cursorIndex, speed, allEvents, total, maxIndex]);

  // ── Visible slice + all derived folds (memoized on the cursor) ──
  const events = useMemo(
    () => (total === 0 ? [] : allEvents.slice(0, cursorIndex + 1)),
    [allEvents, cursorIndex, total],
  );
  const agents = useMemo(() => foldAgents(events), [events]);
  const agentTree = useMemo(() => buildAgentTree(agents), [agents]);
  const totals = useMemo(() => foldAgentTotals(events), [events]);
  const engagementTotals = useMemo(
    () => foldEngagementTotals(events, agents.length),
    [events, agents.length],
  );

  // ── Replay controls ──
  const play = useCallback(() => {
    setCursorIndex((i) => (i >= maxIndex ? 0 : i));
    setPlaying(true);
  }, [maxIndex]);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => {
    setPlaying((p) => {
      if (!p) setCursorIndex((i) => (i >= maxIndex ? 0 : i));
      return !p;
    });
  }, [maxIndex]);
  const restart = useCallback(() => {
    setCursorIndex(0);
    setPlaying(true);
  }, []);
  const seekIndex = useCallback(
    (i: number) => {
      setPlaying(false);
      setCursorIndex(clamp(Math.round(i), 0, maxIndex));
    },
    [maxIndex],
  );

  const selectAgent = useCallback((id: string | null) => setSelectedAgentId(id), []);
  const sendSteering = useCallback((agentId: string, text: string) => {
    // Stub: held locally & echoed. Tab A/B own real steering injection.
    setSteering((s) => [...s, { id: `st_${Date.now()}`, agentId, text, ts: Date.now() }]);
    // eslint-disable-next-line no-console
    console.info('[steering:stub]', agentId, text);
  }, []);

  const replay: ReplayControls = useMemo(
    () => ({
      playing,
      speed,
      cursorIndex,
      cursorSeq: allEvents[cursorIndex]?.seq ?? 0,
      total,
      minSeq: allEvents[0]?.seq ?? 0,
      maxSeq: allEvents[maxIndex]?.seq ?? 0,
      startTs: allEvents[0]?.ts ?? 0,
      currentTs: allEvents[cursorIndex]?.ts ?? 0,
      atEnd: cursorIndex >= maxIndex && total > 0,
      play,
      pause,
      toggle,
      restart,
      setSpeed,
      seekIndex,
    }),
    [playing, speed, cursorIndex, allEvents, total, maxIndex, play, pause, toggle, restart, seekIndex],
  );

  const value: EngagementContextValue = useMemo(
    () => ({
      engagementId,
      events,
      allEvents,
      loading,
      agents,
      agentTree,
      totals,
      engagementTotals,
      replay,
      selectedAgentId,
      selectAgent,
      steering,
      sendSteering,
    }),
    [
      engagementId,
      events,
      allEvents,
      loading,
      agents,
      agentTree,
      totals,
      engagementTotals,
      replay,
      selectedAgentId,
      selectAgent,
      steering,
      sendSteering,
    ],
  );

  return <EngagementContext.Provider value={value}>{children}</EngagementContext.Provider>;
}
