/**
 * fold.ts — the ONLY way UI state is derived: pure folds over WatsonEvent[].
 *
 * Every function here takes the seq-sorted events visible up to the replay
 * cursor and returns derived view state. No component reads anything that isn't
 * produced here from the event stream — that is the hard rule that makes replay
 * possible. Keep these pure and total.
 */
import {
  type WatsonEvent,
  type AgentRecord,
  type AgentStatus,
  type MetricPoint,
  isEventType,
} from '@watson/shared';

// ── Agents & the org tree ────────────────────────────────────────────────

/** Fold spawn(+status) events into AgentRecords. Latest status event wins. */
export function foldAgents(events: WatsonEvent[]): AgentRecord[] {
  const byId = new Map<string, AgentRecord>();
  for (const ev of events) {
    if (isEventType(ev, 'spawn')) {
      const p = ev.payload;
      byId.set(ev.agentId, {
        id: ev.agentId,
        engagementId: ev.engagementId,
        parentAgentId: p.parentAgentId,
        role: p.role,
        tier: p.tier,
        model: p.model,
        status: 'spawned',
        spawnedAt: ev.ts,
        label: p.label,
      });
    } else if (isEventType(ev, 'status')) {
      const rec = byId.get(ev.agentId);
      if (rec) rec.status = ev.payload.status;
    }
  }
  return [...byId.values()];
}

export interface AgentNode extends AgentRecord {
  children: AgentNode[];
  depth: number;
}

/** Build the nested org tree from AgentRecords (null parent = Hermes root). */
export function buildAgentTree(agents: AgentRecord[]): AgentNode[] {
  const nodes = new Map<string, AgentNode>();
  for (const a of agents) nodes.set(a.id, { ...a, children: [], depth: 0 });
  const roots: AgentNode[] = [];
  for (const node of nodes.values()) {
    if (node.parentAgentId && nodes.has(node.parentAgentId)) {
      nodes.get(node.parentAgentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const setDepth = (n: AgentNode, d: number) => {
    n.depth = d;
    n.children.sort((a, b) => a.spawnedAt - b.spawnedAt);
    n.children.forEach((c) => setDepth(c, d + 1));
  };
  roots.sort((a, b) => a.spawnedAt - b.spawnedAt);
  roots.forEach((r) => setDepth(r, 0));
  return roots;
}

// ── Per-agent accounting (observability cost columns) ────────────────────

export interface AgentTotals {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  events: number;
}

/** Sum tokens/cost/event-count per agentId across visible events. */
export function foldAgentTotals(events: WatsonEvent[]): Map<string, AgentTotals> {
  const m = new Map<string, AgentTotals>();
  for (const ev of events) {
    const t = m.get(ev.agentId) ?? { tokensIn: 0, tokensOut: 0, costUsd: 0, events: 0 };
    t.tokensIn += ev.tokensIn ?? 0;
    t.tokensOut += ev.tokensOut ?? 0;
    t.costUsd += ev.costUsd ?? 0;
    t.events += 1;
    m.set(ev.agentId, t);
  }
  return m;
}

/** Roll subtree totals so an orchestrator row shows its whole branch's cost. */
export function subtreeTotals(node: AgentNode, totals: Map<string, AgentTotals>): AgentTotals {
  const self = totals.get(node.id) ?? { tokensIn: 0, tokensOut: 0, costUsd: 0, events: 0 };
  return node.children.reduce<AgentTotals>(
    (acc, child) => {
      const c = subtreeTotals(child, totals);
      return {
        tokensIn: acc.tokensIn + c.tokensIn,
        tokensOut: acc.tokensOut + c.tokensOut,
        costUsd: acc.costUsd + c.costUsd,
        events: acc.events + c.events,
      };
    },
    { ...self },
  );
}

export interface EngagementTotals {
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  tokens: number;
  agentCount: number;
  eventCount: number;
}

/** Engagement-wide running totals (header cost ticker + token count). */
export function foldEngagementTotals(events: WatsonEvent[], agentCount: number): EngagementTotals {
  let costUsd = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  for (const ev of events) {
    costUsd += ev.costUsd ?? 0;
    tokensIn += ev.tokensIn ?? 0;
    tokensOut += ev.tokensOut ?? 0;
  }
  return {
    costUsd,
    tokensIn,
    tokensOut,
    tokens: tokensIn + tokensOut,
    agentCount,
    eventCount: events.length,
  };
}

// ── Artifacts (cards / kanban / dossier / report / PR) ───────────────────

export type ArtifactEvent = Extract<WatsonEvent, { type: 'artifact' }>;

/** All artifact events, in seq order. */
export function foldArtifacts(events: WatsonEvent[]): ArtifactEvent[] {
  return events.filter((e): e is ArtifactEvent => e.type === 'artifact');
}

/** Artifacts of a given kind (e.g. 'paper', 'pr'), latest-per-refId collapsed. */
export function artifactsOfKind(
  events: WatsonEvent[],
  kind: ArtifactEvent['payload']['kind'],
): ArtifactEvent[] {
  return foldArtifacts(events).filter((a) => a.payload.kind === kind);
}

/**
 * Collapse repeated artifact events that share a refId to the LATEST one, so a
 * paper announced at discover→screen→distill shows as one evolving card.
 * Artifacts without a refId are kept individually (keyed by seq).
 */
export function latestArtifactByRef(artifacts: ArtifactEvent[]): ArtifactEvent[] {
  const byRef = new Map<string, ArtifactEvent>();
  const out: ArtifactEvent[] = [];
  for (const a of artifacts) {
    const ref = a.payload.refId;
    if (!ref) {
      out.push(a);
      continue;
    }
    byRef.set(ref, a); // latest wins (events are seq-sorted)
  }
  return [...out, ...byRef.values()].sort((a, b) => a.seq - b.seq);
}

// ── Metrics (the Lab money shot) ─────────────────────────────────────────

export interface MetricSeries {
  label: string;
  points: MetricPoint[];
  unit?: string;
  latest: number;
}

/**
 * For a metric `name`, return one series per `seriesLabel`. The fixture emits
 * CUMULATIVE series (each event carries the full series-so-far), so we keep the
 * latest event per label — the line grows as the cursor advances.
 */
export function foldMetricSeries(events: WatsonEvent[], name: string): MetricSeries[] {
  const byLabel = new Map<string, MetricSeries>();
  for (const ev of events) {
    if (!isEventType(ev, 'metric')) continue;
    if (ev.payload.name !== name) continue;
    const label = ev.payload.seriesLabel ?? name;
    const points = ev.payload.series ?? [{ x: 0, y: ev.payload.value }];
    byLabel.set(label, {
      label,
      points,
      unit: ev.payload.unit,
      latest: ev.payload.value,
    });
  }
  // Stable order: first-seen label order.
  return [...byLabel.values()];
}

/** Latest scalar value of a named metric (any label), or undefined. */
export function latestMetric(
  events: WatsonEvent[],
  name: string,
): { value: number; unit?: string } | undefined {
  let out: { value: number; unit?: string } | undefined;
  for (const ev of events) {
    if (isEventType(ev, 'metric') && ev.payload.name === name) {
      out = { value: ev.payload.value, unit: ev.payload.unit };
    }
  }
  return out;
}

// ── Per-agent event feed (console drawer) ────────────────────────────────

/** Events emitted by one agent, seq order (the console feed). */
export function agentEvents(events: WatsonEvent[], agentId: string | null): WatsonEvent[] {
  if (!agentId) return [];
  return events.filter((e) => e.agentId === agentId);
}

/** Map a tool_result's callId back to its tool_call args, for correlated render. */
export function correlateToolCalls(events: WatsonEvent[]): Map<string, Record<string, unknown>> {
  const m = new Map<string, Record<string, unknown>>();
  for (const ev of events) {
    if (isEventType(ev, 'tool_call') && ev.payload.callId) {
      m.set(ev.payload.callId, ev.payload.args);
    }
  }
  return m;
}

// ── Status → color token name ────────────────────────────────────────────

export const STATUS_META: Record<AgentStatus, { label: string; token: string }> = {
  spawned: { label: 'Spawned', token: 'var(--ink-3)' },
  running: { label: 'Running', token: 'var(--accent)' },
  waiting: { label: 'Waiting', token: 'var(--warning)' },
  done: { label: 'Done', token: 'var(--good)' },
  failed: { label: 'Failed', token: 'var(--critical)' },
};

/** Coarse engagement phase inferred from the visible event stream (header pill). */
export function inferPhase(events: WatsonEvent[]): string {
  let phase = 'Bench';
  for (const ev of events) {
    if (isEventType(ev, 'artifact')) {
      const k = ev.payload.kind;
      if (k === 'dossier') phase = 'Ingestion';
      else if (k === 'paper' || k === 'pitch') phase = 'Library';
      else if (k === 'experiment') phase = 'Lab';
      else if (k === 'pr' || k === 'report') phase = 'Conference';
    }
  }
  return phase;
}
