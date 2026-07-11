/**
 * events.ts — THE WATSON EVENT PROTOCOL
 * =====================================
 *
 * This file defines the single most load-bearing type in the whole system:
 * the `WatsonEvent`. Every agent step — a spawn, a thought, a tool call, a
 * token/cost tick — is serialized as one `WatsonEvent` and pushed through
 * `emitEvent()` (see emit.ts) into the Convex `events` table.
 *
 * That one pipe powers everything downstream:
 *   (a) all five live GUI views (Bench / Watercooler / Library / Lab / Conference)
 *   (b) the observability trace tree with per-step token & cost
 *   (c) run-diffing
 *   (d) demo replay (a cursor walking `events` by `seq`)
 *   (e) memory
 *
 * HARD RULES (see packages/shared/README.md):
 *   - This file is part of the FROZEN CONTRACT. Do not edit it in a view/backend
 *     tab. Changes only via the architect session.
 *   - Views must render FROM THE EVENT STREAM ONLY. If a view reads state that is
 *     not derivable from these events, replay breaks.
 *   - `seq` is assigned SERVER-SIDE (Convex), monotonic per engagement. Clients
 *     never invent a seq — they send an `EmitEventInput` (a WatsonEvent minus seq).
 *
 * ---------------------------------------------------------------------------
 */

// ===========================================================================
// 1. Event type names
// ===========================================================================

/**
 * The closed set of event kinds. Adding a new kind is a CONTRACT CHANGE.
 * (Note: agent *roles* are open/free-form data — see agents.ts — but event
 * *types* are a fixed vocabulary so every consumer can switch on them.)
 */
export type EventType =
  | 'spawn' // an agent came into existence (self-emitted; see convention below)
  | 'thought' // an agent's reasoning / narration step
  | 'tool_call' // an agent invoked a tool
  | 'tool_result' // the result of a prior tool_call
  | 'handoff' // an agent handed control/context to another agent
  | 'status' // an agent's lifecycle status changed
  | 'artifact' // an agent produced a durable output (dossier, paper, pitch, PR, report…)
  | 'metric' // a measured value, optionally a time series (powers the Lab charts)
  | 'steering' // a human message injected into an agent's loop (console steering)
  | 'error'; // something went wrong (may be recoverable)

// ===========================================================================
// 2. Per-type payloads
// ===========================================================================

/** Agent tiers, duplicated from agents.ts to keep this module payload-complete. */
export type AgentTier = 'hermes' | 'orchestrator' | 'worker';

/**
 * `spawn` — emitted by an agent AS ITS FIRST EVENT (self-spawn convention).
 * The new agent's id is the enclosing event's `agentId`; this payload carries
 * the rest of the AgentRecord-shaped metadata so a replay can build the agent
 * tree from the event stream alone.
 */
export interface SpawnPayload {
  /** Parent in the org tree. `null` only for Hermes (the root president). */
  parentAgentId: string | null;
  /** Free-form role string — roles are DATA, novel roles appear mid-run. */
  role: string;
  tier: AgentTier;
  /** Model backing this agent, e.g. 'gpt-5.6-terra' | 'gpt-5.6-luna'. */
  model: string;
  /** Optional human-friendly label for UI (defaults to role if absent). */
  label?: string;
}

/** `thought` — reasoning / narration surfaced to the UI as cards & console lines. */
export interface ThoughtPayload {
  text: string;
  /** Optional short heading for card display (e.g. "found the failure mode"). */
  title?: string;
}

/** `tool_call` — an agent invoked a tool. Pair with a later `tool_result`. */
export interface ToolCallPayload {
  tool: string;
  /** Arguments passed to the tool. Free-form JSON. */
  args: Record<string, unknown>;
  /** Correlates this call with its `tool_result` (client-generated id). */
  callId?: string;
}

/** `tool_result` — the outcome of a prior `tool_call` (matched via `callId`). */
export interface ToolResultPayload {
  tool: string;
  /** Matches the originating ToolCallPayload.callId. */
  callId?: string;
  ok: boolean;
  /** Result body on success. Free-form JSON. */
  result?: unknown;
  /** Error message on failure (`ok === false`). */
  error?: string;
}

/** `handoff` — control/context passed from the emitting agent to another. */
export interface HandoffPayload {
  toAgentId: string;
  reason: string;
  /** Condensed context passed along so the receiver can continue. */
  summary: string;
}

/** Lifecycle status values, mirroring AgentRecord.status in agents.ts. */
export type AgentStatus = 'spawned' | 'running' | 'waiting' | 'done' | 'failed';

/** `status` — the emitting agent's lifecycle status changed. */
export interface StatusPayload {
  status: AgentStatus;
  detail?: string;
}

/** The kinds of durable artifacts agents can publish. */
export type ArtifactKind =
  | 'dossier' // Watercooler repo dossier
  | 'paper' // a distilled paper card
  | 'pitch' // a MAD-produced research pitch
  | 'experiment' // an experiment write-up
  | 'pr' // a pull request opened on the fork
  | 'report' // the final Conference HTML report
  | 'card'; // a generic canvas card

/**
 * `artifact` — an agent produced a durable output.
 * `refId` points at the row in the corresponding domain table (papers, pitches,
 * experiments, prs…) when one exists, so the UI can deep-link.
 */
export interface ArtifactPayload {
  kind: ArtifactKind;
  /** Id of the backing domain row (e.g. paperId, pitchId, prId) if any. */
  refId?: string;
  title: string;
  /** Body content — markdown/HTML/plain depending on kind. */
  body?: string;
  /** Optional external URL (e.g. the GitHub PR link, the paper link). */
  url?: string;
}

/** A single point in a metric time series. */
export interface MetricPoint {
  /** X value — usually a version index, step, or epoch-ms timestamp. */
  x: number;
  y: number;
}

/**
 * `metric` — a measured value. When `series` is present the UI renders a live
 * chart (this powers the Lab time-horizon chart, e.g. baseline 23.0 → 41.0 days).
 */
export interface MetricPayload {
  name: string;
  value: number;
  unit?: string;
  /** Full/incremental series for chart rendering. */
  series?: MetricPoint[];
  /** Optional label distinguishing lines on the same chart (e.g. 'baseline'). */
  seriesLabel?: string;
}

/** `steering` — a human message injected into a specific agent's loop. */
export interface SteeringPayload {
  text: string;
  /** Who sent it (e.g. 'frank'); defaults to the console operator. */
  from?: string;
}

/** `error` — something went wrong. `recoverable` distinguishes soft from fatal. */
export interface ErrorPayload {
  message: string;
  /** True if the agent recovered/retried after this (soft error). */
  recoverable?: boolean;
  /** True if this ended the agent/engagement (hard failure). */
  fatal?: boolean;
  /** Optional error code / stack pointer for debugging. */
  code?: string;
}

// ===========================================================================
// 3. Type → payload map (single source of truth)
// ===========================================================================

/**
 * The canonical mapping from event type to its payload shape. Both `EventType`
 * (via `keyof`) and the discriminated `WatsonEvent` union are derived from this,
 * so they can never drift apart.
 */
export interface EventPayloadMap {
  spawn: SpawnPayload;
  thought: ThoughtPayload;
  tool_call: ToolCallPayload;
  tool_result: ToolResultPayload;
  handoff: HandoffPayload;
  status: StatusPayload;
  artifact: ArtifactPayload;
  metric: MetricPayload;
  steering: SteeringPayload;
  error: ErrorPayload;
}

// Compile-time guarantee that EventPayloadMap covers EventType exactly.
type _AssertMapCoversTypes = EventType extends keyof EventPayloadMap ? true : never;
type _AssertTypesCoverMap = keyof EventPayloadMap extends EventType ? true : never;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _mapCheck: [_AssertMapCoversTypes, _AssertTypesCoverMap] = [true, true];

// ===========================================================================
// 4. The WatsonEvent itself
// ===========================================================================

/**
 * Fields common to every event, independent of `type`.
 *
 * Token/cost fields are OPTIONAL and only present on events that consumed model
 * capacity (typically `thought`, `tool_call`, `handoff`). They flow straight
 * into the observability cost columns.
 */
export interface WatsonEventBase {
  /** The engagement (client job) this event belongs to. */
  engagementId: string;
  /** The agent that emitted this event. For `spawn`, this IS the new agent. */
  agentId: string;
  /** Monotonic per-engagement sequence. ASSIGNED SERVER-SIDE. */
  seq: number;
  /** Epoch milliseconds when the event occurred. */
  ts: number;

  // ---- optional usage/accounting (per-step observability) ----
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  /** Model that produced this step (redundant with the agent's model but handy). */
  model?: string;
}

/** One concrete event variant: base fields + a `type` tag + its typed payload. */
export interface WatsonEventOf<K extends EventType> extends WatsonEventBase {
  type: K;
  payload: EventPayloadMap[K];
}

/**
 * THE discriminated union. Narrow on `.type` and `.payload` is typed precisely:
 *
 *   if (ev.type === 'tool_call') { ev.payload.tool // string }
 */
export type WatsonEvent = { [K in EventType]: WatsonEventOf<K> }[EventType];

// ===========================================================================
// 5. Wire shape for emission (seq stripped — server assigns it)
// ===========================================================================

/** Distributive Omit so `Omit` applies to each member of a union individually. */
export type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/**
 * What a client actually sends over the wire to the emit endpoint: a full
 * WatsonEvent minus `seq` (Convex assigns the monotonic seq). Still a
 * discriminated union on `.type`.
 */
export type EmitEventInput = DistributiveOmit<WatsonEvent, 'seq'>;

/** Per-emit usage/accounting bundle accepted by `emit(type, payload, usage?)`. */
export interface EventUsage {
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  /** Overrides the emitter's default model for this one event. */
  model?: string;
}

// ===========================================================================
// 6. The emit endpoint contract (Tab A implements the Convex side to match)
// ===========================================================================

/**
 * Default HTTP path the EventEmitterClient POSTs to, relative to `convexUrl`.
 * Tab A must register a Convex httpAction at this path (or accept an override).
 */
export const EMIT_ENDPOINT_PATH = '/emit';

/**
 * Request body for the emit endpoint. Always a batch (single events are a batch
 * of one) so the client can coalesce fire-and-forget emissions.
 */
export interface EmitBatchRequest {
  events: EmitEventInput[];
}

/** One entry in the emit response, positionally aligned with the request. */
export interface EmitResultEntry {
  /** The server-assigned monotonic per-engagement sequence for this event. */
  seq: number;
}

/**
 * Response body from the emit endpoint. `results[i]` corresponds to
 * `request.events[i]`. On failure the server SHOULD still return 2xx with
 * `ok: false` where possible so the fire-and-forget client can decide to retry.
 */
export interface EmitBatchResponse {
  ok: boolean;
  results: EmitResultEntry[];
  error?: string;
}

// ===========================================================================
// 7. Small helpers
// ===========================================================================

/** Type guard: narrow an event to a specific type. */
export function isEventType<K extends EventType>(
  ev: WatsonEvent,
  type: K,
): ev is Extract<WatsonEvent, { type: K }> {
  return ev.type === type;
}

/**
 * Compute USD cost for a step given token counts and a model. Rates are per the
 * PLAN model routing (per 1M tokens). Unknown models fall back to terra rates.
 */
export const MODEL_RATES: Record<string, { in: number; out: number }> = {
  'gpt-5.6-terra': { in: 2.5, out: 15 },
  'gpt-5.6-luna': { in: 1, out: 6 },
};

export function costFor(model: string, tokensIn = 0, tokensOut = 0): number {
  const rate = MODEL_RATES[model] ?? MODEL_RATES['gpt-5.6-terra'];
  const usd = (tokensIn / 1_000_000) * rate.in + (tokensOut / 1_000_000) * rate.out;
  // round to 6 decimals to avoid float noise in stored costs
  return Math.round(usd * 1_000_000) / 1_000_000;
}
