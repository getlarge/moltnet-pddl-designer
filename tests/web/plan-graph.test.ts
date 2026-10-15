import { describe, expect, it } from 'vitest';
import type { GroundAction } from '@pddl/domain/planner';
import { buildPlanGraph } from '../../apps/web/src/plan-graph.js';

function action(
  label: string,
  fields: Partial<Pick<GroundAction, 'pre' | 'neg' | 'add' | 'del'>> = {},
): GroundAction {
  return {
    label,
    action: label,
    pre: fields.pre ?? [],
    neg: fields.neg ?? [],
    add: fields.add ?? [],
    del: fields.del ?? [],
  };
}

describe('plan dependency graph', () => {
  it('places independent actions in the same layer', () => {
    expect(
      buildPlanGraph([
        action('prepare a', { add: ['ready-a'] }),
        action('prepare b', { add: ['ready-b'] }),
      ]),
    ).toEqual({ edges: [], layers: [0, 0], layerCount: 1 });
  });

  it('keeps causal ordering and removes an edge implied by another path', () => {
    expect(
      buildPlanGraph([
        action('prepare', { add: ['ready'] }),
        action('start', { pre: ['ready'], add: ['running'] }),
        action('finish', { pre: ['ready', 'running'] }),
      ]),
    ).toEqual({
      edges: [
        { from: 0, to: 1 },
        { from: 1, to: 2 },
      ],
      layers: [0, 1, 2],
      layerCount: 3,
    });
  });

  it('keeps ordering for negative preconditions and repeated actions', () => {
    expect(
      buildPlanGraph([
        action('inspect', { neg: ['locked'], add: ['inspected'] }),
        action('lock', { add: ['locked'] }),
        action('unlock', { del: ['locked'] }),
        action('inspect', { neg: ['locked'], add: ['inspected'] }),
      ]).edges,
    ).toEqual([
      { from: 0, to: 1 },
      { from: 1, to: 2 },
      { from: 2, to: 3 },
    ]);
  });
});
