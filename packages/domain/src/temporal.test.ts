import { describe, expect, it } from 'vitest';
import type { Domain } from './ir.js';
import { renderDomainWithTiming } from './render.js';
import type { DurativeAction } from './temporal.js';

const domain: Domain = {
  name: 'loading',
  types: [
    { name: 'parcel', description: 'A parcel.' },
    { name: 'truck', description: 'A truck.' },
    { name: 'location', description: 'A place.' },
  ],
  predicates: [
    {
      name: 'object-at',
      parameters: [
        { name: '?o', type: 'parcel' },
        { name: '?l', type: 'location' },
      ],
      description: 'Parcel location.',
    },
    {
      name: 'truck-at',
      parameters: [
        { name: '?t', type: 'truck' },
        { name: '?l', type: 'location' },
      ],
      description: 'Truck location.',
    },
    {
      name: 'in',
      parameters: [
        { name: '?o', type: 'parcel' },
        { name: '?t', type: 'truck' },
      ],
      description: 'Loaded parcel.',
    },
  ],
  actions: [
    {
      name: 'load-truck',
      parameters: [
        { name: '?o', type: 'parcel' },
        { name: '?t', type: 'truck' },
        { name: '?l', type: 'location' },
      ],
      preconditions: [
        { predicate: 'object-at', args: ['?o', '?l'], negated: false },
        { predicate: 'truck-at', args: ['?t', '?l'], negated: false },
      ],
      addEffects: [{ predicate: 'in', args: ['?o', '?t'] }],
      deleteEffects: [{ predicate: 'object-at', args: ['?o', '?l'] }],
      source:
        'Loading takes two minutes while the truck stays at the location.',
    },
  ],
};

const timed: DurativeAction = {
  name: 'load-truck',
  parameters: domain.actions[0].parameters,
  durationSeconds: 120,
  conditions: [
    {
      predicate: 'object-at',
      args: ['?o', '?l'],
      negated: false,
      timing: 'start',
    },
    {
      predicate: 'truck-at',
      args: ['?t', '?l'],
      negated: false,
      timing: 'overall',
    },
  ],
  effects: [
    { predicate: 'in', args: ['?o', '?t'], negated: false, timing: 'end' },
    {
      predicate: 'object-at',
      args: ['?o', '?l'],
      negated: true,
      timing: 'end',
    },
  ],
};

describe('temporal PDDL rendering', () => {
  it('renders a numeric duration and the three timed clause forms', () => {
    const text = renderDomainWithTiming(domain, [timed]);
    expect(text).toContain(':durative-actions');
    expect(text).toContain('(:durative-action load-truck');
    expect(text).toContain(':duration (= ?duration 120)');
    expect(text).toContain('(at start (object-at ?o ?l))');
    expect(text).toContain('(over all (truck-at ?t ?l))');
    expect(text).toContain('(at end (not (object-at ?o ?l)))');
    expect(text).not.toContain('(:action load-truck');
  });

  it('rejects unsupported model clauses before rendering', () => {
    expect(() =>
      renderDomainWithTiming(domain, [{ ...timed, durationSeconds: -1 }]),
    ).toThrow('positive seconds');
    expect(() =>
      renderDomainWithTiming(domain, [
        { ...timed, effects: [{ ...timed.effects[0], args: ['?t', '?o'] }] },
      ]),
    ).toThrow('Invalid argument');
    expect(() =>
      renderDomainWithTiming(domain, [
        {
          ...timed,
          effects: [{ ...timed.effects[0], timing: 'overall' as 'end' }],
        },
      ]),
    ).toThrow('Invalid effect timing');
  });
});
