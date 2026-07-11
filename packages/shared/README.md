# @watson/shared — THE CONTRACT

This package is the single most load-bearing code in Watson. Every tab (Convex
backend, Cloudflare brain, sandbox runner, all five UI views) builds against
these types and this one client. It is authored and changed **only in the
architect session**.

> **HARD RULE — THIS PACKAGE AND `convex/schema.ts` ARE FROZEN.**
> Do not edit `packages/shared/src/**` or `convex/schema.ts` in a view or backend
> tab. If you need a change, request it from the architect session. A silent edit
> here breaks every other tab and the demo replay.

---

## What's in here

| File | Purpose |
|---|---|
| `src/events.ts` | The event protocol: `EventType`, per-type payloads, the `WatsonEvent` discriminated union, the emit endpoint contract, cost helpers. |
| `src/agents.ts` | `AgentRecord` — the org-tree row. Roles are **data** (free strings). |
| `src/domain.ts` | Durable entities: `Engagement`, `Paper`, `Pitch`, `Experiment`, `PrRecord`, `MemoryEntry`, `Run`, `SteeringMessage`. |
| `src/emit.ts` | `emitEvent` client: `EventEmitterClient` (prod), `MockEmitter` (offline JSONL), `createEmitter` factory, shared `Emitter` interface. |
| `src/index.ts` | Re-exports everything. Import from `@watson/shared`. |
| `../../convex/schema.ts` | The Convex schema mirroring these types. Also frozen. |
| `../../fixtures/mock-engagement.jsonl` | A full hand-authored engagement (175 events) for UI/offline dev + replay. |

---

## The event protocol

Every agent step is one `WatsonEvent`. Narrow on `.type` and `.payload` is typed
precisely (discriminated union):

```ts
import { type WatsonEvent, isEventType } from '@watson/shared';

function render(ev: WatsonEvent) {
  if (isEventType(ev, 'tool_call')) ev.payload.tool;      // string
  if (ev.type === 'metric')        ev.payload.series;     // MetricPoint[] | undefined
}
```

### Event types

`spawn` · `thought` · `tool_call` · `tool_result` · `handoff` · `status` ·
`artifact` · `metric` · `steering` · `error`

Event **types** are a closed vocabulary (adding one is a contract change). Agent
**roles** are the opposite — free strings, because novel roles appear mid-run
(org-structure L5 proof). See `SpawnPayload.role`, `AgentRecord.role`.

### Common fields (every event)

`engagementId`, `agentId`, `seq`, `ts`, `type`, `payload`, and optional
accounting `tokensIn?`, `tokensOut?`, `costUsd?`, `model?`.

- **`seq` is assigned SERVER-SIDE by Convex** — monotonic per engagement. Clients
  send an `EmitEventInput` (a `WatsonEvent` with `seq` stripped); the emit
  endpoint stamps the seq. `MockEmitter` assigns seq locally so its JSONL is a
  faithful, replayable stream.
- **`ts`** is epoch milliseconds, set by the client at emit time.

### The spawn convention (read this)

An agent self-emits `spawn` **as its first event**: the enclosing event's
`agentId` **is** the new agent, and `SpawnPayload` carries
`{ parentAgentId, role, tier, model, label? }`. `parentAgentId` is `null` **only
for Hermes** (the root president). This lets replay rebuild the entire agent tree
from the event stream alone — no side table required.

### Hard rule for views: render FROM THE EVENT STREAM ONLY

Replay is a cursor walking `events` by `seq`. If a view reads any state not
derivable from the event stream, replay breaks. Domain tables (`papers`,
`pitches`, …) exist for convenient indexed reads, but every row they hold was
also announced as an `artifact`/`metric`/`status` event whose `refId` links back
— so a pure-event render is always possible. Keep it that way.

---

## The emit endpoint contract (Tab A implements this)

`EventEmitterClient` POSTs **batches** to a Convex HTTP action. Tab A must
register an `httpAction` that matches exactly:

- **Method / path:** `POST ${convexUrl}${EMIT_ENDPOINT_PATH}` where
  `EMIT_ENDPOINT_PATH === '/emit'` (a client may override the path via
  `endpointPath`, but `/emit` is the default both sides assume).
- **Request body** (`EmitBatchRequest`):

  ```jsonc
  {
    "events": [
      {
        "engagementId": "eng_vb_001",
        "agentId": "hermes",
        "ts": 1752253200000,
        "type": "thought",
        "payload": { "text": "…" },
        "tokensIn": 640, "tokensOut": 210,   // optional
        "costUsd": 0.0048, "model": "gpt-5.6-terra" // optional
      }
      // …up to batchSize events
    ]
  }
  ```

  Each entry is an `EmitEventInput` = a `WatsonEvent` **without `seq`**. It is a
  discriminated union on `type`; validate `payload` against the matching payload
  shape at this edge.

- **Server responsibilities:**
  1. Assign `seq` = next monotonic per-`engagementId` value **atomically**
     (events for one engagement must get strictly increasing, gapless seqs even
     under concurrent batches).
  2. Insert each event into the `events` table.
  3. Maintain derived rows: on `spawn` upsert `agents`; on `artifact`/`metric`
     upsert the relevant domain row keyed by `payload.refId` when present.

- **Response body** (`EmitBatchResponse`), positionally aligned with the request:

  ```jsonc
  { "ok": true, "results": [ { "seq": 128 }, { "seq": 129 } ] }
  ```

  On partial/total failure, prefer returning HTTP 2xx with `{ "ok": false,
  "error": "…" }` so the fire-and-forget client can retry. A non-2xx also
  triggers client retry.

- **Client behavior you can rely on:** buffered/batched (default 25 events or
  250 ms), serialized flushes (ordering preserved), fire-and-forget (`emit()`
  never throws), small bounded retry with exponential backoff (default 3 tries),
  then drop with a warning (`onDrop` hook) rather than block the agent loop.

### Using the client

```ts
import { EventEmitterClient } from '@watson/shared';

const emit = new EventEmitterClient({
  convexUrl: process.env.CONVEX_URL!,   // e.g. https://foo-bar-123.convex.site
  engagementId,
  agentId: 'hermes',
  model: 'gpt-5.6-terra',               // default model for cost derivation
  // fetchImpl: fetch,                   // pass in Workers if global fetch absent
});

emit.emit('spawn', { parentAgentId: null, role: 'president', tier: 'hermes', model: 'gpt-5.6-terra' });
emit.emit('thought', { text: 'Understanding the ask' }, { tokensIn: 640, tokensOut: 210 });
// costUsd is auto-derived from tokens + model when you omit it.
await emit.close(); // flush on shutdown
```

---

## The fixture — offline dev & replay

`fixtures/mock-engagement.jsonl` is a complete, coherent engagement (175 events,
19 agents) spanning all five views: Bench scoping → Watercooler dossier →
Library pipeline (discover/screen/distill/cite/MAD) → Lab experiment with the
time-horizon chart climbing **23.0 → 41.0 days** (baseline vs candidate series) →
Conference PR + report. It includes a mid-run novel role
(`cuda-profiling-specialist`), a handoff chain through the MAD arena, and one
error + recovery in the sandbox. One JSON object per line, matching `WatsonEvent`
exactly, `seq` gapless from 0.

**UI tabs build against this.** Load it and drive views from it before any
backend exists:

```ts
import { readFileSync } from 'node:fs';
import type { WatsonEvent } from '@watson/shared';

const events: WatsonEvent[] = readFileSync('fixtures/mock-engagement.jsonl', 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l) as WatsonEvent);

// Replay: walk by seq with (compressed) original inter-event timing.
```

**Producing more JSONL** with `MockEmitter` (writes the same format):

```ts
import { MockEmitter } from '@watson/shared';

const emit = new MockEmitter({
  engagementId: 'eng_dev',
  agentId: 'hermes',
  filePath: './fixtures/dev-run.jsonl',
  seqCounter: { value: 0 }, // share ONE counter across all agents in a run
});
emit.emit('thought', { text: 'hi' });
await emit.close();
```

Share a single `seqCounter` object across every `MockEmitter` in a run so seq
stays monotonic across agents (the server does this for you in prod).

---

## Validation

- `npm run typecheck:shared` — `tsc --noEmit` over `src/**`.
- `npm run typecheck:convex` — `tsc --noEmit` over `convex/schema.ts`.
- The fixture is validated to be one valid `WatsonEvent` per line with gapless
  monotonic `seq`, monotonic `ts`, correlated tool_call/tool_result pairs, a
  well-formed spawn tree, and full artifact-kind coverage.
