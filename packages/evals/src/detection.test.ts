import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  evaluateTemporalDetection,
  type TemporalDetectionCase,
} from './detection.js';

const cases = JSON.parse(
  readFileSync(
    new URL('../../../evals/temporal/detection-v2.json', import.meta.url),
    'utf8',
  ),
) as TemporalDetectionCase[];

describe('temporal detection benchmark', () => {
  it('keeps source positives and project controls paired within each family and split', () => {
    expect(cases).toHaveLength(32);
    expect(new Set(cases.map((item) => item.id)).size).toBe(cases.length);
    const families = new Set(cases.map((item) => item.family));
    expect(families.size).toBe(8);
    for (const family of families) {
      const items = cases.filter((item) => item.family === family);
      expect(items).toHaveLength(4);
      expect(new Set(items.map((item) => item.split)).size).toBe(1);
      expect(
        items.filter((item) => item.origin === 'source-paragraph'),
      ).toHaveLength(2);
      expect(
        items.filter((item) => item.origin === 'project-control'),
      ).toHaveLength(2);
      expect(
        items.filter((item) => item.gold.hasDurativeEvidence),
      ).toHaveLength(2);
    }
  });

  it('scores independent repeats and rejects an incomplete run', () => {
    const two = [cases[0]!, cases[2]!];
    const predictions = [
      ...two.map((item) => ({
        id: item.id,
        runId: 'a',
        probability: item.gold.hasDurativeEvidence ? 0.9 : 0.1,
        seconds: 2,
      })),
      ...two.map((item) => ({
        id: item.id,
        runId: 'b',
        probability: item.gold.hasDurativeEvidence ? 0.1 : 0.9,
        seconds: 3,
      })),
    ];
    const score = evaluateTemporalDetection(two, predictions);
    expect(score.runs).toBe(2);
    expect(score.totals.correct).toBe(2);
    expect(score.totals.truePositive).toBe(1);
    expect(score.totals.trueNegative).toBe(1);
    expect(score.totals.falsePositive).toBe(1);
    expect(score.totals.falseNegative).toBe(1);
    expect(score.balancedAccuracy).toBe(0.5);
    expect(score.totalSeconds).toBe(10);
    expect(score.brierScore).toBeCloseTo(0.41);
    expect(score.crossRunAgreement?.unstableCaseIds).toEqual(
      two.map((item) => item.id),
    );
    expect(score.crossRunAgreement?.maxProbabilityRange).toBeCloseTo(0.8);
    expect(() => evaluateTemporalDetection(two, predictions.slice(1))).toThrow(
      'Each run needs one prediction per detection case',
    );
  });
});
