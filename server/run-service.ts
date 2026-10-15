import type { WorkflowContext } from '@themoltnet/tasks-orchestrator';
import type { SourceAssessor } from '../src/source-check.js';
import type { ClassifyInput } from '@themoltnet/sdk';
import type { GroundingTarget } from '../src/source-grounding.js';
import type { DesignInput } from '../src/stages.js';
import type {
  DesignOptions,
  DesignRun,
  StageDecision,
} from '../src/workflow.js';
import type { RunSnapshot } from './types.js';

export type Execute = (
  input: DesignInput,
  options: DesignOptions,
) => Promise<DesignRun>;

export type SourceExecute = (
  input: DesignInput,
  request: ClassifyInput,
  profile: string,
  onTask: (id: string) => void | Promise<void>,
  ctx: WorkflowContext,
) => ReturnType<SourceAssessor>;

export type RunOptions = Pick<DesignOptions, 'resume' | 'claimTimeoutSec'>;

/** API state comes from this service, never from a browser or SSE connection. */
export interface RunService {
  previewSource(
    id: string,
    gateId: string,
    targets: GroundingTarget[],
  ): Promise<ClassifyInput>;
  checkSource(
    id: string,
    gateId: string,
    targets: GroundingTarget[],
    profile: string,
  ): Promise<RunSnapshot>;
  start(input: DesignInput, options: RunOptions): Promise<RunSnapshot>;
  get(id: string): Promise<RunSnapshot | undefined>;
  list(): Promise<RunSnapshot[]>;
  decide(
    id: string,
    gateId: string,
    decision: StageDecision,
  ): Promise<RunSnapshot>;
  withdraw(id: string, reason: string): Promise<RunSnapshot>;
}

export class RunConflict extends Error {}

export const offlineRuns: RunService = {
  async list() {
    return [];
  },
  async get() {
    return undefined;
  },
  async start() {
    throw new Error(
      'Live runs need Postgres. Start the server with PDDL_DATABASE_URL configured.',
    );
  },
  async previewSource() {
    throw new RunConflict('Live runs are unavailable in offline mode.');
  },
  async checkSource() {
    throw new RunConflict('Live runs are unavailable in offline mode.');
  },
  async decide() {
    throw new RunConflict('Live runs are unavailable in offline mode.');
  },
  async withdraw() {
    throw new RunConflict('Live runs are unavailable in offline mode.');
  },
};
