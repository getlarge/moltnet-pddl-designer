import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { TemporalPass } from './temporal.js';
import { validateTemporalPlan } from './temporal-validate.js';

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function validator(output: string, exitCode = 0): string {
  const dir = mkdtempSync(join(tmpdir(), 'pddl-fake-val-'));
  directories.push(dir);
  const path = join(dir, 'Validate');
  writeFileSync(
    path,
    `#!/bin/sh\nprintf '%s\\n' '${output}'\nexit ${exitCode}\n`,
  );
  chmodSync(path, 0o755);
  return path;
}

function pass(): TemporalPass {
  return {
    baseRun: {} as TemporalPass['baseRun'],
    status: 'complete',
    detections: [],
    durativeActions: [],
    defaultedClauses: [],
    domainPddl: '(define (domain test))\n',
    problemPddl: '(define (problem test))\n',
    temporalPlan: { status: 'candidate', text: '0: (inspect) [120]\n' },
  };
}

it('marks a candidate validated only when VAL reports a successful verdict', () => {
  const result = pass();
  validateTemporalPlan(result, validator('Plan valid'));
  expect(result.temporalPlan).toMatchObject({
    status: 'validated',
    validator: 'VAL',
  });
});

it('keeps a rejected or failed VAL result as a candidate', () => {
  for (const [output, code] of [
    ['Plan failed', 0],
    ['Plan valid', 1],
  ] as const) {
    const result = pass();
    expect(() => validateTemporalPlan(result, validator(output, code))).toThrow(
      'VAL rejected the temporal plan',
    );
    expect(result.temporalPlan?.status).toBe('candidate');
  }
});
