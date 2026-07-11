# Seed Pitches — pre-researched, winnable improvements for the Vending-Bench fork

**Purpose (risk #1 mitigation).** These are real, paper-backed improvement
candidates for long-horizon agent performance on our Vending-Bench fork. Watson's
agents run these experiments *for real* in the sandbox and open real PRs — this
file only guarantees the pond has fish. Every citation is re-fetched and
re-verified live by the Library pipeline (Linkup) during a run; the arXiv IDs
below are confirmed as of authoring.

## Why these will move the metric — the fork's actual weakness

The benchmark's difficulty is **long-term coherence**: over a long horizon the
agent must remember suppliers it found, prices it agreed, what's in storage, and
orders in flight. The fork's context manager throws that memory away.

`src/llm/context.ts → trimMessages()` is a **lossy sliding window**: when history
exceeds `maxContextTokens` (69k), it hard-drops the oldest non-system messages
and returns. Nothing is summarized or persisted — the evicted facts are gone. The
agent has `write_scratchpad` / `key_value_store` tools (`src/tools/memory-tools.ts`)
but uses them only ad hoc, so truncation still erases most working state. This is
exactly the "meltdown" / coherence-collapse failure the Vending-Bench paper
documents (Backlund & Petersson, arXiv:2502.15840). Each pitch attacks this seam.

**Metric.** Headline = Total Assets at end of the demo profile (see
`baselines.json` for N). Time-horizon proxy = `daysCompleted` before bankruptcy.
Candidate must beat baseline mean on the same demo profile (same `--event-seed`,
same days, same model gpt-5.6-luna) to be PR-worthy.

---

## Pitch A — Memory compaction (summarize on evict, don't just drop) ★ validate first

**Hypothesis.** Replacing lossy truncation with recursive summarization — when the
window overflows, summarize the oldest messages into a pinned "running memory"
note instead of deleting them — preserves the supplier/price/inventory facts the
agent needs across the horizon, raising end-of-run Total Assets and reducing
bankruptcies.

**Papers.**
- MemGPT: Towards LLMs as Operating Systems — Packer et al., 2023. arXiv:2310.08560.
  (OS-style paging: fixed main context + external memory, summarize on eviction.)
- Vending-Bench — Backlund & Petersson, 2025. arXiv:2502.15840. (Documents the
  long-horizon coherence collapse this targets.)

**Code-change sketch.**
- In `src/llm/context.ts`, add `compactMessages(messages, maxTokens, summarizer)`:
  when over budget, take the oldest evictable block, call a cheap LLM
  (gpt-5.6-luna) to compress it into a `[MEMORY]` summary note capturing durable
  facts (known suppliers + contacts, agreed unit costs, current storage/machine
  inventory, outstanding orders, cash), and replace the block with that single
  pinned message instead of dropping it.
- Swap `trimMessages` → `compactMessages` at its call site in
  `src/llm/tool-loop.ts`. Keep the existing orphaned-tool_result cleanup.

**Expected impact.** Large. Directly restores the memory the benchmark stresses.
This is the pitch to validate end-to-end before H4.

---

## Pitch B — Structured end-of-day state checkpoint (forced write-back)

**Hypothesis.** Forcing the agent to externalize a compact state snapshot to
durable storage at each day boundary — and re-injecting it next morning — makes
key state survive truncation losslessly, without depending on the agent choosing
to use the scratchpad.

**Papers.**
- ReAct: Synergizing Reasoning and Acting in Language Models — Yao et al., 2022.
  arXiv:2210.03629. (Interleaved reasoning/acting traces as a working scratchpad.)
- Cognitive Architectures for Language Agents (CoALA) — Sumers et al., 2023.
  arXiv:2309.02427. (Separates working vs long-term memory — the design here.)

**Code-change sketch.**
- In `src/llm/tool-loop.ts`, when the agent calls `wait_for_next_day`, inject one
  extra turn requiring a `key_value_store` write under a reserved key
  (`daily_state`) with a schema: cash, inventory, supplier list, open orders,
  next-day plan.
- At the start of the next day (`src/runner.ts` day loop / morning notification),
  prepend the persisted `daily_state` as a pinned context message so it is never
  a truncation candidate.

**Expected impact.** Medium–high. Cheaper than A (no summarizer LLM calls), and
composes with A.

---

## Pitch C — Periodic reflection interval (self-critique every N days)

**Hypothesis.** Inserting a short structured reflection every N days ("what made
/ lost money, what to change") and pinning the takeaways stops the agent from
repeating costly mistakes (over-ordering, mispricing, ignoring rent) across the
horizon.

**Papers.**
- Reflexion: Language Agents with Verbal Reinforcement Learning — Shinn et al.,
  2023. arXiv:2303.11366. (Verbal self-reflection stored and reused to avoid
  repeated failures.)
- Generative Agents: Interactive Simulacra of Human Behavior — Park et al., 2023.
  arXiv:2304.03442. (Periodic reflection synthesized from the memory stream.)

**Code-change sketch.**
- In `src/runner.ts`, every `reflectionInterval` days (config-gated, e.g. 7),
  call a reflection prompt over recent daily snapshots (already tracked in
  `dailySnapshots`) + current score; store the result in the pinned `[MEMORY]`
  note / `key_value_store` and surface it in the next morning message.

**Expected impact.** Medium. Highest variance; strongest when the horizon is long
enough for compounding mistakes. Good "third PR" for overflow ammo.

---

## Validation protocol (per pitch)
1. Branch off `main` in the fork.
2. Run the demo profile 3× on the candidate (same seed/days/model as baseline).
3. Extract metric via `npm run metric` (or `scripts/extract-metric.ts`).
4. Compare candidate mean vs `baselines.json` mean. PR only if it beats baseline.
5. PR body: hypothesis, arXiv citation(s), baseline vs candidate numbers, run-log
   link — opened by the PR machinery.
