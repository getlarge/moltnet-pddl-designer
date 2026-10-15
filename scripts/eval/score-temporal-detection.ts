import { readFileSync, writeFileSync } from 'node:fs';
import {
  evaluateTemporalDetection,
  type TemporalDetectionCase,
  type TemporalDetectionPrediction,
} from '@pddl/evals/detection';

const [casesFile, outputFile, ...reportFiles] = process.argv.slice(2);
if (!casesFile || !outputFile || reportFiles.length === 0)
  throw new Error(
    'Usage: score-temporal-detection.ts <cases.json> <output.json> <run-report.json>...',
  );

const cases = JSON.parse(
  readFileSync(casesFile, 'utf8'),
) as TemporalDetectionCase[];
const runs = reportFiles.map((file) => {
  const report = JSON.parse(readFileSync(file, 'utf8')) as {
    runId?: string;
    profile?: string;
    model?: string;
    questionRevision?: string;
    predictions?: TemporalDetectionPrediction[];
    rows?: TemporalDetectionPrediction[];
  };
  const predictions = report.predictions ?? report.rows;
  if (!report.runId || !report.profile || !report.model || !predictions)
    throw new Error(`Incomplete classifier report: ${file}`);
  return {
    file,
    runId: report.runId,
    profile: report.profile,
    model: report.model,
    questionRevision: report.questionRevision,
    predictions,
  };
});
const configurations = new Set(
  runs.map((run) =>
    JSON.stringify([run.profile, run.model, run.questionRevision]),
  ),
);
if (configurations.size !== 1)
  throw new Error(
    'Repeat reports must use the same profile, model, and question revision.',
  );
const score = evaluateTemporalDetection(
  cases,
  runs.flatMap((run) => run.predictions),
);
writeFileSync(
  outputFile,
  JSON.stringify(
    {
      inputs: runs.map(
        ({ predictions: _predictions, ...metadata }) => metadata,
      ),
      ...score,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `${score.totals.correct}/${score.totals.cases} correct across ${score.runs} runs; report: ${outputFile}`,
);
