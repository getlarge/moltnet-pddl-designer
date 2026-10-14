import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { DurableRuns } from '../../server/durable-runs.js';
import { syntheticExecute, syntheticInput } from '../../server/test-support.js';
import type { RunSnapshot } from '../../server/types.js';

const databaseUrl = process.env.PDDL_TEST_DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    'Set PDDL_TEST_DATABASE_URL to a provisioned test database; see pnpm db:init.',
  );
let runs: DurableRuns;
let children: ChildProcess[];
let queue: string;
beforeEach(async () => {
  queue = 'test_' + randomUUID().replaceAll('-', '');
  children = [];
  runs = new DurableRuns({
    databaseUrl: databaseUrl!,
    queue,
    execute: syntheticExecute,
  });
  await runs.initialize();
  await runs.pool.query(
    'CREATE TABLE IF NOT EXISTS pddl_test_tasks(queue text, key text, task jsonb, attempts jsonb, PRIMARY KEY(queue,key))',
  );
});
afterEach(async () => {
  for (const child of children)
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await once(child, 'exit');
    }
  for (const snapshot of await runs.list())
    await runs.withdraw(snapshot.id, 'test cleanup');
  await runs.pool.query(
    'DELETE FROM pddl_run_events WHERE run_id IN (SELECT id FROM pddl_runs WHERE queue=$1)',
    [queue],
  );
  await runs.pool.query(
    'DELETE FROM pddl_run_gates WHERE run_id IN (SELECT id FROM pddl_runs WHERE queue=$1)',
    [queue],
  );
  await runs.pool.query('DELETE FROM pddl_runs WHERE queue=$1', [queue]);
  await runs.pool.query('DELETE FROM pddl_test_tasks WHERE queue=$1', [queue]);
  await runs.absurd.dropQueue(queue);
  await runs.close();
});
async function worker(extra: Record<string, string> = {}, marker = 'READY') {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'tests/durable/worker.ts'],
    {
      env: { ...process.env, TEST_QUEUE: queue, ...extra },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  children.push(child);
  await new Promise<void>((resolve, reject) => {
    let output = '';
    child.stdout!.on('data', (data) => {
      output += String(data);
      if (output.includes(marker)) resolve();
    });
    child.stderr!.on('data', (data) => {
      output += String(data);
    });
    child.once('exit', (code) =>
      reject(new Error(`worker exited ${code}: ${output}`)),
    );
    child.once('error', reject);
  });
  return child;
}
async function kill(child: ChildProcess) {
  child.kill('SIGKILL');
  await once(child, 'exit');
}
async function until(id: string, predicate: (s: RunSnapshot) => boolean) {
  for (let n = 0; n < 400; n++) {
    const s = await runs.get(id);
    if (s && predicate(s)) return s;
    await delay(50);
  }
  throw new Error('Timed out: ' + JSON.stringify(await runs.get(id)));
}
async function count() {
  return Number(
    (
      await runs.pool.query(
        'SELECT count(*) FROM pddl_test_tasks WHERE queue=$1',
        [queue],
      )
    ).rows[0].count,
  );
}

it('recovers a gate and a decision accepted with no worker, without duplicated effects or history', async () => {
  const first = await worker();
  const start = await runs.start(syntheticInput, {});
  const gate = await until(start.id, (s) => s.state === 'awaiting');
  await kill(first);
  const sequence = gate.sequence;
  await runs.close();
  runs = new DurableRuns({
    databaseUrl: databaseUrl!,
    queue,
    execute: syntheticExecute,
  });
  await runs.initialize();
  expect((await runs.get(start.id))?.gate?.id).toBe(gate.gate!.id);
  await runs.decide(start.id, gate.gate!.id, { action: 'accept' });
  await expect(
    runs.decide(start.id, gate.gate!.id, { action: 'accept' }),
  ).rejects.toThrow('already changed');
  await worker();
  let current = await until(
    start.id,
    (s) => s.state === 'awaiting' && s.gate?.id !== gate.gate!.id,
  );
  expect(current.sequence).toBeGreaterThan(sequence);
  // A rejected edit must get its own durable generation and remain unpassable.
  await runs.decide(start.id, current.gate!.id, {
    action: 'edit',
    result: { broken: true },
  });
  const invalid = await until(
    start.id,
    (s) => s.state === 'awaiting' && s.gate?.id !== current.gate!.id,
  );
  await expect(
    runs.decide(start.id, invalid.gate!.id, { action: 'accept' }),
  ).rejects.toThrow('Correct');
  await runs.decide(start.id, invalid.gate!.id, {
    action: 'edit',
    result: current.gate!.result,
  });
  current = await until(
    start.id,
    (s) => s.state === 'awaiting' && s.gate?.id !== invalid.gate!.id,
  );
  for (let n = 0; n < 5 && current.state !== 'finished'; n++) {
    const gateId = current.gate!.id;
    await runs.decide(start.id, gateId, { action: 'accept' });
    current = await until(
      start.id,
      (s) =>
        s.state === 'finished' ||
        (s.state === 'awaiting' && s.gate?.id !== gateId),
    );
  }
  expect(current.run?.status).toBe('planned');
  expect(await count()).toBe(5);
  expect(
    current.events.filter((e) => e.event.type === 'task-created'),
  ).toHaveLength(5);
  expect(
    current.events.filter((e) => e.event.type === 'finished'),
  ).toHaveLength(1);
});
it('reuses the external idempotency key after a crash between creation and checkpoint', async () => {
  const start = await runs.start(syntheticInput, {});
  const first = await worker({ CRASH_GAP: '1' }, 'CREATED');
  expect(await count()).toBe(1);
  await kill(first);
  await worker();
  await until(start.id, (s) => s.state === 'awaiting');
  expect(await count()).toBe(1);
  await runs.withdraw(start.id, 'stop recovery test');
  expect((await runs.get(start.id))?.state).toBe('failed');
  expect(await runs.list()).toEqual([]);
});
it('retains the original claim deadline across process death', async () => {
  const first = await worker({ QUEUED: '1' });
  const start = await runs.start(syntheticInput, { claimTimeoutSec: 1 });
  await until(start.id, (s) =>
    s.events.some((e) => e.event.type === 'task-created'),
  );
  await delay(300);
  await kill(first);
  await delay(1200);
  await worker({ QUEUED: '1' });
  const finished = await until(start.id, (s) => s.state === 'finished');
  expect(finished.run?.failure?.code).toBe('claim-timeout');
  expect(await count()).toBe(1);
});
it('atomically enforces one active run across API processes', async () => {
  const other = new DurableRuns({
    databaseUrl: databaseUrl!,
    queue,
    execute: syntheticExecute,
  });
  try {
    const results = await Promise.allSettled([
      runs.start(syntheticInput, {}),
      other.start(syntheticInput, {}),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const active = await runs.list();
    expect(active).toHaveLength(1);
    await other.withdraw(active[0].id, 'release lock');
    expect((await runs.start(syntheticInput, {})).state).toBe('running');
  } finally {
    await other.close();
  }
});

it('recovers outcome polling while an external task is running, then presents one gate', async () => {
  const first = await worker({ RUNNING: '1' });
  const start = await runs.start(syntheticInput, {});
  await until(start.id, (s) =>
    s.events.some((e) => e.event.type === 'task-claimed'),
  );
  // Allow several actual durable sleeps before killing the OS worker.
  await delay(500);
  await kill(first);
  await worker({ RUNNING: '1' });
  await delay(500);
  await runs.pool.query(
    "UPDATE pddl_test_tasks SET task=jsonb_set(task, '{status}', '\"completed\"') WHERE queue=$1",
    [queue],
  );
  const review = await until(start.id, (s) => s.state === 'awaiting');
  expect(review.gate?.stage).toBe('types');
  expect(await count()).toBe(1);
  expect(review.events.map((e) => e.event.type)).toEqual([
    'task-created',
    'task-claimed',
    'stage-checking',
    'stage-result',
  ]);
  expect(
    (
      await runs.pool.query(
        'SELECT count(*) FROM pddl_run_gates WHERE run_id=$1',
        [start.id],
      )
    ).rows[0].count,
  ).toBe('1');
});
