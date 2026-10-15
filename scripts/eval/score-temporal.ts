/** Score saved, normalized predictions without calling a model. */
import { readFileSync, writeFileSync } from 'node:fs';

import {
  evaluateTemporal,
  type TemporalCase,
  type TemporalPrediction,
} from '@pddl/evals/temporal';

const [casesFile, predictionsFile, reportFile] = process.argv.slice(2);
if (!casesFile || !predictionsFile) {
  process.stderr.write(
    'Usage: pnpm eval:temporal <cases.json> <predictions.jsonl> [report.json]\n',
  );
  process.exitCode = 2;
} else {
  const cases = JSON.parse(readFileSync(casesFile, 'utf8')) as TemporalCase[];
  const predictions = readFileSync(predictionsFile, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as TemporalPrediction);
  const report = evaluateTemporal(cases, predictions);
  const output = JSON.stringify(report, null, 2);
  if (reportFile) writeFileSync(reportFile, output + '\n');
  process.stdout.write(output + '\n');
}
