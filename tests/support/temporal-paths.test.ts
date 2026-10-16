import {
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let directory: string;
const script = (name: string) => join(process.cwd(), 'scripts/eval', name);

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'temporal-paths-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('temporal CLI output paths', () => {
  it('preserves extraction cases when the score report aliases them', () => {
    const cases = join(directory, 'cases.json');
    const predictions = join(directory, 'predictions.jsonl');
    const original = '{"case":"keep"}\n';
    writeFileSync(cases, original);
    writeFileSync(predictions, '{}\n');
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        script('score-temporal.ts'),
        cases,
        predictions,
        cases,
      ],
      { encoding: 'utf8' },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('File paths must be distinct');
    expect(readFileSync(cases, 'utf8')).toBe(original);
  });

  it('preserves a hard-linked detection input report', () => {
    const cases = join(directory, 'cases.json');
    const input = join(directory, 'run.json');
    const output = join(directory, 'comparison.json');
    const original = '{"runId":"keep"}\n';
    writeFileSync(cases, '[]\n');
    writeFileSync(input, original);
    linkSync(input, output);
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        script('score-temporal-detection.ts'),
        cases,
        output,
        input,
      ],
      { encoding: 'utf8' },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('File paths must be distinct');
    expect(readFileSync(input, 'utf8')).toBe(original);
  });

  it.each(['run-temporal.sh', 'run-temporal-detection.sh'])(
    'preserves a symlinked input in %s',
    (name) => {
      const cases = join(directory, 'cases.json');
      const output = join(directory, 'output.json');
      const original = '{"case":"keep"}\n';
      writeFileSync(cases, original);
      symlinkSync(cases, output);
      const args =
        name === 'run-temporal.sh'
          ? [cases, output, join(directory, 'report.json')]
          : [cases, output];
      const result = spawnSync('sh', [script(name), ...args], {
        encoding: 'utf8',
        env: { ...process.env, TEAM: '', DIARY: '' },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('File paths must be distinct');
      expect(readFileSync(cases, 'utf8')).toBe(original);
    },
  );
});
