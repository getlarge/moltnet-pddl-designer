import { describe, expect, it, vi } from 'vitest';
import type { DesignRun } from '@pddl/contracts/design';
import type { Domain } from '@pddl/domain/ir';
import type { DurativeAction } from '@pddl/domain/temporal';
import { runTemporalPass } from './temporal.js';

const domain: Domain = {
  name: 'inspection',
  types: [{ name: 'container', description: 'Container.' }],
  predicates: [
    {
      name: 'ready',
      parameters: [{ name: '?c', type: 'container' }],
      description: 'Ready.',
    },
    {
      name: 'inspected',
      parameters: [{ name: '?c', type: 'container' }],
      description: 'Inspected.',
    },
  ],
  actions: [
    {
      name: 'inspect',
      parameters: [{ name: '?c', type: 'container' }],
      preconditions: [{ predicate: 'ready', args: ['?c'], negated: false }],
      addEffects: [{ predicate: 'inspected', args: ['?c'] }],
      deleteEffects: [],
      source: 'Inspecting takes two minutes.',
    },
  ],
};

const baseRun = {
  status: 'planned',
  plan: { status: 'found', steps: ['(inspect box)'], explored: 2 },
  input: {
    description:
      'Inspecting a ready container takes two minutes. It is marked inspected at the end.',
    problemDescription: 'Box is ready; inspect it.',
    domainName: 'inspection',
    problemName: 'inspect-box',
    correlationId: 'run-1',
  },
  domain,
  problem: {
    name: 'inspect-box',
    objects: [{ name: 'box', type: 'container' }],
    init: [{ predicate: 'ready', args: ['box'] }],
    goal: [{ predicate: 'inspected', args: ['box'], negated: false }],
  },
} as DesignRun;

const extracted: DurativeAction = {
  name: 'inspect',
  parameters: domain.actions[0].parameters,
  durationSeconds: 120,
  conditions: [
    { predicate: 'ready', args: ['?c'], negated: false, timing: 'start' },
  ],
  effects: [
    { predicate: 'inspected', args: ['?c'], negated: false, timing: 'end' },
  ],
};

describe('temporal pass', () => {
  it('uses the classifier gate, then renders the extracted timed action and problem', async () => {
    const yesNo = vi.fn().mockResolvedValue(0.98);
    const extract = vi.fn().mockResolvedValue(extracted);
    const result = await runTemporalPass(baseRun, { yesNo }, { extract });
    expect(yesNo).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'inspect' }),
      expect.any(Object),
    );
    expect(extract).toHaveBeenCalledOnce();
    expect(result.detections).toEqual([
      { action: 'inspect', probability: 0.98, timed: true },
    ]);
    expect(result.domainPddl).toContain('(:durative-action inspect');
    expect(result.problemPddl).toContain('(:goal (inspected box))');
    expect(result.temporalPlan).toEqual({
      status: 'candidate',
      text: '0: (inspect box) [120]\n',
    });
  });

  it('does not call extraction when the classifier finds no temporal evidence', async () => {
    const extract = vi.fn();
    const result = await runTemporalPass(
      baseRun,
      { yesNo: async () => 0.1 },
      { extract },
    );
    expect(extract).not.toHaveBeenCalled();
    expect(result.domainPddl).toContain('(:action inspect');
  });

  it('retains missing draft facts with visible timing defaults', async () => {
    const result = await runTemporalPass(
      baseRun,
      { yesNo: async () => 0.9 },
      { extract: async () => ({ ...extracted, effects: [] }) },
    );
    expect(result.defaultedClauses).toEqual([
      {
        action: 'inspect',
        kind: 'effect',
        clause: {
          predicate: 'inspected',
          args: ['?c'],
          negated: false,
          timing: 'end',
        },
      },
    ]);
    expect(result.domainPddl).toContain('(at end (inspected ?c))');
  });

  it('keeps supported actions when another action has timing but no numeric duration', async () => {
    const mixed = {
      ...baseRun,
      domain: {
        ...domain,
        actions: [...domain.actions, { ...domain.actions[0], name: 'wait' }],
      },
    } as DesignRun;
    const result = await runTemporalPass(
      mixed,
      { yesNo: async () => 0.98 },
      {
        extract: async (_domain, action) =>
          action.name === 'inspect'
            ? extracted
            : { ...extracted, name: 'wait', durationSeconds: -1 },
      },
    );
    expect(result.detections).toEqual([
      { action: 'inspect', probability: 0.98, timed: true },
      {
        action: 'wait',
        probability: 0.98,
        timed: false,
        unsupportedReason: 'numeric-duration-required',
      },
    ]);
    expect(result.domainPddl).toContain('(:durative-action inspect');
    expect(result.domainPddl).toContain('(:action wait');
  });

  it('offers a candidate schedule for a zero-parameter action', async () => {
    const noArgs = {
      ...baseRun,
      domain: {
        ...domain,
        predicates: domain.predicates.map((p) => ({ ...p, parameters: [] })),
        actions: [
          {
            ...domain.actions[0],
            parameters: [],
            preconditions: [{ predicate: 'ready', args: [], negated: false }],
            addEffects: [{ predicate: 'inspected', args: [] }],
          },
        ],
      },
      problem: {
        name: 'inspect-box',
        objects: [],
        init: [{ predicate: 'ready', args: [] }],
        goal: [{ predicate: 'inspected', args: [], negated: false }],
      },
      plan: { status: 'found', steps: ['(inspect)'], explored: 2 },
    } as DesignRun;
    const result = await runTemporalPass(
      noArgs,
      { yesNo: async () => 0.98 },
      {
        extract: async () => ({
          ...extracted,
          parameters: [],
          conditions: [
            { predicate: 'ready', args: [], negated: false, timing: 'start' },
          ],
          effects: [
            { predicate: 'inspected', args: [], negated: false, timing: 'end' },
          ],
        }),
      },
    );
    expect(result.temporalPlan?.text).toBe('0: (inspect) [120]\n');
  });
});
