import { describe, expect, it } from 'vitest';
import { ClassifyInput } from '@themoltnet/sdk';
import { Value } from 'typebox/value';
import fixtures from '../examples/source-grounding-pilot/cases.json' with { type: 'json' };
import gold from '../examples/source-grounding-pilot/gold.json' with { type: 'json' };
import {
  buildGroundingRequest,
  parseGroundingAnswers,
  type GroundingTarget,
} from './source-grounding.js';
import type { Domain } from './ir.js';

const requestFor = (index: number) => {
  const fixture = fixtures.cases[index];
  return buildGroundingRequest(
    fixture.source,
    fixture.domain as Domain,
    fixture.targets as GroundingTarget[],
  );
};
const output = (
  choice = 'supported',
  probabilities = { supported: 0.9, contradicted: 0.05, not_established: 0.05 },
) => ({
  version: 1,
  answers: {
    claim_1: { type: 'choice', choice, probabilities, confidence: 0.8 },
  },
});

describe('source-grounding request construction', () => {
  it('renders claims from the actual model field, including deliberate omissions', () => {
    const present = requestFor(0).state.claims as Record<
      string,
      { present: boolean; statement: string }
    >;
    const omitted = requestFor(1).state.claims as typeof present;
    expect(present.claim_1.present).toBe(true);
    expect(present.claim_1.statement).toContain(
      'requires the fact claimed-by(?t, ?w)',
    );
    expect(omitted.claim_1.present).toBe(false);
    expect(omitted.claim_1.statement).toContain('does not require');
    const deleted = requestFor(4).state.claims as typeof present;
    const retained = requestFor(5).state.claims as typeof present;
    expect(deleted.claim_1.statement).toContain(
      'makes the fact certified(?s) false',
    );
    expect(retained.claim_1.statement).toContain('does not make');
  });
  it('builds eight valid payloads without expected labels or generated source notes', () => {
    for (let index = 0; index < fixtures.cases.length; index++) {
      const input = requestFor(index);
      expect(Value.Check(ClassifyInput, input)).toBe(true);
      expect(Object.keys(input.state)).toEqual(['source', 'claims']);
      expect(input.state.source).toBe(fixtures.cases[index].source);
      expect(JSON.stringify(input)).not.toContain('expected');
      expect(JSON.stringify(input)).not.toContain('expectedReason');
      expect(Object.keys(input.questions)).toEqual(['claim_1']);
    }
    const relations = Object.values(gold.cases).map((c) => c.claim_1.relation);
    expect(relations.filter((r) => r === 'supported')).toHaveLength(3);
    expect(relations.filter((r) => r === 'contradicted')).toHaveLength(3);
    expect(relations.filter((r) => r === 'not_established')).toHaveLength(2);
  });
  it('supports multiple independent targets in one request without duplicate questions', () => {
    const fixture = fixtures.cases[0];
    const target = fixture.targets[0] as GroundingTarget;
    const request = buildGroundingRequest(
      fixture.source,
      fixture.domain as Domain,
      [target, { ...target, field: 'deleteEffects' }],
    );
    expect(Object.keys(request.questions)).toEqual(['claim_1', 'claim_2']);
    expect(request.questions.claim_2.instructions).toContain(
      'state.claims.claim_2.statement',
    );
    expect(() =>
      buildGroundingRequest(fixture.source, fixture.domain as Domain, [
        target,
        target,
      ]),
    ).toThrow('Duplicate');
  });
  it('rejects invalid targets instead of inventing a claim', () => {
    const fixture = fixtures.cases[0];
    const domain = fixture.domain as Domain;
    const target = fixture.targets[0] as GroundingTarget;
    expect(() => buildGroundingRequest('', domain, [target])).toThrow('Source');
    expect(() => buildGroundingRequest(fixture.source, domain, [])).toThrow(
      '1–20',
    );
    expect(() =>
      buildGroundingRequest(fixture.source, domain, [
        { ...target, action: 'unknown' },
      ]),
    ).toThrow('does not exist');
    expect(() =>
      buildGroundingRequest(fixture.source, domain, [
        { ...target, atom: { ...target.atom, args: ['?t'] } },
      ]),
    ).toThrow('arity');
    expect(() =>
      buildGroundingRequest(fixture.source, domain, [
        { ...target, atom: { ...target.atom, args: ['?w', '?t'] } },
      ]),
    ).toThrow('type');
    expect(() =>
      buildGroundingRequest(fixture.source, domain, [
        { ...target, field: 'deleteEffects', negated: true },
      ]),
    ).toThrow('negated');
  });
});

describe('source-grounding answers', () => {
  it('preserves choice, distribution and confidence without inventing an explanation', () => {
    const answers = parseGroundingAnswers(output(), requestFor(0));
    expect(answers.claim_1).toEqual(output().answers.claim_1);
    expect(answers.claim_1).not.toHaveProperty('reason');
  });
  it('rejects missing or extra answers and unknown choices', () => {
    expect(() =>
      parseGroundingAnswers({ version: 1, answers: {} }, requestFor(0)),
    ).toThrow('count');
    expect(() =>
      parseGroundingAnswers(
        { version: 1, answers: { other: output().answers.claim_1 } },
        requestFor(0),
      ),
    ).toThrow('choice');
    expect(() =>
      parseGroundingAnswers(output('invented'), requestFor(0)),
    ).toThrow('choice');
  });
  it('rejects invalid distributions and a choice inconsistent with its probabilities', () => {
    expect(() =>
      parseGroundingAnswers(
        output('supported', {
          supported: 0.8,
          contradicted: 0.4,
          not_established: 0.1,
        }),
        requestFor(0),
      ),
    ).toThrow('probabilities');
    expect(() =>
      parseGroundingAnswers(output('contradicted'), requestFor(0)),
    ).toThrow('most probable');
    expect(() =>
      parseGroundingAnswers(
        output('supported', {
          supported: NaN,
          contradicted: 0,
          not_established: 0,
        }),
        requestFor(0),
      ),
    ).toThrow();
  });
});
