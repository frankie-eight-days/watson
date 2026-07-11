# Watson

Watson is an AI research agency on retainer. **Hermes**, the president agent, ingests your
repo, pulls the latest papers, runs real experiments in cloud sandboxes, and ships PRs
against your repo — provably making your agents run longer. The product surfaces as five
live views: **Bench** (chat with Hermes to scope the job), **Watercooler** (repo ingestion
converging to a dossier), **Library** (paper pipeline from discovery through multi-agent
debate to pitches), **Lab** (live experiments with time-horizon charts and PR moments),
and **Conference** (PRs, the HTML report, and metrics). Every agent step flows through a
single `emitEvent()` pipe into one Convex events table, which powers all live views, the
observability trace tree, run diffing, and demo replay.

## Workspace map

| Path | Package | Owner |
|---|---|---|
| `apps/web` | `@watson/web` | Tab D — UI shell |
| `workers/brain` | `@watson/brain` | Tab B — Hermes DO + workflow agents |
| `workers/sandbox-runner` | `@watson/sandbox-runner` | Tab C — Cloudflare Sandbox SDK execution |
| `convex/` | — | Tab A — Convex functions |
| `packages/shared` | `@watson/shared` | Architect session — the frozen contract |
| `briefs/` | — | Per-tab kickoff briefs |
| `fixtures/` | — | Mock event streams / test fixtures |

npm workspaces monorepo. Node v25.

## Hard rules

1. **The contract is frozen.** `packages/shared` and `convex/schema.ts` are the shared
   contract. Every tab treats them as read-only; changes happen **only via the architect
   session** — never edited directly in a view or backend tab.
2. **Views render from the `events` table ONLY.** If any view reads state that is not
   derivable from the event stream, replay breaks. This is a hard requirement for every
   tab: the UI must be reconstructable purely by replaying `events` by `seq`.
