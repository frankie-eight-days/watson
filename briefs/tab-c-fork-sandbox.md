# Tab C — Bench Fork + Sandbox + PR Machinery

**Read first:** `PLAN.md`, then `watson/packages/shared/README.md`. You are one of four parallel Claude sessions; the architect session owns all contracts.

## Mission
Own the Vending-Bench fork (separate GitHub repo — the architect session will hand you the chosen fork URL from recon) and `watson/workers/sandbox-runner/`. You make "real experiments in the cloud, real PRs on a real repo" TRUE.

## Hard rules
- The fork is a REAL repo under `frankie-eight-days` — judges will open it. PRs must be real PRs with descriptions citing the paper/pitch that motivated them and before/after numbers.
- Skills to load: `sandbox-sdk`, `wrangler`, `workers-best-practices`.

## Deliverables, in order
1. **Fork runs locally first.** Clone the fork, get a shortened benchmark run working against an OpenAI-compatible endpoint (gpt-5.6-luna as the agent-under-test to keep runs fast/cheap), and confirm programmatic metric extraction (time-horizon number → JSON). If run length is configurable, define a "demo profile" (minutes, not hours) and record it in the fork's README.
2. **Baseline:** run the demo profile 3x, record baseline metric (mean + per-run) into a `baselines.json` in the fork and report numbers to Frank. This is the "N" in the N→M chart.
3. **Sandbox-runner service** (`workers/sandbox-runner/`, Cloudflare Sandbox SDK): HTTP API — POST {repoUrl, ref, command, experimentId, engagementId} → provisions container, clones, installs, runs, streams stdout lines and parsed metric points as `metric`/`status` events via emitEvent, returns final metric JSON. Prove clone→run→metric inside the sandbox **by H2** — if the Sandbox SDK fights us (deps, limits, cold start), STOP and switch to fallback: GitHub Actions workflow in the fork as the executor (workflow_dispatch, results committed as artifacts/JSON, sandbox-runner polls). Decide by H2:30, don't sink time.
4. **PR machinery:** small lib (used by Tab B): create branch, apply patch/edits, commit, open PR with a templated body (pitch, paper citations, baseline vs candidate numbers, run log link). gh CLI is authed locally; the Worker path needs a GitHub token — get from Frank, store as Worker secret.
5. **Seed the pond (risk #1):** research and pre-validate 2–3 REAL improvement candidates for long-horizon agent performance on this bench (e.g. memory compaction/summarization cadence, structured scratchpad, reflection intervals). For each: a note in `watson/fixtures/seed-pitches.md` with hypothesis, the real paper(s) it comes from (arXiv links), and a sketch of the code change. Watson's agents must genuinely run the experiments; you're just ensuring winnable pitches exist. Verify at least ONE actually improves the metric locally before H4.

## Checkpoints
- **H2:** fork runs in sandbox (or fallback decided), baseline recorded.
- **H4:** one seeded improvement validated end-to-end: branch → sandbox run → metric beats baseline → PR opened by machinery.

## Rubric you own
Root parameter reality (real repo, real runs, real PRs), evals (baseline = named eval set; the demo profile is the versioned benchmark), Cloudflare Sandbox power-up story.
