import { apply } from './planner.js';
import { describe, expect, it } from 'vitest';
import { checkActions, checkPredicates, hasErrors } from './check.js';
import { blocksDomain } from './test-fixtures.js';
import {
  buildGroundingRequest,
  describeGroundingTarget,
} from './source-grounding.js';

function domain() {
  const d = structuredClone(blocksDomain);
  const stack = d.actions.find((a) => a.name === 'stack')!;
  stack.reading = '{?a} places {?b1} on top of {?b2}';
  stack.parameters.forEach((p) => {
    p.label = (
      { '?a': 'the arm', '?b1': 'block A', '?b2': 'block B' } as Record<
        string,
        string
      >
    )[p.name];
  });
  const clear = d.predicates.find((p) => p.name === 'clear')!;
  clear.reading = {
    true: 'nothing is on top of {?b}',
    false: 'a block is on top of {?b}',
  };
  return d;
}
const target = {
  action: 'stack',
  field: 'deleteEffects' as const,
  atom: { predicate: 'clear', args: ['?b2'] },
};

describe('faithful readable claims', () => {
  it('binds predicate parameters by argument position to distinct action participants', () => {
    const d = domain();
    const claim = describeGroundingTarget(d, target);
    expect(claim.statement).toBe(
      'The arm places block A on top of block B. Immediately afterward, a block is on top of block B.',
    );
    expect(claim.participants).toEqual({
      '?a': 'the arm',
      '?b1': 'block A',
      '?b2': 'block B',
    });
    const swapped = describeGroundingTarget(d, {
      ...target,
      atom: { predicate: 'clear', args: ['?b1'] },
    });
    expect(swapped.statement).toContain('nothing is on top of block A');
    expect(swapped.statement).not.toContain('nothing is on top of block B');
  });
  it('preserves an omitted deletion instead of letting readable wording repair it', () => {
    const d = domain();
    d.actions.find((a) => a.name === 'stack')!.deleteEffects = [];
    const original = structuredClone(d);
    const request = buildGroundingRequest(
      'A robotic arm stacks blocks.',
      d,
      [target],
      'A and B start on the table.',
    );
    expect(request.state.claims).toMatchObject({
      claim_1: {
        present: false,
        wording: 'readable',
        statement:
          'Suppose nothing is on top of block B before the action. The arm places block A on top of block B. Immediately afterward, nothing is on top of block B.',
      },
    });
    expect(d).toEqual(original);
    expect(request.state.situation).toBe('A and B start on the table.');
  });
  it('uses the opposite fact wording for a negative prerequisite and positive wording for an addition', () => {
    const d = domain();
    const a = d.actions.find((a) => a.name === 'stack')!;
    a.preconditions.push({ predicate: 'clear', args: ['?b1'], negated: true });
    expect(
      describeGroundingTarget(d, {
        ...target,
        field: 'preconditions',
        atom: { predicate: 'clear', args: ['?b1'] },
        negated: true,
      }).statement,
    ).toContain('requires the following: a block is on top of block A');
    expect(
      describeGroundingTarget(d, {
        ...target,
        field: 'addEffects',
        atom: { predicate: 'clear', args: ['?b1'] },
      }).statement,
    ).toContain('Immediately afterward, nothing is on top of block A');
  });
  it('rejects stale or omitted placeholders and ambiguous participant labels', () => {
    const d = domain();
    d.predicates.find((p) => p.name === 'clear')!.reading!.true =
      'nothing is on {?unknown}';
    expect(hasErrors(checkPredicates(d.types, d.predicates))).toBe(true);
    expect(() => buildGroundingRequest('source', d, [target])).toThrow(
      'structurally valid',
    );
    const a = domain();
    a.actions.find((a) => a.name === 'stack')!.reading = '{?a} moves {?b1}';
    expect(checkActions(a.types, a.predicates, a.actions)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'error',
          message: 'include participant {?b2}',
        }),
      ]),
    );
    const b = domain();
    b.actions.find((a) => a.name === 'stack')!.parameters[2].label = 'block A';
    expect(hasErrors(checkActions(b.types, b.predicates, b.actions))).toBe(
      true,
    );
  });
  it('describes the actual final truth when the action both removes and adds a fact', () => {
    const d = domain();
    d.actions.find((a) => a.name === 'stack')!.addEffects.push(target.atom);
    expect(hasErrors(checkActions(d.types, d.predicates, d.actions))).toBe(
      false,
    );
    const claim = describeGroundingTarget(d, target);
    expect(claim.statement).toContain(
      'Immediately afterward, nothing is on top of block B.',
    );
    expect(claim.formalStatement).toContain(
      'is true: the action adds that fact as well as removing it',
    );
    const state = apply(new Set(['clear-b']), {
      label: 'stack',
      action: 'stack',
      pre: [],
      neg: [],
      add: ['clear-b'],
      del: ['clear-b'],
    });
    expect(state.has('clear-b')).toBe(true);
  });
  it('keeps legacy models readable with an explicit formal fallback', () => {
    const result = describeGroundingTarget(blocksDomain, target);
    expect(result.wording).toBe('formal');
    expect(result.statement).toContain('clear(?b2) is false');
  });
  it('does not treat a fact added by the action as merely preserved', () => {
    const d = domain();
    const a = d.actions.find((a) => a.name === 'stack')!;
    a.deleteEffects = [];
    a.addEffects.push(target.atom);
    const result = describeGroundingTarget(d, target);
    expect(result.statement).toBe(
      'The arm places block A on top of block B. Immediately afterward, nothing is on top of block B.',
    );
  });
});
