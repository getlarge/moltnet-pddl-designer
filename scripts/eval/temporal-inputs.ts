/** Export inputs and an optional blank prediction template without gold labels. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import type { TemporalCase } from '@pddl/evals/temporal';
import { assertDistinctFilePaths } from './distinct-paths.js';

const [casesFile, outputFile, templateFile] = process.argv.slice(2);
if (!casesFile || !outputFile) {
  process.stderr.write(
    'Usage: pnpm eval:temporal:inputs <cases.json> <inputs.jsonl> [predictions-template.jsonl]\n',
  );
  process.exitCode = 2;
} else {
  assertDistinctFilePaths([
    casesFile,
    outputFile,
    ...(templateFile ? [templateFile] : []),
  ]);
  const cases = JSON.parse(readFileSync(casesFile, 'utf8')) as TemporalCase[];
  writeFileSync(
    outputFile,
    cases.map(({ id, input }) => JSON.stringify({ id, input })).join('\n') +
      '\n',
  );
  process.stdout.write(`Wrote ${cases.length} input cases to ${outputFile}.\n`);
  if (templateFile) {
    if (existsSync(templateFile)) {
      process.stdout.write(`Kept existing predictions file ${templateFile}.\n`);
    } else {
      writeFileSync(
        templateFile,
        cases
          .map(({ id }) =>
            JSON.stringify({
              id,
              runId: 'manual-1',
              hasDurativeEvidence: null,
              durationSeconds: null,
              conditions: [],
              effects: [],
            }),
          )
          .join('\n') + '\n',
      );
      process.stdout.write(
        `Wrote a blank predictions template to ${templateFile}. Fill the null detection answers and extracted fields before scoring.\n`,
      );
    }
  } else {
    process.stdout.write(
      'No predictions file was created. Pass a third path to create a blank template.\n',
    );
  }
}
