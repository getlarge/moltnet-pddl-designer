import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TemporalPass } from './temporal.js';

/** Validate the single-step schedule supplied by the temporal pilot with VAL. */
export function validateTemporalPlan(pass: TemporalPass, binary: string): void {
  if (!pass.temporalPlan)
    throw new Error('VAL validation currently needs a one-step durative plan.');
  const dir = mkdtempSync(join(tmpdir(), 'pddl-temporal-'));
  try {
    const domain = join(dir, 'domain.pddl');
    const problem = join(dir, 'problem.pddl');
    const plan = join(dir, 'plan.soln');
    writeFileSync(domain, pass.domainPddl);
    writeFileSync(problem, pass.problemPddl);
    writeFileSync(plan, pass.temporalPlan.text);
    const check = spawnSync(binary, [domain, problem, plan], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    if (
      check.error ||
      check.status !== 0 ||
      !/\bPlan valid\b/.test(check.stdout)
    )
      throw new Error(
        `VAL rejected the temporal plan: ${check.error?.message ?? (check.stdout + check.stderr).trim()}`,
      );
    pass.temporalPlan = {
      ...pass.temporalPlan,
      status: 'validated',
      validator: 'VAL',
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
