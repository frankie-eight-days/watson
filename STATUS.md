# STATUS BOARD — the tab-to-architect channel

**Every tab:** when you hit a milestone below, check the box, add a one-line note (+ URL if deployed), and commit this file with your work. Keep edits to YOUR section only. The architect session watches this file — it is how convergence gets called.

## Checkpoint 1 → convergence trigger: ALL boxes below checked
When the last box ticks, Frank tells the architect session "run checkpoint 1". Do not wait for a clock time.

### Tab A — Convex
- [ ] Event ingestion endpoint live (emitEvent contract implemented)
- [ ] Fixture loaded into deployment (mock engagement queryable)
- [ ] View queries live: events-by-engagement, agent tree, per-agent feed

### Tab B — Brain
- [x] Skeleton deployed to Cloudflare (URL: https://watson-brain.frankkevinwalsh.workers.dev) — Worker + HermesAgent DO; /health 200, bench WS upgrade route live
- [x] Bench WebSocket chat responds (Hermes says hello via terra) — VERIFIED end-to-end vs deployed URL; gpt-5.6-terra reachable via api.openai.com (no base URL); events land in Convex
- [x] Toy workflow emits real events into Convex (engagementId: eng_toy_probe1) — commence → all 10 event types written, well-formed spawn tree

### Tab C — Fork + Sandbox
- [x] Fork runs locally, metric extracted (baseline numbers: run1 = $985.50 total assets; mean pending runs 2&3). gpt-5.6-luna via new OpenAI provider; demo profile = 30d/seed42/~100s/$0.93
- [x] Sandbox SDK verdict: runs in container? **YES** — real container exec live at https://watson-sandbox-runner.frankkevinwalsh.workers.dev/ping (no GitHub Actions fallback needed)
- [x] Baseline 3x recorded in fork's baselines.json — **N = mean $821.80** (per-run 985.50/703.25/776.65, stdev 146.44); fork commit 8edb7a7

### Tab D — UI Shell
- [x] Skeleton deployed to Cloudflare (URL: https://watson-web.frankkevinwalsh.workers.dev) — Worker + static assets, SPA fallback, all 5 routes 200
- [x] Shell + AgentTree + ConsoleDrawer render the fixture — folds events→agents/feed; per-agent cost/tokens; typed console feed
- [x] ReplayBar scrubs the fixture — shared cursor; live-stream and replay use one render path (event-stream-only)
- [x] FORKED into view tabs D1/D2/D3 — all 5 canvases built from events: Lab money-shot (baseline vs candidate agent_time_horizon 23→41d + experiment cards), Watercooler (cards+dossier), Library (kanban discover→pitch w/ relevance), Conference (PRs+report+before/after)
- [x] LIVE on Convex — swapped event-source shim to real Convex subscriptions (VITE_CONVEX_URL, watchQuery events:eventsWindow); engagement switcher lists real engagements:listEngagements; eng_vb_001 renders 175 events identically to fixture. Fixture insurance: append `?source=fixture` to the URL. https://watson-web.frankkevinwalsh.workers.dev
- [x] Frank's redesign — nav moved to slim TOP bar; AgentTree left pane collapsible; "Demo replay" toggle in the ReplayBar (hides/labels demo eng eng_vb_001 via DEMO_ENGAGEMENT_IDS, scrubber still works on any/real recorded run); Bench rebuilt as live browser TERMINAL (WS "● HERMES ONLINE", COMMENCE over WS greys to RUNNING, spawn/thought/tool/handoff/status/artifact/error stream inline + click-to-console); live-follow tail on Convex appends. Deployed.

## Checkpoint 2 → full end-to-end run #1
- [x] Bench chat → COMMENCE kicks a real engagement (B) — WS chat (terra) + POST /commence both verified; e.g. eng_full_1783800205
- [x] Watercooler produces a real Repo Dossier for the fork (B) — 2 luna scouts fetch real GitHub raw files → 4 card artifacts → terra dossier (kind=dossier) naming trimMessages() weakness
- [x] Library runs real Linkup search → pitches (B) — live api.linkup.so query → luna grader relevance scores → 3 terra pitch artifacts (MemGPT/CoALA/Reflexion, real arXiv ids)
- [ ] One experiment executes in cloud sandbox with live metric events (B+C) — lab calls sandbox /run for top pitch; dynamic role `memory-compaction-specialist` spawned mid-run; runner emits status/metric itself. First run hit container cold-start (handled: pending+retry); added transient retry, re-verifying warm run
- [ ] One real PR opened on watson-vending-bench by the machinery (C)
- [ ] All five views show the run live (D1/D2/D3 + A)

## Stretch: Podcast
- [ ] ElevenLabs research-podcast pipeline — new Worker `workers/podcast/` + `convex/podcast.ts`. POST /generate {engagementId} → pulls the engagement story from Convex → gpt-5.6-terra writes a 2-host script (host + "Watson, research agency president") → ElevenLabs TTS (2 voices, eleven_turbo_v2_5) → MP3 stored in Convex file storage → artifact event (kind `report`, title `podcast`, body=URL) so the UI finds it from events alone. Returns {ok, url, durationSec, script}.

## Blockers (any tab, any time)
Write it here, commit, tell Frank to ping the architect:
- **[B→C] sandbox-runner unhealthy** (watson-sandbox-runner…/): /ping times out (000 after 30s); /run returns `SandboxError: Container is starting. Please retry in a moment.` persistently (across brain's 4x retry). Blocks the last Checkpoint-2 line I own ("experiment executes in cloud sandbox with live metric events"). Brain handles it gracefully (experiment→pending, Hermes recommends retry) so the pipe stays green — re-run COMMENCE once the container serves /run and it captures the real metric with no brain changes.
