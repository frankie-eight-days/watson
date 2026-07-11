/**
 * domain.ts — the durable domain entities Watson produces during an engagement.
 *
 * These mirror the Convex data model in PLAN.md §2 and the tables in
 * convex/schema.ts. They are the "nouns" agents create as they work: papers
 * screened, pitches debated, experiments run, PRs shipped, memories written.
 *
 * Every one of these is ALSO announced on the event stream as an `artifact`
 * event whose `refId` points back at the row here — so replay can render them
 * without querying the tables. The tables exist for convenient indexed reads;
 * the event stream is the source of truth.
 *
 * Part of the FROZEN CONTRACT — see packages/shared/README.md.
 */

import type { MetricPoint } from './events';

// ===========================================================================
// Engagement — one client job
// ===========================================================================

export type EngagementPhase =
  | 'bench' // scoping conversation with Hermes
  | 'ingestion' // Watercooler: reading the repo
  | 'library' // paper pipeline
  | 'lab' // experiments in the sandbox
  | 'conference' // report + PRs
  | 'done';

export type EngagementStatus = 'active' | 'paused' | 'completed' | 'failed';

export interface Engagement {
  id: string;
  /** Target repository URL (the Vending-Bench fork). */
  repoUrl: string;
  /** Short human title for the job. */
  title?: string;
  status: EngagementStatus;
  phase: EngagementPhase;
  createdAt: number;
  updatedAt?: number;
}

// ===========================================================================
// Paper — a discovered/screened/distilled research paper
// ===========================================================================

export type PaperStage =
  | 'discovered' // pulled from Linkup search
  | 'screened' // luna grader assigned a relevance score
  | 'distilled' // terra deep-read produced a distillation
  | 'cited' // citation/citedBy pass complete
  | 'pitched'; // fed into a pitch

export interface Paper {
  id: string;
  engagementId: string;
  title: string;
  authors: string[];
  abstract: string;
  url: string;
  stage: PaperStage;
  /** Relevance score 0..1 from the abstract screener (luna). */
  score?: number;
  /** Why the grader scored it as it did. */
  gradeRationale?: string;
  /** Terra deep-read distillation (markdown). */
  distillation?: string;
  /** True once the citation/citedBy pass has run. */
  citationPass?: boolean;
  /** Pitch this paper fed into, if any. */
  pitchId?: string;
  createdAt: number;
}

// ===========================================================================
// Pitch — a research hypothesis produced by the MAD arena
// ===========================================================================

export type PitchStatus =
  | 'proposed'
  | 'testing'
  | 'validated'
  | 'rejected'
  | 'prd'; // a PR has been opened for this pitch

export interface Pitch {
  id: string;
  engagementId: string;
  hypothesis: string;
  /** Paper ids that motivated this pitch. */
  sourcePaperIds: string[];
  /** Expected impact on the headline metric, in prose. */
  expectedImpact: string;
  status: PitchStatus;
  createdAt: number;
}

// ===========================================================================
// Experiment — a sandbox run validating (or refuting) a pitch
// ===========================================================================

export type ExperimentStatus = 'proposed' | 'testing' | 'validated' | 'rejected' | 'failed';

export interface Experiment {
  id: string;
  engagementId: string;
  pitchId: string;
  /** Cloudflare Sandbox SDK container id running this experiment. */
  sandboxId?: string;
  /** Command executed in the sandbox (e.g. the benchmark invocation). */
  command: string;
  status: ExperimentStatus;
  /** Metric before the change (e.g. baseline time-horizon in days). */
  baselineMetric?: number;
  /** Metric after the change. */
  resultMetric?: number;
  /** Unit for the two metrics above (e.g. 'days'). */
  metricUnit?: string;
  /** Pointer to full logs (R2 key / URL). */
  logsRef?: string;
  /** Chart series for the Lab time-horizon chart. */
  series?: MetricPoint[];
  createdAt: number;
}

// ===========================================================================
// PrRecord — a pull request opened on the fork
// ===========================================================================

export type PrState = 'open' | 'merged' | 'closed';

export interface PrRecord {
  id: string;
  engagementId: string;
  /** GitHub PR number. */
  number: number;
  url: string;
  title: string;
  pitchId: string;
  /** Headline metric before/after the PR (for the Conference before/after). */
  metricBefore?: number;
  metricAfter?: number;
  metricUnit?: string;
  state: PrState;
  createdAt: number;
}

// ===========================================================================
// MemoryEntry — three-layer memory (rubric L5)
// ===========================================================================

/**
 * task   — ephemeral working context for the current engagement.
 * client — durable facts about this client/repo across engagements (history).
 * rules  — business/research standards & escalation policy (org-wide).
 */
export type MemoryLayer = 'task' | 'client' | 'rules';

export interface MemoryEntry {
  id: string;
  layer: MemoryLayer;
  /** Present for 'task' (and usually 'client') memories; absent for org 'rules'. */
  engagementId?: string;
  /** Short key/topic for retrieval. */
  key: string;
  /** The remembered content. */
  value: string;
  createdAt: number;
  updatedAt?: number;
}

// ===========================================================================
// Run — replay index (the scrubber & run-diff read this)
// ===========================================================================

export interface Run {
  id: string;
  engagementId: string;
  /** Human label, e.g. 'full run #1', 'demo recording'. */
  label: string;
  /** Inclusive seq bounds within the engagement's event stream. */
  startSeq: number;
  endSeq: number;
  /** Wall-clock bounds (epoch ms) for timing-accurate replay. */
  startTs?: number;
  endTs?: number;
  createdAt: number;
}

// ===========================================================================
// Steering — a human message injected into a specific agent's loop
// ===========================================================================

export interface SteeringMessage {
  id: string;
  engagementId: string;
  /** The agent whose loop this message is injected into. */
  agentId: string;
  text: string;
  from?: string;
  createdAt: number;
  /** True once the target agent has consumed it. */
  consumed?: boolean;
}
