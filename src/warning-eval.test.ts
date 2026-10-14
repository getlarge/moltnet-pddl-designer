import { readFileSync } from 'node:fs';

import { FakeTasks } from '@themoltnet/tasks-orchestrator/testing';
import { describe, expect, it } from 'vitest';

import { scoreRun } from '../scripts/score-runs.js';
import { createClassifyQuestionClient } from './decision.js';
import type { Domain, Problem } from './ir.js';
import { validatePlan } from './planner.js';
import { runPddlDesign } from './workflow.js';

const domain: Domain = {
  name: 'inspection',
  types: [
    { name: 'station', description: 'Station' },
    { name: 'parcel', description: 'Parcel' },
  ],
  predicates: [
    {
      name: 'idle',
      parameters: [{ name: '?s', type: 'station' }],
      description: 'Ready for inspection',
    },
    {
      name: 'inspected',
      parameters: [{ name: '?s', type: 'station' }],
      description: 'Fresh inspection',
    },
    {
      name: 'ready',
      parameters: [{ name: '?p', type: 'parcel' }],
      description: 'Ready to process',
    },
    {
      name: 'done',
      parameters: [{ name: '?p', type: 'parcel' }],
      description: 'Processed',
    },
  ],
  actions: [
    {
      name: 'inspect-station',
      parameters: [{ name: '?s', type: 'station' }],
      preconditions: [{ predicate: 'idle', args: ['?s'], negated: false }],
      addEffects: [{ predicate: 'inspected', args: ['?s'] }],
      deleteEffects: [{ predicate: 'idle', args: ['?s'] }],
      source: 'Inspect an idle station.',
    },
    {
      name: 'process-parcel',
      parameters: [
        { name: '?s', type: 'station' },
        { name: '?p', type: 'parcel' },
      ],
      preconditions: [
        { predicate: 'inspected', args: ['?s'], negated: false },
        { predicate: 'ready', args: ['?p'], negated: false },
      ],
      addEffects: [
        { predicate: 'done', args: ['?p'] },
        { predicate: 'idle', args: ['?s'] },
      ],
      deleteEffects: [{ predicate: 'ready', args: ['?p'] }],
      source: 'Processing consumes the fresh inspection.',
    },
  ],
};
const problem: Problem = {
  name: 'two-parcels',
  objects: [
    { name: 'station-1', type: 'station' },
    { name: 'parcel-1', type: 'parcel' },
    { name: 'parcel-2', type: 'parcel' },
  ],
  init: [
    { predicate: 'idle', args: ['station-1'] },
    { predicate: 'ready', args: ['parcel-1'] },
    { predicate: 'ready', args: ['parcel-2'] },
  ],
  goal: [
    { predicate: 'done', args: ['parcel-1'], negated: false },
    { predicate: 'done', args: ['parcel-2'], negated: false },
  ],
};
const badPlan = [
  '(inspect-station station-1)',
  '(process-parcel station-1 parcel-1)',
  '(process-parcel station-1 parcel-2)',
];
const goodPlan = [badPlan[0], badPlan[1], badPlan[0], badPlan[2]];

describe('warning review evaluation controls', () => {
  it('rejects stale inspection reuse after supported refinement while preserving a valid plan', async () => {
    const fixed = domain.actions.map((a) =>
      a.name === 'process-parcel'
        ? {
            ...a,
            deleteEffects: [
              ...a.deleteEffects,
              { predicate: 'inspected', args: ['?s'] },
            ],
          }
        : a,
    );
    const description = readFileSync(
      new URL('../examples/warning-inspection/description.md', import.meta.url),
      'utf8',
    );
    const tasks = new FakeTasks((body) => {
      if (body.taskType === 'classify') {
        const warning = (body.input.state as { warning: { code: string } })
          .warning;
        return {
          version: 1,
          answers: {
            answer: {
              type: 'bool',
              probability: warning.code === 'permanent-fact' ? 0.99 : 0.01,
            },
          },
        };
      }
      const stage = body.tags!.find((t) => t.startsWith('stage:'))!.slice(6);
      const results: Record<string, unknown> = {
        types: { types: domain.types },
        predicates: { predicates: domain.predicates },
        actions: { actions: domain.actions },
        refine: {
          actions: String(body.input.brief).includes('Classifier-supported')
            ? fixed
            : domain.actions,
          changes: ['Consume the inspection.'],
        },
        problem: {
          objects: problem.objects,
          init: problem.init,
          goal: problem.goal,
        },
      };
      return { summary: 'done', result: results[stage] };
    });
    const input = {
      description,
      problemDescription: 'Process both parcels.',
      domainName: domain.name,
      problemName: problem.name,
      teamId: 'team',
      diaryId: 'diary',
      correlationId: 'inspection',
      profileId: 'generator',
    };
    const questions = createClassifyQuestionClient(tasks, {
      ...input,
      profileId: 'classifier',
      purpose: 'warning-review',
      pollIntervalSec: 0,
    });

    const run = await runPddlDesign(tasks, input, {
      warningReview: { questions },
    });

    expect(validatePlan(domain, problem, badPlan).valid).toBe(true);
    expect(validatePlan(run.domain!, run.problem!, badPlan).valid).toBe(false);
    expect(validatePlan(run.domain!, run.problem!, goodPlan).valid).toBe(true);
    expect(run.status).toBe('planned');
    expect(
      run.warningReviews![0].decisions.find(
        (d) => d.issue.code === 'permanent-fact',
      )?.verdict,
    ).toBe('confirmed');
  });

  it('the frozen inspection rubric fails a shortcut even when the planner accepts it', () => {
    const criteria = JSON.parse(
      readFileSync(
        new URL(
          '../examples/warning-inspection/required.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    const run = {
      status: 'planned',
      domain,
      problem,
      plan: { status: 'found', steps: badPlan },
    };
    expect(scoreRun(run, criteria)).toMatchObject({
      pass: false,
      reasons: [expect.stringContaining('inspect: 1 occurrences')],
    });
    expect(
      scoreRun({ ...run, plan: { ...run.plan, steps: goodPlan } }, criteria),
    ).toEqual({ pass: true, reasons: [] });
  });
});
