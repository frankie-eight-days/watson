# @watson/brain

Hermes DO + workflow agents — Tab B, the control plane of Watson.

Hermes (the president agent) runs in a **Cloudflare Durable Object** on the
Agents SDK, one instance per engagement. It speaks the Bench WebSocket chat
protocol, scopes the job with `gpt-5.6-terra`, and on COMMENCE dispatches
workflows in sequence. **Every agent step goes through `emitEvent`** (the single
Convex pipe from `@watson/shared`) — spawn, thought, tool_call/tool_result,
handoff, status, artifact, metric, steering, error.

Live: **https://watson-brain.frankkevinwalsh.workers.dev**
(account `b9adc0458ab5f7d63447a4f0a4b81d00`).

## Layout

```
src/
  index.ts            Worker entry: /health, /engagements/:id/bench (WS), POST /engagements/:id/commence
  hermes.ts           HermesAgent Durable Object (Agents SDK) — root president agent
  lib/
    model.ts          ModelClient — the ONE OpenAI surface (Chat Completions), terra/luna routing
    harness.ts        HarnessAdapter seam + TerraLoopHarness (agentic loop; offline canned fallback)
    context.ts        BrainContext — emitter factory, spawn()/handoff()/status()/emit()
    env.ts            BrainEnv (generated Env + secrets via declaration merging)
  workflows/
    toy.ts            runToyWorkflow — end-to-end pipe proof (exercises all 10 event types)
scripts/
  toy-proof.ts        offline JSONL proof + contract validator (`npm run proof`)
```

## Run it

```bash
# from repo root once, to resolve @watson/shared + deps
npm install

cd workers/brain
cp .dev.vars.example .dev.vars   # fill in OPENAI_API_KEY (+ LINKUP_API_KEY for Wave 2)
npm run cf-types                 # regenerate worker-configuration.d.ts from wrangler.jsonc
npm run typecheck                # tsc --noEmit
npm run proof                    # offline: run the toy workflow, validate the JSONL stream
npm run dev                      # wrangler dev (local) on :8787
npm run deploy                   # wrangler deploy
```

Secrets are NOT in `wrangler.jsonc`. Local dev reads them from `.dev.vars`
(gitignored); prod uses `wrangler secret put OPENAI_API_KEY` (and
`LINKUP_API_KEY`). `.dev.vars.example` documents the full set.

## Bench WebSocket protocol

Connect: `GET wss://…/engagements/:id/bench` (WebSocket upgrade). The engagement
id is the DO instance key (`idFromName`).

- **Inbound:** `{ "type": "user", "text": "…" }` · `{ "type": "commence", "repoUrl": "…" }`
- **Outbound:** `{ "type": "hermes", "text": "…" }` · `{ "type": "status", "phase": "…", … }`

(The Agents SDK also emits `cf_agent_*` state-sync frames on the same socket —
clients ignore unknown `type`s.)

Alternative trigger: `POST /engagements/:id/commence` with `{ "repoUrl": "…" }`
(native DO RPC to `HermesAgent.commence`).

## Emit modes (`WATSON_EMIT_MODE`)

- **`convex`** (default, used in the DO) — `EventEmitterClient` POSTs batches to
  `${CONVEX_SITE_URL}/emit`. Convex assigns `seq` server-side. `fetch` is bound
  to `globalThis` (Workers requires it; unbound `this.fetchImpl(...)` throws
  *Illegal invocation*).
- **`mock`** — `MockEmitter` appends JSONL (used by `npm run proof`; the DO has
  no filesystem so it always runs `convex`). All emitters in an engagement share
  ONE `seqCounter` so `seq` stays gapless.

`BrainContext.spawn/status/handoff/emit` flush-per-emit so a multi-agent stream
is strictly ordered (gapless `seq`, monotonic `ts`, parents before children) —
which replay depends on.

## Model surface

`model.ts` uses the **Chat Completions** API (`client.chat.completions.create`)
— the most portable tool-calling surface for OpenAI-compatible venue proxies,
with `usage` tokens for the cost columns. Swapping to the Responses API or a
proxy is a one-file / `OPENAI_BASE_URL`-env change. Routing: `terra` =
high-effort (Hermes, orchestrators, MAD/synthesis), `luna` = cheap fan-out.

`harness.ts` is the eligibility hedge: agents program against `HarnessAdapter`;
`TerraLoopHarness` is our loop (model → tools → repeat). If the model is
unreachable it emits a recoverable `error` + a canned `thought` and returns, so
the event pipe still proves out. Drop the real Nous Hermes harness in behind the
same interface later.

## Stubbed for later waves

- **Real workflows** — `commence` runs `runToyWorkflow` (canned) in Wave 1. The
  watercooler (repo ingestion) → library (Linkup papers, MAD) → lab (sandbox
  experiments, PRs) workflows slot into the same COMMENCE sequence.
- **OpenAI Agents SDK** (`@openai/agents`) — installed for the Wave-2 workflow
  workers; not yet wired.
- **Steering** — `HermesAgent.pollSteering()` is a wired stub returning `[]`; the
  injection point is live in `TerraLoopHarness` (getSteering hook, emits
  `steering`). Wave 2: read Tab A's `steering` table, mark consumed, inject.
- **Dynamic emergent roles** — spawn API takes a free-form `role` string; Wave 2
  invents specialist roles mid-run (org-structure L5).
