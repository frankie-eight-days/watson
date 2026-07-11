# Tab A — Convex Backend

**Read first:** `PLAN.md` (root of hermes_buildathon), then `watson/packages/shared/README.md`. Those are authoritative. You are one of four parallel Claude sessions; the architect session owns all contracts.

## Mission
Own everything in `watson/convex/` — the live state store and event pipe that powers all five UI views, observability, and demo replay.

## Hard rules
- `convex/schema.ts` and `packages/shared/` are FROZEN contracts. If you need a change, stop and ask Frank to relay it to the architect session. Do not edit them.
- The UI renders from the `events` table ONLY. Never build a query that lets a view depend on state not derivable from events (replay breaks).

## Deliverables, in order
1. **Event ingestion:** implement the Convex endpoint (HTTP action + mutation) matching the emitEvent contract in `packages/shared/src/emit.ts` / README. Server assigns `seq` (monotonic per engagement). Batch insert supported. Also mutations for agent registration (spawn) and status updates.
2. **Fixture loader:** a script/mutation that loads `fixtures/mock-engagement.jsonl` into the deployment so Tab D has live data immediately. Do this FAST — Tab D is blocked on realistic data.
3. **View queries** (all subscription-friendly): events by engagement ordered by seq (paginated + tail); agent tree for an engagement (from agents table + spawn events); per-agent event feed (console drawer); papers/pitches/experiments/prs by engagement; latest metric series for charts.
4. **Replay support:** query for events in seq window; a `runs` record per engagement (start/end seq, label). Replay logic is client-side — you just make windowed reads cheap.
5. **Steering:** mutation to append a steering message for an agentId + query the brain polls/subscribes to.
6. **Observability queries:** per-agent and per-engagement token/cost rollups; run-diff query (two engagements → step counts, cost totals, metric series side by side); simple text search across event payloads for an engagement.
7. **Memory:** CRUD for the three-layer memory table (task/client/rules).

## Checkpoints
- **H2:** fixture loaded, event ingestion live, Tab D subscribing to real Convex data.
- **H4:** steering + observability rollups working with real events from Tab B.

## Rubric you own
Observability L4/L5 data (token/cost per step, run diff, search), memory L5 (three layers), replay (the demo itself).
