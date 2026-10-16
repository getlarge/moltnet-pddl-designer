import { expect, it, vi } from 'vitest';
import type { DesignRun } from '@pddl/contracts/design';
import type { DurativeAction } from '@pddl/domain/temporal';
import { finishTemporalRun } from './molt-executor.js';

const base = (): DesignRun => ({
  version: 1,
  status: 'planned',
  input: {
    description: 'Inspecting a ready box takes two minutes.',
    problemDescription: 'Inspect the box.',
    domainName: 'inspection',
    problemName: 'box-case',
    correlationId: 'test-run',
  },
  stages: [],
  issues: [],
  durationMs: 1,
  domain: {
    name: 'inspection',
    types: [{ name: 'box', description: 'A box.' }],
    predicates: [
      {
        name: 'ready',
        parameters: [{ name: '?b', type: 'box' }],
        description: 'Ready.',
      },
      {
        name: 'inspected',
        parameters: [{ name: '?b', type: 'box' }],
        description: 'Inspected.',
      },
    ],
    actions: [
      {
        name: 'inspect',
        parameters: [{ name: '?b', type: 'box' }],
        preconditions: [{ predicate: 'ready', args: ['?b'], negated: false }],
        addEffects: [{ predicate: 'inspected', args: ['?b'] }],
        deleteEffects: [],
        source: 'Inspect the box.',
      },
    ],
  },
  problem: {
    name: 'box-case',
    objects: [{ name: 'box-one', type: 'box' }],
    init: [{ predicate: 'ready', args: ['box-one'] }],
    goal: [{ predicate: 'inspected', args: ['box-one'], negated: false }],
  },
  plan: { status: 'found', steps: ['(inspect box-one)'], explored: 2 },
});

const extracted: DurativeAction = {
  name: 'inspect',
  parameters: [{ name: '?b', type: 'box' }],
  durationSeconds: 120,
  conditions: [
    { predicate: 'ready', args: ['?b'], negated: false, timing: 'start' },
  ],
  effects: [
    { predicate: 'inspected', args: ['?b'], negated: false, timing: 'end' },
  ],
};

it('publishes a single finished event with the timed model after extraction', async () => {
  const events: string[] = [];
  const run = await finishTemporalRun(
    base(),
    { yesNo: async () => 0.97 },
    { extract: async () => extracted },
    async (event) => {
      events.push(event.type);
    },
  );
  expect(events).toEqual(['temporal-started', 'finished']);
  expect(run.temporal).toMatchObject({
    status: 'complete',
    detections: [{ action: 'inspect', probability: 0.97, timed: true }],
    temporalPlan: { status: 'candidate' },
  });
});

it('propagates a transient classifier failure so the durable run can retry', async () => {
  const onEvent = vi.fn();
  await expect(
    finishTemporalRun(
      base(),
      {
        yesNo: async () => {
          throw new Error('classifier unavailable');
        },
      },
      { extract: async () => extracted },
      onEvent,
    ),
  ).rejects.toThrow('classifier unavailable');
  expect(onEvent.mock.calls.map(([event]) => event.type)).toEqual([
    'temporal-started',
  ]);
});

it('retains the classical result and publishes invalid temporal output', async () => {
  const run = await finishTemporalRun(
    base(),
    { yesNo: async () => 0.97 },
    { extract: async () => ({ ...extracted, durationSeconds: 0 }) },
  );
  expect(run.status).toBe('planned');
  expect(run.temporal).toEqual({
    status: 'failed',
    error: 'Duration for inspect must be positive seconds.',
  });
});
