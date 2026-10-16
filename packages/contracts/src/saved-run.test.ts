import {
  buildGroundingRequest,
  groundingTargets,
} from '@pddl/domain/source-grounding';
import { readSourceChecks } from './source-check.js';
import { blocksDomain } from '@pddl/domain/test-fixtures';
import { describe, expect, it } from 'vitest';
import { editRun, passSavedStage, readRun, recheckRun } from './saved-run.js';
import {
  checkSources,
  sourceLines,
  sourceSentences,
} from '@pddl/domain/provenance';
import {
  blocksActions,
  blocksPredicates,
  blocksProblemResult,
  blocksTypes,
} from '@pddl/domain/test-fixtures';
import type { DesignRun } from './design.js';
import { renderDomainWithTiming, renderProblem } from '@pddl/domain/render';
export function savedFixture(): DesignRun {
  return {
    version: 1,
    status: 'planned',
    input: {
      description: 'Blocks can be stacked by a robotic arm.',
      problemDescription: 'Build a tower a on b on c.',
      domainName: 'blocks-world',
      problemName: 'tower',
      correlationId: 'saved',
    },
    durationMs: 500,
    issues: [],
    stages: [
      { stage: 'types', result: blocksTypes },
      { stage: 'predicates', result: blocksPredicates },
      { stage: 'actions', result: { actions: blocksActions } },
      { stage: 'refine', result: { actions: blocksActions, changes: [] } },
      { stage: 'problem', result: blocksProblemResult },
    ].map((s) => ({
      ...s,
      stage: s.stage as DesignRun['stages'][number]['stage'],
      attempt: 1,
      source: 'task',
      brief: 'synthetic test fixture',
      issues: [],
      durationMs: 100,
    })),
  };
}
describe('saved proof revisions', () => {
  it('rechecks a saved timed model and drops its old VAL claim', () => {
    const original = recheckRun(savedFixture());
    const action = original.domain!.actions[0];
    const timed = {
      name: action.name,
      parameters: action.parameters,
      durationSeconds: 120,
      conditions: action.preconditions.map((item) => ({
        ...item,
        timing: 'start' as const,
      })),
      effects: [
        ...action.addEffects.map((item) => ({
          ...item,
          negated: false,
          timing: 'end' as const,
        })),
        ...action.deleteEffects.map((item) => ({
          ...item,
          negated: true,
          timing: 'end' as const,
        })),
      ],
    };
    original.temporal = {
      status: 'complete',
      detections: [{ action: action.name, probability: 0.97, timed: true }],
      durativeActions: [timed],
      defaultedClauses: [],
      domainPddl: renderDomainWithTiming(original.domain!, [timed]),
      problemPddl: renderProblem(original.problem!, original.domain!.name),
      temporalPlan: {
        status: 'validated',
        text: `0: (${action.name} a) [120]\n`,
        validator: 'VAL',
      },
    };
    const loaded = readRun(original);
    expect(loaded.temporal).toMatchObject({
      status: 'complete',
      temporalPlan: { status: 'candidate' },
    });
    expect(
      loaded.temporal?.status === 'complete' && loaded.temporal.domainPddl,
    ).toContain(':durative-actions');
    expect(
      editRun(loaded, 'actions', loaded.stages[2].result).temporal,
    ).toBeUndefined();
    const tampered = structuredClone(original);
    if (tampered.temporal?.status === 'complete')
      tampered.temporal.durativeActions[0].conditions = [];
    expect(readRun(tampered).temporal).toMatchObject({ status: 'failed' });
  });
  it('preserves audit evidence through save/load and invalidates it after a draft edit', () => {
    const input = () =>
      buildGroundingRequest(
        'Blocks can be stacked by a robotic arm.',
        blocksDomain,
        [groundingTargets(blocksDomain)[0]],
      );
    const output = () => ({
      version: 1 as const,
      answers: {
        claim_1: {
          type: 'choice' as const,
          choice: 'supported',
          probabilities: {
            supported: 0.9,
            contradicted: 0.05,
            not_established: 0.05,
          },
          confidence: 0.8,
        },
      },
    });
    const record = {
      attempt: 1,
      input: input(),
      status: 'complete' as const,
      taskId: 'synthetic-task',
      output: output(),
      durationMs: 10,
    };
    const run = savedFixture();
    run.sourceChecks = [record];
    expect(readRun(run).sourceChecks).toEqual([record]);
    expect(
      editRun(run, 'actions', run.stages[2].result).sourceChecks,
    ).toBeUndefined();
    expect(() =>
      readSourceChecks([{ ...record, output: { version: 1, answers: {} } }]),
    ).toThrow();
  });
  it('recomputes imported derived data and preserves legacy runs without provenance', () => {
    const original = savedFixture();
    original.plan = { status: 'found', steps: ['invented'], explored: 1 };
    const run = readRun(original);
    expect(run.plan?.status === 'found' && run.plan.steps).toHaveLength(4);
    expect(run.sourceSentences).toHaveLength(1);
    expect(run.stages[0].result).toEqual(blocksTypes);
  });
  it('invalidates plans and dependent approvals after a type is removed', () => {
    const original = recheckRun(savedFixture());
    const revised = editRun(original, 'types', {
      types: [blocksTypes.types[0]],
    });
    expect(original.plan?.status).toBe('found');
    expect(revised.plan).toBeUndefined();
    expect(revised.domainPddl).toBeUndefined();
    expect(revised.failure?.stage).toBe('predicates');
    expect(revised.needsReview).toEqual([
      'types',
      'predicates',
      'actions',
      'refine',
      'problem',
    ]);
    expect(() => passSavedStage(revised, 'problem')).toThrow();
  });
  it('keeps schema-rejected edits for repair without mutating the original', () => {
    const original = savedFixture();
    const edited = editRun(original, 'types', { types: 'bad' });
    expect(edited.stages.at(-1)?.result).toEqual({ types: 'bad' });
    expect(edited.status).toBe('invalid');
    expect(original.stages).toHaveLength(5);
    expect(() => passSavedStage(edited, 'types')).toThrow();
  });
  it('does not keep stale refinement when draft actions change', () => {
    const edited = editRun(savedFixture(), 'actions', {
      actions: blocksActions.filter((a) => a.name !== 'stack'),
    });
    expect(
      (
        edited.stages.findLast((s) => s.stage === 'refine')?.result as {
          actions: unknown[];
        }
      ).actions,
    ).toHaveLength(3);
    expect(edited.plan?.status).not.toBe('found');
    expect(edited.reviewPassed).toBeUndefined();
  });
  it('rechecks an offline correction and requires passes in order', () => {
    const edited = editRun(savedFixture(), 'refine', {
      actions: blocksActions,
      changes: ['Reviewed.'],
    });
    expect(edited.plan?.status).toBe('found');
    expect(edited.needsReview).toEqual(['refine', 'problem']);
    expect(() => passSavedStage(edited, 'problem')).toThrow('preceding');
    expect(
      passSavedStage(passSavedStage(edited, 'refine'), 'problem').needsReview,
    ).toEqual([]);
  });
  it('rejects malformed imports and unknown versions', () => {
    expect(() => readRun({ ...savedFixture(), version: 2 })).toThrow();
    expect(() =>
      readRun({ ...savedFixture(), stages: [{ stage: 'bogus' }] }),
    ).toThrow();
  });
});
describe('source evidence', () => {
  it('numbers sentences deterministically and refuses out-of-range references', () => {
    const sentences = sourceSentences(
      'An arm moves blocks. A clear block can be stacked.',
    );
    expect(sentences.map((s) => s.line)).toEqual([1, 2]);
    expect(
      checkSources({ types: [{ sourceLines: [3] }] }, sentences)[0].code,
    ).toBe('source-line');
  });
  it('links exact unique legacy quotes but never partial or ambiguous ones', () => {
    const sentences = sourceSentences(
      'Blocks move. Blocks move. An arm lifts.',
    );
    expect(sourceLines({ source: 'Blocks move.' }, sentences)).toEqual([]);
    expect(sourceLines({ source: 'An arm' }, sentences)).toEqual([]);
    expect(sourceLines({ source: 'An arm lifts.' }, sentences)).toEqual([3]);
  });
});

it('rejects malformed readable claim metadata before displaying imported evidence', () => {
  const input = buildGroundingRequest('Blocks can be moved.', blocksDomain, [
    groundingTargets(blocksDomain)[0],
  ]);
  const record = { attempt: 1, input, status: 'failed', durationMs: 0 };
  const claims = input.state.claims as Record<string, Record<string, unknown>>;
  const claim = claims.claim_1;
  claim.formalStatement = 'Formal rule';
  claim.wording = 'readable';
  claim.participants = { '?a': 'the arm' };
  expect(readSourceChecks([record])[0].input).toEqual(input);
  claim.participants = { '?a': { invalid: 'object' } };
  expect(() => readSourceChecks([record])).toThrow(
    'readable source-check metadata',
  );
  claim.participants = { '?a': 'the arm' };
  claim.formalStatement = { invalid: 'object' };
  expect(() => readSourceChecks([record])).toThrow(
    'readable source-check metadata',
  );
});
