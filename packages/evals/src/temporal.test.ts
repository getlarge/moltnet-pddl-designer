import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  evaluateTemporal,
  hasDurativeEvidence,
  type TemporalCase,
  type TemporalPrediction,
} from './temporal.js';

const cases = JSON.parse(
  readFileSync(
    new URL('../../../evals/temporal/v1.json', import.meta.url),
    'utf8',
  ),
) as TemporalCase[];

const correct = (runId: string): TemporalPrediction[] =>
  cases.map((item) => ({
    id: item.id,
    runId,
    hasDurativeEvidence: hasDurativeEvidence(item.gold),
    ...structuredClone(item.gold),
  }));

describe('temporal gold evaluation', () => {
  it('scores the versioned cases and accepts clause reordering', () => {
    const predictions = correct('baseline-1');
    predictions[0].effects.reverse();
    const report = evaluateTemporal(cases, predictions);

    expect(report.cases).toBe(4);
    expect(report.totals.exact).toBe(4);
    expect(report.totals.truePositive).toBe(2);
    expect(report.totals.trueNegative).toBe(2);
  });

  it('separates false positives, wrong durations, and wrong timing', () => {
    const predictions = correct('baseline-2');
    predictions[0].durationSeconds = 60;
    predictions[1].conditions[0].timing = 'start';
    predictions[2].hasDurativeEvidence = true;
    const report = evaluateTemporal(cases, predictions);

    expect(report.totals).toMatchObject({
      falsePositive: 1,
      durationCorrect: 3,
      conditionsCorrect: 3,
      exact: 1,
    });
  });

  it('rejects incomplete repeats and duplicate predictions', () => {
    expect(() => evaluateTemporal(cases, correct('one').slice(1))).toThrow(
      'exactly one prediction per case',
    );
    const predictions = correct('one');
    expect(() =>
      evaluateTemporal(cases, [...predictions, predictions[0]]),
    ).toThrow('Duplicate prediction');
  });
});
