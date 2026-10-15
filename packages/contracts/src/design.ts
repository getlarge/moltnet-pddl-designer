import type { SourceCheckRecord } from './source-check.js';
import type { SourceSentence } from '@pddl/domain/provenance';
import type { Issue } from '@pddl/domain/check';
import type { Domain, Problem } from '@pddl/domain/ir';
import type {
  GroundingRow,
  PlanResult,
  Reachability,
  ForcedAnalysis,
} from '@pddl/domain/planner';
import type { DesignInput, StageName } from './stages.js';
export interface PlanReview extends ForcedAnalysis {
  required: Record<string, number>;
  findings: Issue[];
}
export interface StageRecord {
  stage: StageName;
  attempt: number;
  /** `task`: a model produced the result; `edit`: the reviewer replaced it. */
  source: 'task' | 'edit';
  /** The stage task, for `task` records. */
  taskId?: string;
  brief: string;
  result: unknown;
  issues: Issue[];
  durationMs: number;
}

export type DesignStatus =
  'planned' | 'unsolvable' | 'search_limit' | 'invalid' | 'failed';

export interface DesignRun {
  version: 1;
  sourceSentences?: SourceSentence[];
  /** Gates needing renewed approval after an offline edit. */
  needsReview?: StageName[];
  status: DesignStatus;
  failure?: { stage: StageName; reason: string; code?: 'claim-timeout' };
  input: Pick<
    DesignInput,
    | 'description'
    | 'problemDescription'
    | 'domainName'
    | 'problemName'
    | 'correlationId'
  >;
  stages: StageRecord[];
  domain?: Domain;
  problem?: Problem;
  domainPddl?: string;
  problemPddl?: string;
  /** Changes the refine stage reports making to the draft actions. */
  refinements?: string[];
  /** Warnings that remain on the final domain and problem. */
  issues: Issue[];
  grounding?: GroundingRow[];
  reachability?: Reachability;
  plan?: PlanResult;
  /** Plan reviews, one per round, when review is enabled. */
  review?: Array<PlanReview & { round: number }>;
  /** True when the last review found no shortcuts. */
  reviewPassed?: boolean;
  sourceChecks?: SourceCheckRecord[];
  durationMs: number;
}

/** Progress of a run, emitted as it happens, for live display. */
export type DesignEvent =
  | { type: 'task-created'; stage: StageName; attempt: number; taskId: string }
  | { type: 'task-claimed'; stage: StageName; attempt: number; taskId: string }
  | { type: 'stage-checking'; stage: StageName; attempt: number }
  | { type: 'stage-result'; record: StageRecord }
  | { type: 'stage-accepted'; stage: StageName; attempt: number }
  | { type: 'plan-checked'; status: DesignStatus; plan: PlanResult }
  | { type: 'review'; round: number; findings: Issue[] }
  | { type: 'finished'; run: DesignRun };

/** A stage result waiting for the reviewer's decision. */
export interface StageGate {
  stage: StageName;
  attempt: number;
  result: unknown;
  /** Check findings on `result`; errors mean it cannot be accepted. */
  issues: Issue[];
}

export type StageDecision =
  /** Continue with this result. Refused while the checks report errors. */
  | { action: 'accept' }
  /** Replace the result; it is re-checked and the gate asks again. */
  | { action: 'edit'; result: unknown }
  /** Send a correction task carrying this message. */
  | { action: 'feedback'; message: string }
  | { action: 'abort'; reason?: string };
