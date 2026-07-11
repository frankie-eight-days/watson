# STATUS BOARD — the tab-to-architect channel

**Every tab:** when you hit a milestone below, check the box, add a one-line note (+ URL if deployed), and commit this file with your work. Keep edits to YOUR section only. The architect session watches this file — it is how convergence gets called.

## Checkpoint 1 → convergence trigger: ALL boxes below checked
When the last box ticks, Frank tells the architect session "run checkpoint 1". Do not wait for a clock time.

### Tab A — Convex
- [ ] Event ingestion endpoint live (emitEvent contract implemented)
- [ ] Fixture loaded into deployment (mock engagement queryable)
- [ ] View queries live: events-by-engagement, agent tree, per-agent feed

### Tab B — Brain
- [ ] Skeleton deployed to Cloudflare (URL: )
- [ ] Bench WebSocket chat responds (Hermes says hello via terra)
- [ ] Toy workflow emits real events into Convex (engagementId: )

### Tab C — Fork + Sandbox
- [ ] Fork runs locally, metric extracted (baseline numbers: )
- [ ] Sandbox SDK verdict: runs in container? (or fallback to GitHub Actions decided)
- [ ] Baseline 3x recorded in fork's baselines.json

### Tab D — UI Shell
- [x] Skeleton deployed to Cloudflare (URL: https://watson-web.frankkevinwalsh.workers.dev) — Worker + static assets, SPA fallback, all 5 routes 200
- [x] Shell + AgentTree + ConsoleDrawer render the fixture — folds events→agents/feed; per-agent cost/tokens; typed console feed
- [x] ReplayBar scrubs the fixture — shared cursor; live-stream and replay use one render path (event-stream-only)
- [ ] FORKED into view tabs D1/D2/D3 — next; view skeletons wired, canvases stubbed with real fixture data (Lab money-shot 23→41d live)

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
