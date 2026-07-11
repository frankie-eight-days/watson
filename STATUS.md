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

## Checkpoint 2 → full end-to-end run #1
- [ ] Bench chat → COMMENCE kicks a real engagement (B)
- [ ] Watercooler produces a real Repo Dossier for the fork (B)
- [ ] Library runs real Linkup search → pitches (B)
- [ ] One experiment executes in cloud sandbox with live metric events (B+C)
- [ ] One real PR opened on watson-vending-bench by the machinery (C)
- [ ] All five views show the run live (D1/D2/D3 + A)

## Blockers (any tab, any time)
Write it here, commit, tell Frank to ping the architect:
- (none)
