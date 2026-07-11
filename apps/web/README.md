# @watson/web — the Watson console (Tab D)

The five-view UI shell for Watson, driven entirely by the event stream. Light
"Apple research-lab" theme; every view renders by folding `WatsonEvent[]` up to a
shared replay cursor, so live and replay are the same interaction.

## Run it

From the **repo root** (`watson/`):

```bash
npm install            # workspaces install (once)
npm --workspace @watson/web run dev     # → http://localhost:5173
```

or from `apps/web/`:

```bash
npm run dev            # Vite dev server
npm run build          # tsc --noEmit + vite build → dist/
npm run typecheck      # tsc --noEmit only
npm run deploy         # build + wrangler deploy (Cloudflare Worker, static assets)
```

**Live URL:** https://watson-web.frankkevinwalsh.workers.dev

Deployed as a **Cloudflare Worker with static assets** (see `wrangler.jsonc`,
`not_found_handling: single-page-application` for react-router deep links) — not
Cloudflare Pages. Re-deploy after changes with a single `npx wrangler deploy`
(the `deploy` script builds first).

## The event-source swap seam (fixture → Convex = ONE line)

The app runs fully offline from the frozen fixture today. To go live on Convex,
flip one constant in **`src/lib/config.ts`**:

```ts
export const EVENT_SOURCE: EventSourceKind = 'fixture'; // ← change to 'convex'
```

- `FixtureEventSource` (`src/lib/eventSource.ts`) parses
  `fixtures/mock-engagement.jsonl` (imported via Vite `?raw` — single source of
  truth, never copied) into `WatsonEvent[]`.
- `ConvexEventSource` (same file) is a typed stub wired to `convex/react` /
  `convex/browser`. Its `subscribe()` has the exact same signature; only the query
  name is a placeholder — **Tab A owns the real Convex query names**. Fill them in
  and set `VITE_CONVEX_URL`.

Both implement `EngagementSource.subscribe(engagementId, cb)`. The source only
answers "what events exist so far"; the **shared replay cursor**
(`state/EngagementProvider.tsx`) is the single time mechanism and walks whatever
events the source delivers — identical code path for fixture and live.

## Hard rule: render from the event stream only

No component reads state that isn't derivable from `WatsonEvent[]`. All derivation
lives in `src/lib/fold.ts` (pure folds: agents, org tree, per-agent + engagement
totals, artifacts, metric series, agent feeds). This is what makes demo replay
possible. `@watson/shared` types are imported, never redefined.

## Component inventory

| Component | File | Role |
|---|---|---|
| **Shell** | `components/Shell.tsx` | Frame: nav + header + routed view + console + replay bar |
| **NavRail** | `components/NavRail.tsx` | Five-view nav, active state, engagement switcher |
| **Header** | `components/Header.tsx` | Status pill, token count, cost ticker |
| **CostTicker** | `components/CostTicker.tsx` | Running engagement cost, tweens + flashes on increase |
| **AgentTree** | `components/AgentTree.tsx` | Resizable org tree from `spawn`+`status`; status dots; rolled-up per-agent tokens/cost; click-to-select |
| **ConsoleDrawer** | `components/ConsoleDrawer.tsx` | Bottom drawer: selected agent's typed event feed (thought / correlated tool_call+result / handoff / error / status / …) + steering input (stub) |
| **EventCard** | `components/EventCard.tsx` | Card from an `artifact` event (kind/title/body/url) |
| **KanbanBoard** | `components/KanbanBoard.tsx` | Groups artifact cards into columns by a caller-provided stage fn |
| **MetricChart** | `components/MetricChart.tsx` | Live multi-line SVG chart for `metric` series (baseline vs candidate), hover crosshair, direct end-labels, tabular figures |
| **ReplayBar** | `components/ReplayBar.tsx` | The signature instrument: play/pause, 1×/5×/15×/30×, draggable seq/time cursor with artifact markers — drives the shared cursor |
| **ResizablePane** | `components/ResizablePane.tsx` | Draggable-width left pane |
| primitives | `components/primitives.tsx` | StatusDot, TierBadge, Pill, Eyebrow, Stat, EmptyState |

### State & hooks

- `state/EngagementProvider.tsx` — owns the cursor + all folds; picks the source.
- `state/hooks.ts` — `useEngagementEvents()`, `useAgents()`, `useReplay()`,
  `useSelection()`.

### Views (`src/views/`)

`BenchView` · `WatercoolerView` · `LibraryView` · `LabView` · `ConferenceView`
(Watercooler + Lab include the AgentTree; the console + replay bar are global).

## Design tokens

Defined **once** in `src/index.css` (CSS variables) and surfaced to Tailwind in
`tailwind.config.js`. One accent (research-instrument indigo `#3a45d6`); chart
series palette validated with the dataviz skill. Every number wears `.tnum`
(tabular figures). The app deliberately commits to a single light look (no dark
theme).

## Stubbed / flagged

- **Steering input** in ConsoleDrawer holds messages locally and logs them —
  Tab A/B own real steering injection.
- **Bench repo-URL field + COMMENCE button** are styled but disabled — Tab B owns
  the WebSocket Bench TUI.
- **ConvexEventSource** query names are placeholders — Tab A owns them.
