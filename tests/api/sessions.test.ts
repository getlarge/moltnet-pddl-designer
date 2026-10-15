import { expect, it } from 'vitest';
import { Session } from '../support/test-session.js';
import {
  syntheticExecute,
  syntheticInput,
  syntheticAssess,
} from '../support/test-support.js';
import type { SourceAssessor } from '@pddl/contracts/source-check';
import { groundingTargets } from '@pddl/domain/source-grounding';
import { blocksDomain } from '@pddl/domain/test-fixtures';

it('blocks decisions during assessment and discards a late answer after withdrawal', async () => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  const assessor: SourceAssessor = async (input, profile, onTask) => {
    onTask('synthetic-pending');
    await ready;
    return syntheticAssess(input, profile, () => {});
  };
  const session = new Session(syntheticInput, syntheticExecute, {}, assessor);
  const run = session.start(syntheticInput);
  for (const stage of ['types', 'predicates']) {
    await expect.poll(() => session.snapshot.gate?.stage).toBe(stage);
    session.decide(session.snapshot.gate!.id, { action: 'accept' });
  }
  await expect.poll(() => session.snapshot.gate?.stage).toBe('actions');
  const gate = session.snapshot.gate!;
  const check = session.checkSource(
    gate.id,
    [groundingTargets(blocksDomain)[0]],
    'synthetic',
  );
  expect(session.snapshot.sourceCheck?.status).toBe('checking');
  expect(() => session.decide(gate.id, { action: 'accept' })).toThrow(
    'Wait for the source check',
  );
  expect(() =>
    session.decide(gate.id, { action: 'edit', result: gate.result }),
  ).toThrow();
  await expect(
    session.checkSource(
      gate.id,
      [groundingTargets(blocksDomain)[0]],
      'synthetic',
    ),
  ).rejects.toThrow('already running');
  session.decide(gate.id, {
    action: 'abort',
    reason: 'Synthetic test withdrawal.',
  });
  await run;
  release();
  await check;
  expect(session.snapshot.sourceCheck?.status).toBe('failed');
  expect(session.snapshot.sourceCheck?.output).toBeUndefined();
  expect(session.snapshot.run?.sourceChecks?.[0].status).toBe('failed');
});
