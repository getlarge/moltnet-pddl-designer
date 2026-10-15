import type { ClassifyInput } from '@themoltnet/sdk';
import type { GroundingTarget } from '@pddl/domain/source-grounding';
import type { DesignInput } from '@pddl/contracts/stages';
import type { DesignRun, StageDecision } from '@pddl/contracts/design';
import type { RunSnapshot } from '@pddl/contracts/api';

export interface RunOptions {
  resume?: {
    run: DesignRun;
    stage: import('@pddl/contracts/stages').StageName;
    feedback: string;
  };
  claimTimeoutSec?: number;
}

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
