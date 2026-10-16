/** Offline gold cases and scoring. This module never calls a model or planner. */
export type TemporalTiming = 'start' | 'overall' | 'end';

export interface TemporalClause {
  atom: string;
  timing: TemporalTiming;
  negated: boolean;
}

export interface TemporalGold {
  durationSeconds: number | null;
  conditions: TemporalClause[];
  effects: TemporalClause[];
}

export interface TemporalCase {
  id: string;
  split: 'dev' | 'holdout';
  input: {
    description: string;
    action: string;
    /** Canonical predicate names supplied for exact component scoring. */
    vocabulary: string[];
  };
  gold: TemporalGold;
  provenance: {
    sourceUrl: string;
    sourceId: string;
    annotation: 'project-curated';
    notes: string;
  };
}

export interface TemporalPrediction extends TemporalGold {
  id: string;
  runId: string;
  hasDurativeEvidence: boolean;
}

export interface TemporalCaseScore {
  id: string;
  runId: string;
  detectionCorrect: boolean;
  durationCorrect: boolean;
  conditionsCorrect: boolean;
  effectsCorrect: boolean;
  exact: boolean;
}

export interface TemporalReport {
  cases: number;
  runs: number;
  totals: {
    predictions: number;
    detectionCorrect: number;
    durationCorrect: number;
    conditionsCorrect: number;
    effectsCorrect: number;
    exact: number;
    truePositive: number;
    trueNegative: number;
    falsePositive: number;
    falseNegative: number;
  };
  scores: TemporalCaseScore[];
}

const timings = new Set<TemporalTiming>(['start', 'overall', 'end']);
const keys = (clauses: TemporalClause[], kind: 'condition' | 'effect') => {
  const result = new Set<string>();
  for (const clause of clauses) {
    if (!clause || !timings.has(clause.timing) || !clause.atom?.trim())
      throw new Error(`Invalid ${kind} clause.`);
    if (kind === 'effect' && clause.timing === 'overall')
      throw new Error('Effects cannot have overall timing.');
    if (typeof clause.negated !== 'boolean')
      throw new Error(`Invalid ${kind} polarity.`);
    const key = JSON.stringify([clause.timing, clause.atom, clause.negated]);
    if (result.has(key)) throw new Error(`Duplicate ${kind} clause.`);
    result.add(key);
  }
  return result;
};

const equalSets = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && [...a].every((item) => b.has(item));

function validateGold(gold: TemporalGold): void {
  if (
    gold.durationSeconds !== null &&
    (!Number.isFinite(gold.durationSeconds) || gold.durationSeconds <= 0)
  )
    throw new Error('Duration must be positive seconds or null.');
  if (!Array.isArray(gold.conditions) || !Array.isArray(gold.effects))
    throw new Error('Conditions and effects must be arrays.');
  keys(gold.conditions, 'condition');
  keys(gold.effects, 'effect');
}

export function hasDurativeEvidence(gold: TemporalGold): boolean {
  return (
    gold.durationSeconds !== null ||
    gold.conditions.length > 0 ||
    gold.effects.length > 0
  );
}

export function evaluateTemporal(
  cases: TemporalCase[],
  predictions: TemporalPrediction[],
): TemporalReport {
  if (!cases.length || !predictions.length)
    throw new Error('Cases and predictions are required.');
  const byId = new Map<string, TemporalCase>();
  for (const item of cases) {
    if (!item.id?.trim() || byId.has(item.id))
      throw new Error(`Missing or duplicate case ID: ${item.id}`);
    if (!['dev', 'holdout'].includes(item.split))
      throw new Error(`Invalid split for ${item.id}.`);
    if (
      !item.input?.description?.trim() ||
      !item.input.action?.trim() ||
      !Array.isArray(item.input.vocabulary) ||
      !item.provenance?.sourceUrl?.trim() ||
      !item.provenance.sourceId?.trim() ||
      item.provenance.annotation !== 'project-curated'
    )
      throw new Error(`Invalid case metadata for ${item.id}.`);
    validateGold(item.gold);
    byId.set(item.id, item);
  }
  const runIds = new Set<string>();
  const seen = new Set<string>();
  const scores: TemporalCaseScore[] = [];
  const totals: TemporalReport['totals'] = {
    predictions: 0,
    detectionCorrect: 0,
    durationCorrect: 0,
    conditionsCorrect: 0,
    effectsCorrect: 0,
    exact: 0,
    truePositive: 0,
    trueNegative: 0,
    falsePositive: 0,
    falseNegative: 0,
  };
  for (const prediction of predictions) {
    const item = byId.get(prediction.id);
    if (!item) throw new Error(`Unknown case ID: ${prediction.id}`);
    if (!prediction.runId?.trim()) throw new Error('Run ID is required.');
    const identity = JSON.stringify([prediction.runId, prediction.id]);
    if (seen.has(identity))
      throw new Error(`Duplicate prediction: ${identity}`);
    seen.add(identity);
    runIds.add(prediction.runId);
    validateGold(prediction);
    if (typeof prediction.hasDurativeEvidence !== 'boolean')
      throw new Error(`Detection answer is required for ${prediction.id}.`);
    const expectedDetection = hasDurativeEvidence(item.gold);
    const detectionCorrect =
      prediction.hasDurativeEvidence === expectedDetection;
    const durationCorrect =
      prediction.durationSeconds === item.gold.durationSeconds;
    const conditionsCorrect = equalSets(
      keys(prediction.conditions, 'condition'),
      keys(item.gold.conditions, 'condition'),
    );
    const effectsCorrect = equalSets(
      keys(prediction.effects, 'effect'),
      keys(item.gold.effects, 'effect'),
    );
    const exact =
      detectionCorrect &&
      durationCorrect &&
      conditionsCorrect &&
      effectsCorrect;
    scores.push({
      id: prediction.id,
      runId: prediction.runId,
      detectionCorrect,
      durationCorrect,
      conditionsCorrect,
      effectsCorrect,
      exact,
    });
    totals.predictions++;
    if (detectionCorrect) totals.detectionCorrect++;
    if (durationCorrect) totals.durationCorrect++;
    if (conditionsCorrect) totals.conditionsCorrect++;
    if (effectsCorrect) totals.effectsCorrect++;
    if (exact) totals.exact++;
    if (expectedDetection)
      totals[
        prediction.hasDurativeEvidence ? 'truePositive' : 'falseNegative'
      ]++;
    else
      totals[
        prediction.hasDurativeEvidence ? 'falsePositive' : 'trueNegative'
      ]++;
  }
  if (seen.size !== runIds.size * cases.length)
    throw new Error('Each run must contain exactly one prediction per case.');
  return { cases: cases.length, runs: runIds.size, totals, scores };
}
