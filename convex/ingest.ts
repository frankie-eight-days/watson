/**
 * ingest.ts — THE event pipe.
 *
 * Every event (from /emit, the fixture loader, and steering) flows through
 * `assignSeqAndIngest`, which:
 *   1. assigns a gapless, monotonic per-engagement `seq` (atomic — Convex
 *      mutations are serializable, so concurrent batches can't interleave),
 *   2. inserts the row into `events`,
 *   3. maintains the convenience domain projections (agents / papers / …).
 *
 * The `events` table remains the source of truth; the domain rows are a
 * best-effort projection and never the sole home of any state.
 */

import type { MutationCtx } from './_generated/server';
import { internalMutation } from './_generated/server';
import { v } from 'convex/values';
import { costFor, definedOnly } from './util';
import type {
  ArtifactPayload,
  SpawnPayload,
  StatusPayload,
} from '@watson/shared';

// ---------------------------------------------------------------------------
// Known event vocabulary (mirrors EventType in @watson/shared).
// ---------------------------------------------------------------------------
export const KNOWN_EVENT_TYPES = new Set([
  'spawn',
  'thought',
  'tool_call',
  'tool_result',
  'handoff',
  'status',
  'artifact',
  'metric',
  'steering',
  'error',
]);

/** Loose shape of an incoming event (an EmitEventInput, seq optional). */
export interface RawEvent {
  engagementId: string;
  agentId: string;
  ts: number;
  type: string;
  payload: unknown;
  seq?: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  model?: string;
}

/** Validate the minimum an event must carry. Permissive on payload internals. */
export function isValidRawEvent(e: unknown): e is RawEvent {
  if (typeof e !== 'object' || e === null) return false;
  const ev = e as Record<string, unknown>;
  return (
    typeof ev.engagementId === 'string' &&
    typeof ev.agentId === 'string' &&
    typeof ev.type === 'string' &&
    KNOWN_EVENT_TYPES.has(ev.type) &&
    typeof ev.payload === 'object' &&
    ev.payload !== null
  );
}

// ---------------------------------------------------------------------------
// Engagement bootstrap
// ---------------------------------------------------------------------------
export async function ensureEngagement(
  ctx: MutationCtx,
  engagementId: string,
  ts: number,
): Promise<void> {
  const existing = await ctx.db
    .query('engagements')
    .withIndex('by_engagementId', (q) => q.eq('engagementId', engagementId))
    .first();
  if (existing) return;
  await ctx.db.insert('engagements', {
    engagementId,
    repoUrl: '',
    status: 'active',
    phase: 'bench',
    createdAt: ts,
  });
}

// ---------------------------------------------------------------------------
// Agent projection
// ---------------------------------------------------------------------------
/**
 * Look up an agent. When `engagementId` is given the lookup is scoped to it —
 * critical because agentIds (e.g. 'hermes') are reused across engagements, while
 * the `by_agentId` index spans all engagements. The event pipe always has an
 * engagementId; only the explicit setAgentStatus mutation may omit it.
 */
export async function findAgent(
  ctx: MutationCtx,
  agentId: string,
  engagementId?: string,
) {
  if (engagementId === undefined) {
    return ctx.db
      .query('agents')
      .withIndex('by_agentId', (q) => q.eq('agentId', agentId))
      .first();
  }
  const rows = await ctx.db
    .query('agents')
    .withIndex('by_agentId', (q) => q.eq('agentId', agentId))
    .collect();
  return rows.find((r) => r.engagementId === engagementId) ?? null;
}

/** Merge-upsert an agent row from a spawn (or explicit registerAgent). */
export async function upsertAgentRecord(
  ctx: MutationCtx,
  args: {
    agentId: string;
    engagementId: string;
    parentAgentId: string | null;
    role: string;
    tier: 'hermes' | 'orchestrator' | 'worker';
    model: string;
    label?: string;
    status?: 'spawned' | 'running' | 'waiting' | 'done' | 'failed';
    spawnedAt: number;
  },
) {
  const existing = await findAgent(ctx, args.agentId, args.engagementId);
  if (existing) {
    // Merge: refresh identity fields, keep an already-advanced status.
    await ctx.db.patch(
      existing._id,
      definedOnly({
        engagementId: args.engagementId,
        parentAgentId: args.parentAgentId,
        role: args.role,
        tier: args.tier,
        model: args.model,
        label: args.label,
      }),
    );
    if (args.status) await ctx.db.patch(existing._id, { status: args.status });
    return existing._id;
  }
  return ctx.db.insert('agents', {
    agentId: args.agentId,
    engagementId: args.engagementId,
    parentAgentId: args.parentAgentId,
    role: args.role,
    tier: args.tier,
    model: args.model,
    status: args.status ?? 'spawned',
    spawnedAt: args.spawnedAt,
    label: args.label,
  });
}

/** Latest status wins. */
export async function setAgentStatusRow(
  ctx: MutationCtx,
  agentId: string,
  status: 'spawned' | 'running' | 'waiting' | 'done' | 'failed',
  engagementId?: string,
) {
  const existing = await findAgent(ctx, agentId, engagementId);
  if (existing) await ctx.db.patch(existing._id, { status });
}

// ---------------------------------------------------------------------------
// Domain projection from artifacts (best-effort, merge, never clobber richer)
// ---------------------------------------------------------------------------
async function findDomainRow(
  ctx: MutationCtx,
  table: 'papers' | 'pitches' | 'experiments' | 'prs',
  idField: string,
  engagementId: string,
  idValue: string,
) {
  const rows = await ctx.db
    .query(table)
    .withIndex('by_engagementId', (q) => q.eq('engagementId', engagementId))
    .collect();
  return rows.find((r) => (r as Record<string, unknown>)[idField] === idValue) ?? null;
}

async function upsertArtifactDomain(
  ctx: MutationCtx,
  engagementId: string,
  payload: ArtifactPayload,
  ts: number,
): Promise<void> {
  const refId = payload.refId;
  if (!refId) return; // dossier/report/card without a ref -> event-only

  switch (payload.kind) {
    case 'paper': {
      const existing = await findDomainRow(ctx, 'papers', 'paperId', engagementId, refId);
      const patch = definedOnly({ title: payload.title || undefined, url: payload.url || undefined });
      if (existing) {
        await ctx.db.patch(existing._id, patch);
      } else {
        await ctx.db.insert('papers', {
          paperId: refId,
          engagementId,
          title: payload.title ?? '',
          authors: [],
          abstract: '',
          url: payload.url ?? '',
          stage: 'discovered',
          createdAt: ts,
        });
      }
      break;
    }
    case 'pitch': {
      const existing = await findDomainRow(ctx, 'pitches', 'pitchId', engagementId, refId);
      if (existing) {
        // Only fill hypothesis from body if it's still empty (don't clobber).
        if (!(existing as { hypothesis?: string }).hypothesis && payload.body) {
          await ctx.db.patch(existing._id, { hypothesis: payload.body });
        }
      } else {
        await ctx.db.insert('pitches', {
          pitchId: refId,
          engagementId,
          hypothesis: payload.body ?? payload.title ?? '',
          sourcePaperIds: [],
          expectedImpact: '',
          status: 'proposed',
          createdAt: ts,
        });
      }
      break;
    }
    case 'experiment': {
      const existing = await findDomainRow(ctx, 'experiments', 'experimentId', engagementId, refId);
      if (!existing) {
        await ctx.db.insert('experiments', {
          experimentId: refId,
          engagementId,
          pitchId: '',
          command: '',
          status: 'proposed',
          createdAt: ts,
        });
      }
      // else: leave richer command/status/metrics from enrichment untouched.
      break;
    }
    case 'pr': {
      const existing = await findDomainRow(ctx, 'prs', 'prId', engagementId, refId);
      const patch = definedOnly({ title: payload.title || undefined, url: payload.url || undefined });
      if (existing) {
        await ctx.db.patch(existing._id, patch);
      } else {
        const parsed = Number.parseInt(refId.replace(/^\D+/, ''), 10);
        await ctx.db.insert('prs', {
          prId: refId,
          engagementId,
          number: Number.isFinite(parsed) ? parsed : 0,
          url: payload.url ?? '',
          title: payload.title ?? '',
          pitchId: '',
          state: 'open',
          createdAt: ts,
        });
      }
      break;
    }
    default:
      // dossier / report / card -> no domain table
      break;
  }
}

// ---------------------------------------------------------------------------
// Core: insert one event + apply its derived projection
// ---------------------------------------------------------------------------
async function insertEventRow(ctx: MutationCtx, ev: RawEvent, seq: number): Promise<void> {
  // Derive cost if the client didn't send it but sent usage.
  let costUsd = ev.costUsd;
  if (costUsd === undefined && ev.model && (ev.tokensIn || ev.tokensOut)) {
    costUsd = costFor(ev.model, ev.tokensIn ?? 0, ev.tokensOut ?? 0);
  }

  await ctx.db.insert('events', {
    engagementId: ev.engagementId,
    agentId: ev.agentId,
    seq,
    ts: ev.ts,
    type: ev.type as RawEvent['type'] & string as any,
    payload: ev.payload,
    tokensIn: ev.tokensIn,
    tokensOut: ev.tokensOut,
    costUsd,
    model: ev.model,
  });

  // Derived projections.
  if (ev.type === 'spawn') {
    const p = ev.payload as SpawnPayload;
    await upsertAgentRecord(ctx, {
      agentId: ev.agentId,
      engagementId: ev.engagementId,
      parentAgentId: p.parentAgentId ?? null,
      role: p.role,
      tier: p.tier,
      model: p.model,
      label: p.label,
      status: 'spawned',
      spawnedAt: ev.ts,
    });
  } else if (ev.type === 'status') {
    const p = ev.payload as StatusPayload;
    if (p?.status) await setAgentStatusRow(ctx, ev.agentId, p.status, ev.engagementId);
  } else if (ev.type === 'artifact') {
    await upsertArtifactDomain(ctx, ev.engagementId, ev.payload as ArtifactPayload, ev.ts);
  }
}

/**
 * Assign seqs to a batch and ingest. Returns the assigned seqs positionally.
 *
 * - `preserveSeq`: use each event's embedded `seq` verbatim (fixture replay).
 * - otherwise: next monotonic per-engagement seq, tracked within the batch so a
 *   mixed-engagement batch stays gapless per engagement.
 */
export async function assignSeqAndIngest(
  ctx: MutationCtx,
  events: RawEvent[],
  opts: { preserveSeq?: boolean } = {},
): Promise<number[]> {
  const nextByEng = new Map<string, number>();
  const results: number[] = [];

  for (const ev of events) {
    await ensureEngagement(ctx, ev.engagementId, ev.ts);

    let seq: number;
    if (opts.preserveSeq && typeof ev.seq === 'number') {
      seq = ev.seq;
    } else {
      let next = nextByEng.get(ev.engagementId);
      if (next === undefined) {
        const last = await ctx.db
          .query('events')
          .withIndex('by_engagement_seq', (q) => q.eq('engagementId', ev.engagementId))
          .order('desc')
          .first();
        next = last ? last.seq + 1 : 0;
      }
      seq = next;
      nextByEng.set(ev.engagementId, next + 1);
    }

    await insertEventRow(ctx, ev, seq);
    results.push(seq);
  }

  return results;
}

// ---------------------------------------------------------------------------
// The internalMutation the /emit httpAction calls.
// ---------------------------------------------------------------------------
export const ingestBatch = internalMutation({
  args: { events: v.array(v.any()) },
  handler: async (ctx, { events }): Promise<{ seq: number }[]> => {
    const valid: RawEvent[] = [];
    for (const e of events) {
      if (!isValidRawEvent(e)) {
        throw new Error(`invalid event in batch: ${JSON.stringify(e)?.slice(0, 200)}`);
      }
      valid.push(e as RawEvent);
    }
    const seqs = await assignSeqAndIngest(ctx, valid);
    return seqs.map((seq) => ({ seq }));
  },
});
