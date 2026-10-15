/** Export inputs without gold labels for model-facing evaluation. */
import { readFileSync, writeFileSync } from 'node:fs';

import type { TemporalCase } from '@pddl/evals/temporal';

const [casesFile, outputFile] = process.argv.slice(2);
if (!casesFile || !outputFile) {
  process.stderr.write(
    'Usage: pnpm eval:temporal:inputs <cases.json> <inputs.jsonl>\n',
  );
  process.exitCode = 2;
} else {
  const cases = JSON.parse(readFileSync(casesFile, 'utf8')) as TemporalCase[];
  writeFileSync(
    outputFile,
    cases.map(({ id, input }) => JSON.stringify({ id, input })).join('\n') +
      '\n',
  );
}
