/** Synthetic task executor for tests only; never imported by the app server. */
import { FakeTasks } from '@themoltnet/tasks-orchestrator/testing';
import {
  blocksActions,
  blocksPredicates,
  blocksProblemResult,
  blocksTypes,
} from '../src/test-fixtures.js';
import { executor, type Execute } from './sessions.js';
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
export const syntheticExecute: Execute = (input, options, warningReview) => {
  const results: Record<string, unknown> = {
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
  const tasks = new FakeTasks((body) =>
    body.taskType === 'classify'
      ? {
          version: 1,
          answers: { answer: { type: 'bool', probability: 0.04 } },
        }
      : {
          summary: 'Synthetic browser test result',
          result:
            results[
              body.tags?.find((t) => t.startsWith('stage:'))?.slice(6) ?? ''
            ],
        },
  );
  return executor(tasks)(input, options, warningReview);
};
