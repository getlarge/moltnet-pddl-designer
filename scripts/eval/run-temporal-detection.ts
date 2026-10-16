import { readFileSync, writeFileSync } from 'node:fs';
import { connect } from '@themoltnet/sdk/node';
import { createTeamTaskClient } from '@pddl/workflows/task-client';
import { createClassifyDecisionClient } from '@pddl/workflows/decision';
import { TEMPORAL_QUESTION } from '@pddl/workflows/temporal';
import { hasDurativeEvidence, type TemporalCase } from '@pddl/evals/temporal';
import {
  evaluateTemporalDetection,
  type TemporalDetectionCase,
  type TemporalDetectionPrediction,
} from '@pddl/evals/detection';
import { assertDistinctFilePaths } from './distinct-paths.js';

const [casesFile, outputFile, correlationId] = process.argv.slice(2);
if (!casesFile || !outputFile || !correlationId)
  throw new Error(
    'Usage: run-temporal-detection.ts <cases.json> <report.json> <correlation-id>',
  );
assertDistinctFilePaths([casesFile, outputFile]);
const teamId = process.env.TEAM;
const diaryId = process.env.DIARY;
const profileName =
  process.env.CLASSIFY_PROFILE ?? 'legreffier-pddl-classifier-v1';
// Identify this invocation before any network request; a failed rerun must not
// leave an earlier complete report at the same path.
writeFileSync(
  outputFile,
  JSON.stringify(
    {
      runId: correlationId,
      requestedProfile: profileName,
      status: 'started',
      completed: 0,
      predictions: [],
    },
    null,
    2,
  ) + '\n',
);
let failedCaseId: string | undefined;
try {
  if (!teamId || !diaryId) throw new Error('TEAM and DIARY are required.');
  const agent = await connect();
  const { items } = await agent.runtimeProfiles.list({ teamId });
  const profile = items.find(
    (p) => p.name === profileName || p.id === profileName,
  );
  if (!profile?.models.classification)
    throw new Error(`Classification profile ${profileName} unavailable.`);
  const client = createClassifyDecisionClient(
    createTeamTaskClient(agent.tasks, teamId),
    {
      teamId,
      diaryId,
      correlationId,
      profileId: profile.id,
      pollIntervalSec: 2,
      claimTimeoutSec: 30,
    },
  );
  const rawCases = JSON.parse(readFileSync(casesFile, 'utf8')) as Array<
    TemporalCase | TemporalDetectionCase
  >;
  const cases: TemporalDetectionCase[] = rawCases.map((item) =>
    'origin' in item
      ? item
      : {
          id: item.id,
          split: item.split,
          family: item.id,
          phenomenon: 'legacy',
          origin: 'project-control',
          input: item.input,
          gold: { hasDurativeEvidence: hasDurativeEvidence(item.gold) },
          provenance: {
            sourceUrl: item.provenance.sourceUrl,
            sourceId: item.provenance.sourceId,
            annotation: 'project-curated',
            notes: 'Adapted from the v1 extraction fixture.',
          },
        },
  );
  const predictions: TemporalDetectionPrediction[] = [];
  for (const item of cases) {
    failedCaseId = item.id;
    const start = Date.now();
    const probability = await client.yesNo(item.input, TEMPORAL_QUESTION);
    const prediction = {
      id: item.id,
      runId: correlationId,
      probability,
      seconds: (Date.now() - start) / 1000,
    };
    predictions.push(prediction);
    const expected = item.gold.hasDurativeEvidence;
    const predicted = probability >= 0.5;
    const report = {
      runId: correlationId,
      profile: profile.name,
      model: profile.models.classification.model,
      questionRevision: 'temporal-detection-v2',
      threshold: 0.5,
      status: 'partial',
      completed: predictions.length,
      totalCases: cases.length,
      predictions,
    };
    writeFileSync(outputFile, JSON.stringify(report, null, 2) + '\n');
    failedCaseId = undefined;
    console.log(
      `${item.id}: p=${probability.toFixed(3)} predicted=${predicted} expected=${expected} ${prediction.seconds.toFixed(2)}s`,
    );
  }
  const score = evaluateTemporalDetection(cases, predictions);
  writeFileSync(
    outputFile,
    JSON.stringify(
      {
        runId: correlationId,
        profile: profile.name,
        model: profile.models.classification.model,
        questionRevision: 'temporal-detection-v2',
        status: 'complete',
        ...score,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Detection: ${score.totals.correct}/${score.totals.cases} correct; report: ${outputFile}`,
  );
} catch (error) {
  const report = JSON.parse(readFileSync(outputFile, 'utf8'));
  writeFileSync(
    outputFile,
    JSON.stringify(
      {
        ...report,
        status: 'failed',
        failedCaseId,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ) + '\n',
  );
  throw error;
}
