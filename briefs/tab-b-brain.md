# Tab B — The Brain (Cloudflare)

**Read first:** `PLAN.md`, then `watson/packages/shared/README.md`. You are one of four parallel Claude sessions; the architect session owns all contracts.

## Mission
Own `watson/workers/brain/` — Hermes the president agent and all workflow subagents. This is the control plane of the whole product.

## Hard rules
- `packages/shared/` and `convex/schema.ts` are FROZEN. Every agent step MUST go through `emitEvent` — an action that isn't emitted doesn't exist (no UI, no observability, no replay).
- Skills to load before coding: `agents-sdk`, `workers-best-practices`, `wrangler`.

## Architecture
1. **Hermes DO** — Cloudflare Agents SDK Durable Object. Persistent per-engagement. WebSocket endpoint for the Bench TUI (chat protocol: user text in, hermes text/status out). Intelligence: **Nous Hermes harness pattern with `gpt-5.6-terra`, effort high/max** (get harness details from Frank/venue; build behind a `HarnessAdapter` interface so worst-case it's our own loop on terra). Hermes: scopes the engagement in chat, then on COMMENCE kicks off workflows in sequence, reads their outputs (dossier → briefs library; pitches → briefs lab), reviews results, approves PRs. Every handoff = a `handoff` event.
2. **Workflow workers** — OpenAI Agents SDK (JS) (`openai-agents-js`) running in Workers, spawned/instructed by Hermes:
   - **Watercooler:** repo ingestion. Orchestrator + luna workers explore the target repo (via GitHub API / raw fetch), emit exploration `artifact` card events, produce a Repo Dossier artifact.
   - **Library:** paper pipeline. Linkup search (power-up — real live queries) → luna graders (relevance score vs dossier, emit scores) → terra distillers → citation pass → MAD debate (2-3 terra agents argue, emit thought events) → Pitch artifacts with expected metric impact.
   - **Lab:** per approved pitch: implement change on a branch (via Tab C's PR machinery), call Tab C's sandbox-runner to execute benchmark, emit `metric` series events live during the run, compare vs baseline, on win → open PR + emit `pr` artifact.
3. **Dynamic roles:** Hermes spawns specialist roles as data (role string invented at runtime, e.g. spawning a 'context-compaction-specialist' when a paper demands it) — rubric L5 requires a role appearing mid-run that didn't exist at kickoff. Make this real, not scripted.
4. **Steering:** poll/subscribe Tab A's steering table; inject as user-role messages into the target agent's loop.
5. **Model routing:** terra (high effort) = Hermes + orchestrators + MAD/synthesis; luna = fan-out workers (screening, grading). Track tokens/cost from API usage fields onto every event.

## Checkpoints
- **H2:** Hermes DO deployed, Bench WebSocket chat works, a toy workflow emits real events into Convex end-to-end.
- **H4:** full engagement runs: chat → watercooler → library (real Linkup) → one lab experiment via Tab C → PR opened.

## Rubric you own
Root parameter (the real output), org structure L4/L5 (dynamic delegation, emergent roles), handoffs, Linkup + Cloudflare power-ups, Hermes eligibility (base harness).
