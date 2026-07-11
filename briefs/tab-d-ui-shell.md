# Tab D — UI Shell (then forks into view tabs)

**Read first:** `PLAN.md`, then `watson/packages/shared/README.md`, then load skills `frontend-design:frontend-design` and `dataviz` before writing any UI. You are one of four parallel Claude sessions; the architect session owns all contracts.

## Mission
Own `watson/apps/web/`. Build the shell + shared components FIRST against the mock fixture, so this tab can fork into per-view tabs (~90 min in): D1 = Bench + Conference, D2 = Watercooler + Library, D3 = Lab.

## Hard rules
- Views render from the `events` table ONLY (via Convex subscriptions or the fixture JSONL through the same rendering path). If you need data that isn't an event, request a contract change via Frank → architect session. This is what makes demo replay possible — it is non-negotiable.
- `packages/shared/` is FROZEN — import types from it, never redefine them.

## Aesthetic (this is judged)
Light theme, "Apple research-lab": airy, precise, calm. Generous whitespace, hairline dividers, one accent color, beautiful numeric typography (tabular figures for metrics), subtle motion on live updates. NOT a dark cyber dashboard. Design tokens defined once, used everywhere.

## Build order
1. **Scaffold:** Vite + React + TS + Tailwind in `apps/web` (fast, deploys clean to Cloudflare). Convex React client. Until Tab A's deployment is live, drive everything from `fixtures/mock-engagement.jsonl` through a local event-source shim WITH THE SAME INTERFACE as the Convex subscription (swap = one line).
2. **Shell:** left nav with the five views (Bench, Watercooler, Library, Lab, Conference), engagement switcher, header with live status + running cost ticker.
3. **Shared components (the reason this tab exists):**
   - **AgentTree** — resizable left pane; nested orchestrator→worker dropdowns from agents table + spawn events; status dots; per-agent token/cost; click → selects agent.
   - **ConsoleDrawer** — bottom drawer for selected agent: live event feed (thoughts, tool calls/results rendered nicely) + steering input box.
   - **EventCard / KanbanBoard** primitives driven by artifact events.
   - **MetricChart** — live-updating line chart for metric series events (this is the Lab money shot — follow the dataviz skill).
   - **ReplayBar** — scrubber: play/pause/speed over an engagement's seq range; in replay mode ALL components read from the cursor position instead of latest.
4. **View skeletons:** all five routes wired with AgentTree + ConsoleDrawer where specified in PLAN.md section 3, canvases stubbed. THEN fork into D1/D2/D3 per PLAN.md view specs.
5. Wire real Convex subscriptions the moment Tab A's deployment is up (H2 checkpoint).

## Checkpoints
- **H1.5:** shell + AgentTree + ConsoleDrawer + ReplayBar working over the fixture; fork into view tabs.
- **H2:** connected to live Convex.
- **H4:** all five canvases functional with real engagement data.

## Rubric you own
Observability UI (trace tree, cost per step, run-diff view — up to 28 pts), management UI, and the WOW factor of the whole demo.

## Deploy from hour zero (policy)
Local = editing only; the product runs in the cloud from your FIRST hour. Deploy a hello-world skeleton of your component to its real cloud target (wrangler deploy / Cloudflare) before building features, then redeploy continuously. Deployment problems (bindings, secrets, WebSockets, Sandbox limits) must surface at H1, not H7. Secrets: local dev sources watson/.env.local; deployed Workers get them via `wrangler secret put`.
