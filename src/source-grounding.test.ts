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
          'pick-up does not make the fact arm-empty(?a) false as an explicit effect.',
      },
    });
    expect(request.questions.claim_1.criteria).toHaveProperty(
      'not_established',
    );
    expect(request.questions.claim_1.instructions).toContain(
      'Only state.source is authoritative',
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
