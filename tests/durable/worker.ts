import { randomUUID } from 'node:crypto';
import { FakeTasks } from '@themoltnet/tasks-orchestrator/testing';
import type {
  TaskClient,
  SdkTask,
  SdkTaskAttempt,
} from '@themoltnet/tasks-orchestrator';
import { DurableRuns } from '../../server/durable-runs.js';
import { syntheticResults } from '../../server/test-support.js';
import { runPddlDesign } from '../../src/workflow.js';

const queue = process.env.TEST_QUEUE!;
const runs = new DurableRuns({
  databaseUrl: process.env.PDDL_TEST_DATABASE_URL!,
  queue,
  execute: (input, options) =>
    runPddlDesign(tasks, input, { ...options, pollIntervalSec: 0.1 }),
});
const tasks: TaskClient = {
  async createTask(body, options) {
    const key = options!.idempotencyKey!;
    const existing = await runs.pool.query(
      'SELECT task FROM pddl_test_tasks WHERE queue=$1 AND key=$2',
      [queue, key],
    );
    if (existing.rows[0]) return existing.rows[0].task as SdkTask;
    const fake = new FakeTasks([
      {
        summary: 'Recovery fixture',
        result:
          syntheticResults[
            body.tags!.find((t) => t.startsWith('stage:'))!.slice(6)
          ],
      },
    ]);
    const original = await fake.createTask(body);
    const task = {
      ...original,
      id: randomUUID(),
      ...(process.env.QUEUED ? { status: 'queued' } : {}),
    };
    const attempts = await fake.listAttempts(original.id);
    await runs.pool.query(
      'INSERT INTO pddl_test_tasks(queue,key,task,attempts) VALUES($1,$2,$3,$4)',
      [queue, key, JSON.stringify(task), JSON.stringify(attempts)],
    );
    if (process.env.CRASH_GAP) {
      process.stdout.write('CREATED\n');
      await new Promise(() => {});
    }
    return task as SdkTask;
  },
  async getTask(id) {
    const result = await runs.pool.query(
      "SELECT task FROM pddl_test_tasks WHERE queue=$1 AND task->>'id'=$2",
      [queue, id],
    );
    return result.rows[0].task as SdkTask;
  },
  async listAttempts(id) {
    const result = await runs.pool.query(
      "SELECT attempts FROM pddl_test_tasks WHERE queue=$1 AND task->>'id'=$2",
      [queue, id],
    );
    return result.rows[0].attempts as SdkTaskAttempt[];
  },
  async listMessages() {
    return [];
  },
};
await runs.initialize();
await runs.startWorker({ claimTimeout: 2, pollInterval: 0.05 });
process.stdout.write('READY\n');
