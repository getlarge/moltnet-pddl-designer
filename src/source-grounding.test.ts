import { describe, expect, it } from 'vitest';
import { blocksDomain } from './test-fixtures.js';
import {
  buildGroundingRequest,
  groundingTargets,
  parseGroundingAnswers,
} from './source-grounding.js';

const target = {
  action: 'pick-up',
  field: 'deleteEffects' as const,
  atom: { predicate: 'arm-empty', args: ['?a'] },
};
const input = () =>
  buildGroundingRequest('Picking up a block occupies the arm.', blocksDomain, [
    target,
  ]);
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

describe('source-grounded action judgments', () => {
  it('renders missing deletion from the actual draft and offers a lifetime target', () => {
    const domain = structuredClone(blocksDomain);
    domain.actions[0].deleteEffects = domain.actions[0].deleteEffects.filter(
      (a) => a.predicate !== 'arm-empty',
    );
    expect(groundingTargets(domain)).toContainEqual(target);
    const request = buildGroundingRequest(
      'Picking up occupies the arm.',
      domain,
      [target],
    );
    expect(request.state.claims).toMatchObject({
      claim_1: {
        present: false,
        statement:
          'If arm-empty(?a) is true before pick-up, it remains true afterward: the action does not remove that fact.',
      },
    });
    expect(request.state.actions).toMatchObject({
      'pick-up': {
        addEffects: domain.actions[0].addEffects,
        preconditions: domain.actions[0].preconditions,
      },
    });
    expect(request.state.predicates).toHaveProperty('held-by-arm');
    expect(request.questions.claim_1.criteria).toHaveProperty(
      'not_established',
    );
    expect(request.questions.claim_1.instructions).toContain(
      'Only state.source and state.situation provide evidence',
    );
  });
  it('states a delete effect as a world-state transition, with related action context', () => {
    const request = buildGroundingRequest(
      'An arm picks up blocks from the table.',
      blocksDomain,
      [
        {
          action: 'pick-up',
          field: 'deleteEffects',
          atom: { predicate: 'on-table', args: ['?b'] },
        },
      ],
    );
    expect(request.state.claims).toMatchObject({
      claim_1: {
        statement:
          'Immediately after pick-up, on-table(?b) is false: the action removes that fact.',
      },
    });
    expect(request.state.actions).toEqual({
      'pick-up': blocksDomain.actions[0],
    });
    expect(request.questions.claim_1.instructions).toContain(
      'ordinary meanings',
    );
    expect(request.state.predicates).toHaveProperty('held-by-arm');
  });
  it('includes the situation as concrete context without treating starting facts as universal rules', () => {
    const situation =
      'Blocks a, b and c start on the table and the arm is empty. Build a tower.';
    const request = buildGroundingRequest(
      'An arm moves blocks.',
      blocksDomain,
      [target],
      situation,
    );
    expect(request.state.situation).toBe(situation);
    expect(request.questions.claim_1.instructions).toContain(
      'without turning its starting facts into rules for every execution',
    );
  });
  it('rejects invalid participants, duplicates and oversized batches before dispatch', () => {
    expect(() =>
      buildGroundingRequest('source', blocksDomain, [
        { ...target, atom: { predicate: 'arm-empty', args: ['?missing'] } },
      ]),
    ).toThrow('unknown action parameter');
    expect(() =>
      buildGroundingRequest('source', blocksDomain, [target, target]),
    ).toThrow('Duplicate');
    expect(() =>
      buildGroundingRequest('source', blocksDomain, Array(21).fill(target)),
    ).toThrow('1–20');
  });
  it('accepts a subtype argument and rejects a mismatched type', () => {
    const domain = structuredClone(blocksDomain);
    domain.predicates.find((p) => p.name === 'arm-empty')!.parameters[0].type =
      'agent';
    expect(() =>
      buildGroundingRequest('source', domain, [target]),
    ).not.toThrow();
    domain.predicates.find((p) => p.name === 'arm-empty')!.parameters[0].type =
      'block';
    expect(() => buildGroundingRequest('source', domain, [target])).toThrow();
  });
  it('accepts a typed parameter in an implicitly object-typed predicate', () => {
    const domain = structuredClone(blocksDomain);
    domain.predicates.find((p) => p.name === 'arm-empty')!.parameters[0].type =
      'object';
    expect(() =>
      buildGroundingRequest('The arm holds one block.', domain, [target]),
    ).not.toThrow();
  });
  it('rejects missing answers, unknown labels and inconsistent distributions', () => {
    expect(parseGroundingAnswers(output(), input()).claim_1.choice).toBe(
      'supported',
    );
    expect(() =>
      parseGroundingAnswers({ version: 1, answers: {} }, input()),
    ).toThrow();
    const bad = output();
    bad.answers.claim_1.choice = 'approve';
    expect(() => parseGroundingAnswers(bad, input())).toThrow();
    bad.answers.claim_1.choice = 'contradicted';
    expect(() => parseGroundingAnswers(bad, input())).toThrow();
    bad.answers.claim_1.choice = 'supported';
    bad.answers.claim_1.probabilities.supported = 0.5;
    expect(() => parseGroundingAnswers(bad, input())).toThrow();
  });
});
