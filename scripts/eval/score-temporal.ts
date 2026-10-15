/** Score saved, normalized predictions without calling a model. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import {
  evaluateTemporal,
  type TemporalCase,
  type TemporalPrediction,
} from '@pddl/evals/temporal';

const [casesFile, predictionsFile, reportFile] = process.argv.slice(2);
if (reportFile) writeFileSync(reportFile, '');
if (!casesFile || !predictionsFile) {
  process.stderr.write(
    'Usage: pnpm eval:temporal <cases.json> <predictions.jsonl> [report.json]\n',
  );
  process.exitCode = 2;
} else {
  if (!existsSync(predictionsFile)) {
    process.stderr.write(
      `No predictions file at ${predictionsFile}.\nCreate a blank template with: pnpm eval:temporal:inputs ${casesFile} <inputs.jsonl> ${predictionsFile}\nFill it with model or classifier answers, then score it.\n`,
    );
    process.exitCode = 1;
  } else {
    try {
      const cases = JSON.parse(
        readFileSync(casesFile, 'utf8'),
      ) as TemporalCase[];
      const predictions = readFileSync(predictionsFile, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as TemporalPrediction);
      if (predictions.some((row) => row.hasDurativeEvidence === null))
        throw new Error(
          'The predictions template still has null detection answers. Fill every row before scoring.',
        );
      const report = evaluateTemporal(cases, predictions);
      const output = JSON.stringify(report, null, 2);
      if (reportFile) writeFileSync(reportFile, output + '\n');
      process.stdout.write(output + '\n');
    } catch (error) {
      process.stderr.write(
        `Could not score predictions: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    }
  }
}
