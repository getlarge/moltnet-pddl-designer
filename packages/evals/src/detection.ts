/** Binary temporal-evidence cases and scoring, independent of any model runtime. */
export interface TemporalDetectionCase {
  id: string;
  split: 'dev' | 'holdout';
  family: string;
  phenomenon: string;
  origin: 'source-paragraph' | 'project-control';
  input: {
    description: string;
    action: string;
    vocabulary: string[];
  };
  gold: { hasDurativeEvidence: boolean };
  provenance: {
    sourceUrl: string;
    sourceId: string;
    annotation: 'project-curated';
    notes: string;
  };
}

export interface TemporalDetectionPrediction {
  id: string;
  runId: string;
  probability: number;
  seconds: number;
}

type Counts = {
  cases: number;
  correct: number;
  truePositive: number;
  trueNegative: number;
  falsePositive: number;
  falseNegative: number;
};

const emptyCounts = (): Counts => ({
  cases: 0,
  correct: 0,
  truePositive: 0,
  trueNegative: 0,
  falsePositive: 0,
  falseNegative: 0,
});

export function evaluateTemporalDetection(
  cases: TemporalDetectionCase[],
  predictions: TemporalDetectionPrediction[],
  threshold = 0.5,
) {
  if (!cases.length || !predictions.length)
    throw new Error('Cases and predictions are required.');
  if (!(threshold > 0 && threshold < 1))
    throw new Error('Threshold must be between zero and one.');
  const byId = new Map<string, TemporalDetectionCase>();
  for (const item of cases) {
    if (
      !item.id?.trim() ||
      byId.has(item.id) ||
      !['dev', 'holdout'].includes(item.split) ||
      !item.family?.trim() ||
      !item.phenomenon?.trim() ||
      !['source-paragraph', 'project-control'].includes(item.origin) ||
      !item.input?.description?.trim() ||
      !item.input.action?.trim() ||
      !Array.isArray(item.input.vocabulary) ||
      typeof item.gold?.hasDurativeEvidence !== 'boolean' ||
      !item.provenance?.sourceUrl?.trim() ||
      !item.provenance.sourceId?.trim() ||
      item.provenance.annotation !== 'project-curated'
    )
      throw new Error(`Invalid or duplicate detection case: ${item.id}`);
    byId.set(item.id, item);
  }
  const runIds = new Set<string>();
  const seen = new Set<string>();
  const totals = emptyCounts();
  const bySplit = Object.create(null) as Record<string, Counts>;
  const byFamily = Object.create(null) as Record<string, Counts>;
  const byPhenomenon = Object.create(null) as Record<string, Counts>;
  const rows = [];
  let brierSum = 0;
  let totalSeconds = 0;
  for (const prediction of predictions) {
    const item = byId.get(prediction.id);
    if (!item) throw new Error(`Unknown detection case: ${prediction.id}`);
    if (!prediction.runId?.trim()) throw new Error('Run ID is required.');
    if (
      !Number.isFinite(prediction.probability) ||
      prediction.probability < 0 ||
      prediction.probability > 1 ||
      !Number.isFinite(prediction.seconds) ||
      prediction.seconds < 0
    )
      throw new Error(`Invalid probability or timing: ${prediction.id}`);
    const key = JSON.stringify([prediction.runId, prediction.id]);
    if (seen.has(key))
      throw new Error(`Duplicate detection prediction: ${key}`);
    seen.add(key);
    runIds.add(prediction.runId);
    const expected = item.gold.hasDurativeEvidence;
    const predicted = prediction.probability >= threshold;
    const result: keyof Pick<
      Counts,
      'truePositive' | 'trueNegative' | 'falsePositive' | 'falseNegative'
    > = expected
      ? predicted
        ? 'truePositive'
        : 'falseNegative'
      : predicted
        ? 'falsePositive'
        : 'trueNegative';
    const correct = expected === predicted;
    for (const bucket of [
      totals,
      (bySplit[item.split] ??= emptyCounts()),
      (byFamily[item.family] ??= emptyCounts()),
      (byPhenomenon[item.phenomenon] ??= emptyCounts()),
    ]) {
      bucket.cases++;
      if (correct) bucket.correct++;
      bucket[result]++;
    }
    brierSum += (prediction.probability - Number(expected)) ** 2;
    totalSeconds += prediction.seconds;
    rows.push({
      ...prediction,
      split: item.split,
      family: item.family,
      phenomenon: item.phenomenon,
      origin: item.origin,
      expected,
      predicted,
      correct,
    });
  }
  if (seen.size !== cases.length * runIds.size)
    throw new Error('Each run needs one prediction per detection case.');
  const positive = totals.truePositive + totals.falseNegative;
  const negative = totals.trueNegative + totals.falsePositive;
  const byCase = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byCase.get(row.id) ?? [];
    list.push(row);
    byCase.set(row.id, list);
  }
  const unstableCaseIds = [...byCase].flatMap(([id, list]) =>
    new Set(list.map((row) => row.predicted)).size > 1 ? [id] : [],
  );
  const probabilityRanges = [...byCase.values()].map(
    (list) =>
      Math.max(...list.map((row) => row.probability)) -
      Math.min(...list.map((row) => row.probability)),
  );
  return {
    cases: cases.length,
    runs: runIds.size,
    threshold,
    totals,
    accuracy: totals.correct / totals.cases,
    balancedAccuracy:
      positive && negative
        ? (totals.truePositive / positive + totals.trueNegative / negative) / 2
        : null,
    brierScore: brierSum / predictions.length,
    totalSeconds,
    crossRunAgreement:
      runIds.size > 1
        ? {
            unstableCaseIds,
            meanProbabilityRange:
              probabilityRanges.reduce((sum, value) => sum + value, 0) /
              probabilityRanges.length,
            maxProbabilityRange: Math.max(...probabilityRanges),
          }
        : null,
    bySplit,
    byFamily,
    byPhenomenon,
    rows,
  };
}
