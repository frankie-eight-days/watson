# @watson/sandbox-runner

Cloudflare **Sandbox SDK** execution service + GitHub **PR machinery** — owned by Tab C.

Live: **https://watson-sandbox-runner.frankkevinwalsh.workers.dev**

It runs the Vending-Bench fork end-to-end inside a real Cloudflare Sandbox
container (clone → `npm install` → run the demo profile → extract the metric
JSON), streams progress + parsed metric points into Convex via the frozen
`emitEvent` contract, and opens real PRs on the fork.

## Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness (no container). Reports whether secrets are loaded. |
| GET | `/ping` | Spins a dedicated health container and runs `echo` (infra proof). |
| POST | `/run` | Clone + install + run a benchmark profile, return the metric. |
| POST | `/pr` | Create branch + commit files + open a templated PR on the fork. |

## POST /run — the contract the brain's Lab calls

Request body:

```jsonc
{
  "engagementId": "eng_vb_001",   // required — Convex engagement to emit into
  "agentId": "lab-runner",         // required — the emitting agent id
  "experimentId": "exp_001",       // required — also the sandbox instance key
  "repoUrl": "https://github.com/frankie-eight-days/watson-vending-bench.git", // required
  "ref": "main",                   // branch/tag/sha (default "main")
  "command": "npm run run:demo",   // command to run in the repo (default npm run run:demo)
  "seriesLabel": "baseline"        // chart line label: "baseline" | "candidate" (default "candidate")
}
```

Response:

```jsonc
{
  "ok": true,
  "metric": {                      // the fork's CanonicalMetric (scripts/extract-metric.ts)
    "schemaVersion": 1,
    "metricName": "totalAssets",
    "totalAssets": 843.0,          // headline score (the N / M in the chart)
    "daysCompleted": 30,           // time-horizon / survival proxy
    "totalDays": 30,
    "totalRevenue": 574.75,
    "totalItemsSold": 216,
    "estimatedCostUsd": 0.64,
    "wallTimeSeconds": 101.2,
    "model": "gpt-5.6-luna",
    "provider": "openai",
    "series": [ { "day": 1, "totalAssets": 498 }, ... ]  // per-day trajectory
  },
  "logsTail": "…tail of run stdout…"
}
```

**Events emitted to Convex** (`${CONVEX_SITE_URL}/emit`, frozen `emitEvent` batch
contract) during a run, under the given `engagementId` / `agentId`:

- `status` events for each phase (provisioning → cloning → npm install →
  executing → extracting → done), each a `StatusPayload { status, detail }`.
- `metric` events: one **incremental** point per simulated day parsed live from
  the run's stdout (`name:"totalAssets"`, `series:[{x:day,y:assets}]`,
  `seriesLabel`), then a **final** `metric` with the full series + a
  `daysCompleted` metric. This powers the Lab time-horizon chart live.
- `error` events on clone/install/run/extract failure.

Timing: expect **~150–180 s** per response (cold-start + clone + `npm install` +
~100 s sim). All container ops retry through transient
`"Container is starting"` cold-start errors, and `/run` warm-starts the container
first, so a cold instance never surfaces as an error.

Example:

```bash
curl -X POST https://watson-sandbox-runner.frankkevinwalsh.workers.dev/run \
  -H 'content-type: application/json' \
  -d '{"engagementId":"eng_x","agentId":"lab-runner","experimentId":"exp_x",
       "repoUrl":"https://github.com/frankie-eight-days/watson-vending-bench.git",
       "ref":"main","command":"npm run run:demo","seriesLabel":"baseline"}'
```

Candidate run: same call with `"ref":"feat/memory-compaction"` and
`"seriesLabel":"candidate"`.

## POST /pr — open the real PR (the root-parameter money shot)

**This is what the brain's Lab workflow calls to open the winning PR during the
recorded run.** The winning candidate branch (`feat/memory-compaction`) is left
UN-merged and un-PR'd on purpose so the Lab triggers the real PR live.

Request body:

```jsonc
{
  "engagementId": "eng_vb_001",
  "pitchTitle": "Memory compaction (summarize-on-evict)",
  "title": "feat: memory compaction beats baseline on the demo profile", // optional PR title
  "branchName": "feat/memory-compaction",   // branch to open the PR FROM (already pushed)
  "patchDescription": "Replaces lossy sliding-window truncation with MemGPT-style summarize-on-evict…",
  "files": [                                  // optional — omit to PR an already-pushed branch as-is*
    { "path": "src/llm/context.ts", "content": "…full file contents…" }
  ],
  "metricBefore": 821.80,                     // baseline mean (N)
  "metricAfter": 843.00,                      // candidate mean (M)
  "citations": [
    { "title": "MemGPT — Packer et al. 2023 (arXiv:2310.08560)", "url": "https://arxiv.org/abs/2310.08560" },
    { "title": "Vending-Bench — Backlund & Petersson 2025 (arXiv:2502.15840)", "url": "https://arxiv.org/abs/2502.15840" }
  ],
  "runLogUrl": "https://…",                   // optional
  "draft": false,                             // optional (default false)
  "owner": "frankie-eight-days",              // optional (defaults set)
  "repo": "watson-vending-bench",             // optional
  "base": "main"                              // optional (default main)
}
```

Response: `{ ok, prUrl, prNumber, branch, commitSha }`.

Behavior: creates blobs → a tree on top of `base` → a commit → the branch ref
(force-updates if it already exists) → opens the PR with a **templated body**
(pitch, baseline-vs-candidate table with delta %, arXiv citations, run-log link).

\* The candidate branch `feat/memory-compaction` is already pushed with the full
change. To open its PR during the recorded run, the simplest payload commits a
tiny marker file on top (so `files` is non-empty) OR passes the changed source
files. To PR the pushed branch verbatim with no extra commit, open it with the
GitHub API directly (`base=main`, `head=feat/memory-compaction`); the templated
`/pr` path always adds one commit.

### Exact payload to open the winning PR during the recorded run

```bash
curl -X POST https://watson-sandbox-runner.frankkevinwalsh.workers.dev/pr \
  -H 'content-type: application/json' \
  -d '{
    "engagementId":"<engagementId>",
    "pitchTitle":"Memory compaction (summarize-on-evict)",
    "title":"feat: memory compaction — Total Assets $821.80 → $843.00 on the demo profile",
    "branchName":"lab/memory-compaction-<engagementId>",
    "patchDescription":"Pitch A. Replaces the lossy sliding-window truncation in src/llm/context.ts (trimMessages) with MemGPT-style summarize-on-evict: when the context window overflows, the oldest block is folded into a pinned [MEMORY] note instead of dropped, preserving supplier/price/inventory/order facts across the horizon. Gated by --memory-compaction; the demo profile enables it.",
    "files":[ {"path":"...","content":"..."} ],
    "metricBefore":821.80,
    "metricAfter":843.00,
    "citations":[
      {"title":"MemGPT: Towards LLMs as Operating Systems — Packer et al. 2023 (arXiv:2310.08560)","url":"https://arxiv.org/abs/2310.08560"},
      {"title":"Vending-Bench — Backlund & Petersson 2025 (arXiv:2502.15840)","url":"https://arxiv.org/abs/2502.15840"}
    ]
  }'
```

## Config & secrets

- Container image: `Dockerfile` (base `cloudflare/sandbox:0.7.0` + git).
- `wrangler.jsonc`: Sandbox Durable Object, `instance_type: lite`,
  `max_instances: 5` (so a live UI /ping never collides with a running /run).
- Secrets (via `npx wrangler secret put`): `OPENAI_API_KEY` (agent-under-test),
  `GITHUB_TOKEN` (`gh auth token`), `CONVEX_SITE_URL`.

## Do NOT redeploy during a recorded run

Redeploying resets the Sandbox Durable Object mid-run
(`"Durable Object reset because its code was updated"`), failing the in-flight
`/run`. Freeze deploys once the recorded engagement starts.
