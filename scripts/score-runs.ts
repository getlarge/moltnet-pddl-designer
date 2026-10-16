/** CLI: pnpm exec tsx scripts/score-runs.ts <runs-dir> <label-prefix>
 *        [--json out.json] [--examples <dir>]
 * Scoring rules live beside scoreRun in @pddl/evals/plan.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { scoreRun, type Required, type Run } from '@pddl/evals/plan';

const DEFAULT_EXAMPLES = new URL('../examples/', import.meta.url).pathname;

if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')
) {
  const args = process.argv.slice(2);
  const option = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args.splice(i, 2)[1] : undefined;
  };
  const out = option('--json');
  const examples = option('--examples') ?? DEFAULT_EXAMPLES;
  const [dir, prefix] = args;
  // Longest name first, so `docs-review-guided` wins over `docs-review`.
  const exampleNames = readdirSync(examples)
    .filter((e) => existsSync(join(examples, e, 'required.json')))
    .sort((a, b) => b.length - a.length);
  const rows: Array<{
    label: string;
    example: string;
    pass: boolean;
    reasons: string[];
  }> = [];
  for (const file of readdirSync(dir)
    .filter((f) => f.startsWith(`run-${prefix}`) && f.endsWith('.json'))
    .sort()) {
    const label = file.slice(4, -5);
    const example = exampleNames.find((e) => label.includes(`-${e}-`));
    if (!example) continue;
    const req = JSON.parse(
      readFileSync(join(examples, example, 'required.json'), 'utf8'),
    ) as Required;
    const run = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Run;
    const { pass, reasons } = scoreRun(run, req);
    rows.push({ label, example, pass, reasons });
    process.stdout.write(
      `${pass ? 'PASS' : 'fail'}  ${label.padEnd(34)} ${reasons.slice(0, 3).join(' | ')}\n`,
    );
  }
  if (out) writeFileSync(out, JSON.stringify(rows, null, 2));
}
