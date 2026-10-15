import type { SourceAssessor } from '../src/source-check.js';
import type { GroundingTarget } from '../src/source-grounding.js';
/** Synthetic task executor for tests only; never imported by the app server. */
import { FakeTasks } from '@themoltnet/tasks-orchestrator/testing';
import {
  blocksActions,
  blocksPredicates,
  blocksProblemResult,
  blocksTypes,
} from '../src/test-fixtures.js';
import { runPddlDesign } from '../src/workflow.js';
import { Session } from './test-session.js';
import type { Execute } from './run-service.js';
import {
  RunConflict,
  type RunService,
  type RunOptions,
} from './run-service.js';
import type { DesignInput } from '../src/stages.js';
import type { StageDecision } from '../src/workflow.js';
export const syntheticInput = {
  description:
    'Synthetic test: A robotic arm moves blocks. Blocks can be stacked.',
  problemDescription: 'Synthetic test: Build a tower a on b on c.',
  domainName: 'synthetic-blocks',
  problemName: 'tower',
  teamId: 'test-team',
  diaryId: 'test-diary',
  profileId: 'test-profile',
  correlationId: 'test-correlation',
};
export const syntheticResults: Record<string, unknown> = {
  types: {
    types: blocksTypes.types.map((t) => ({ ...t, sourceLines: [1] })),
  },
  predicates: {
    predicates: blocksPredicates.predicates.map((p) => ({
      ...p,
      sourceLines: [2],
    })),
  },
  actions: {
    actions: blocksActions.map((a) => ({ ...a, sourceLines: [2] })),
  },
  refine: {
    actions: blocksActions.map((a) => ({ ...a, sourceLines: [2] })),
    changes: [],
  },
  problem: blocksProblemResult,
};
export const syntheticExecute: Execute = (input, options) => {
  return runPddlDesign(
    new FakeTasks((body) => ({
      summary: 'Synthetic browser test result',
      result:
        syntheticResults[
          body.tags?.find((t) => t.startsWith('stage:'))?.slice(6) ?? ''
        ],
    })),
    input,
    options,
  );
};

/** Explicitly non-durable service for isolated API/browser fixtures only. */
export class MemoryRuns implements RunService {
  private sessions = new Map<string, Session>();
  constructor(
    private execute: Execute = syntheticExecute,
    private assess: SourceAssessor = syntheticAssess,
  ) {}
  async start(input: DesignInput, options: RunOptions) {
    if (
      [...this.sessions.values()].some((s) =>
        ['running', 'awaiting'].includes(s.snapshot.state),
      )
    )
      throw new RunConflict(
        'Finish or withdraw the current run before starting another.',
      );
    const session = new Session(input, this.execute, options, this.assess);
    this.sessions.set(session.snapshot.id, session);
    void session.start(input);
    return session.snapshot;
  }
  async get(id: string) {
    return this.sessions.get(id)?.snapshot;
  }
  async list() {
    return [...this.sessions.values()]
      .map((s) => s.snapshot)
      .filter((s) => ['running', 'awaiting'].includes(s.state));
  }
  async decide(id: string, gateId: string, decision: StageDecision) {
    const session = this.sessions.get(id);
    if (!session) throw new RunConflict('Run not found.');
    try {
      session.decide(gateId, decision);
    } catch (e) {
      throw new RunConflict((e as Error).message);
    }
    return session.snapshot;
  }
  async previewSource(id: string, gateId: string, targets: GroundingTarget[]) {
    const session = this.sessions.get(id);
    if (!session) throw new RunConflict('Run not found.');
    return session.previewSource(gateId, targets);
  }
  async checkSource(
    id: string,
    gateId: string,
    targets: GroundingTarget[],
    profile: string,
  ) {
    const session = this.sessions.get(id);
    if (!session) throw new RunConflict('Run not found.');
    return session.checkSource(gateId, targets, profile);
  }
  async withdraw(id: string, reason: string) {
    const snapshot = await this.get(id);
    if (!snapshot?.gate) throw new RunConflict('No review is waiting.');
    return this.decide(id, snapshot.gate.id, { action: 'abort', reason });
  }
}

/** Local fixture for interaction tests; these are not model evaluations. */
export const syntheticAssess: import('../src/source-check.js').SourceAssessor =
  async (input, _profile, onTask) => {
    onTask('synthetic-source-check');
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (_profile === 'synthetic-failure')
      throw new Error('Synthetic provider unavailable.');
    const labels = ['supported', 'contradicted', 'not_established'] as const;
    const answers = Object.fromEntries(
      Object.keys(input.questions).map((id, index) => {
        const label = labels[index % labels.length];
        return [
          id,
          {
            type: 'choice' as const,
            choice: label,
            confidence: 0.9,
            probabilities: Object.fromEntries(
              labels.map((option) => [option, option === label ? 0.96 : 0.02]),
            ),
          },
        ];
      }),
    );
    return {
      taskId: 'synthetic-source-check',
      output: { version: 1, answers },
      usage: {
        model: 'synthetic fixture',
        provider: 'local',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    };
  };
