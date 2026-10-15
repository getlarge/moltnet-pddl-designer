import { readFileSync, writeFileSync } from 'node:fs';
import { connect } from '@themoltnet/sdk/node';
import { createTeamTaskClient } from '@pddl/workflows/task-client';
import { createClassifyDecisionClient } from '@pddl/workflows/decision';
import { hasDurativeEvidence, type TemporalCase } from '@pddl/evals/temporal';

const [casesFile, outputFile, correlationId] = process.argv.slice(2);
if (!casesFile || !outputFile || !correlationId)
  throw new Error(
    'Usage: run-temporal-detection.ts <cases.json> <report.json> <correlation-id>',
  );
const teamId = process.env.TEAM;
const diaryId = process.env.DIARY;
const profileName =
  process.env.CLASSIFY_PROFILE ?? 'legreffier-pddl-classifier-v1';
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
const cases = JSON.parse(readFileSync(casesFile, 'utf8')) as TemporalCase[];
const rows: Array<{
  id: string;
  probability: number;
  predicted: boolean;
  expected: boolean;
  correct: boolean;
  seconds: number;
}> = [];
for (const item of cases) {
  const start = Date.now();
  const probability = await client.yesNo(item.input, {
    instructions:
      'Does the description explicitly provide a quantitative duration for the named action, or a PDDL 2.1 timing qualifier for one of its conditions or effects (at start, throughout, or at end)? Ordering between distinct actions by itself is not durative evidence.',
    criteria: {
      true: 'A numeric duration or a timed start, invariant, or end condition/effect of the named action is stated.',
      false:
        'Only ordering between actions or an untimed action is described; no durative evidence for the named action is stated.',
    },
  });
  const predicted = probability >= 0.5;
  const expected = hasDurativeEvidence(item.gold);
  const row = {
    id: item.id,
    probability,
    predicted,
    expected,
    correct: predicted === expected,
    seconds: (Date.now() - start) / 1000,
  };
  rows.push(row);
  const report = {
    runId: correlationId,
    profile: profile.name,
    model: profile.models.classification.model,
    questionRevision: 'temporal-detection-v1',
    threshold: 0.5,
    completed: rows.length,
    correct: rows.filter((result) => result.correct).length,
    totalSeconds: rows.reduce((sum, result) => sum + result.seconds, 0),
    rows,
  };
  writeFileSync(outputFile, JSON.stringify(report, null, 2) + '\n');
  console.log(
    `${item.id}: p=${probability.toFixed(3)} predicted=${predicted} expected=${expected} ${row.seconds.toFixed(2)}s`,
  );
}
console.log(
  `Detection: ${rows.filter((row) => row.correct).length}/${rows.length} correct; report: ${outputFile}`,
);
