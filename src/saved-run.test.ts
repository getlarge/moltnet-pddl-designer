import { describe, expect, it } from 'vitest';
import { editRun, passSavedStage, readRun, recheckRun } from './saved-run.js';
import { checkSources, sourceLines, sourceSentences } from './provenance.js';
import {
  blocksActions,
  blocksPredicates,
  blocksProblemResult,
  blocksTypes,
} from './test-fixtures.js';
import type { DesignRun } from './workflow.js';
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
