import { expect, it, vi } from 'vitest';
import {
  createInlineContext,
  type TaskClient,
} from '@themoltnet/tasks-orchestrator';
import { createTeamTaskClient, waitForTaskClaim } from './task-client.js';
import { buildTypesTask } from './stages.js';
import { syntheticInput } from '@pddl/domain/test-fixtures';

it('passes team context on every task operation, including reads without a preceding create', async () => {
  const tasks = {
    create: vi.fn().mockResolvedValue({ id: 'task' }),
    get: vi.fn().mockResolvedValue({ id: 'task' }),
    listAttempts: vi.fn().mockResolvedValue([]),
    listMessages: vi.fn().mockResolvedValue([]),
  };
  const client = createTeamTaskClient(tasks, syntheticInput.teamId);
  // Replay skips task creation; reads must not depend on an in-memory create map.
  await client.getTask('existing');
  await client.listAttempts('existing');
  await client.listMessages!('existing', 2);
  const context = { teamId: syntheticInput.teamId };
  expect(tasks.get).toHaveBeenCalledWith('existing', context);
  expect(tasks.listAttempts).toHaveBeenCalledWith('existing', context);
  expect(tasks.listMessages).toHaveBeenCalledWith(
    'existing',
    2,
    { limit: 100 },
    context,
  );
  const body = buildTypesTask(syntheticInput, 1);
  const { teamId: _, ...input } = body;
  await client.createTask(body, { idempotencyKey: 'stable-key' });
  expect(tasks.create).toHaveBeenCalledWith(input, {
    ...context,
    idempotencyKey: 'stable-key',
  });
  expect(() => client.createTask({ ...body, teamId: 'another-team' })).toThrow(
    'differs',
  );
});

it('checkpoints queued claim polls and sleeps until a task is claimed', async () => {
  const getTask = vi
    .fn()
    .mockResolvedValueOnce({ status: 'queued' })
    .mockResolvedValueOnce({ status: 'queued' })
    .mockResolvedValueOnce({ status: 'running' });
  const inline = createInlineContext();
  const labels: string[] = [];
  const sleepFor = vi.fn().mockResolvedValue(undefined);
  const ctx = {
    ...inline,
    step: async <T>(name: string, run: () => Promise<T>) => {
      labels.push(name);
      return inline.step(name, run);
    },
    sleepFor,
  };
  await waitForTaskClaim(
    { getTask } as unknown as TaskClient,
    ctx,
    'task-one',
    {
      deadlineStep: 'temporal.test.deadline.task-one',
      claimStep: 'temporal.test.claim.task-one',
      sleepStep: 'temporal.test.wait.task-one',
      timeoutSec: 10,
      pollIntervalSec: 0,
      timeoutMessage: 'unclaimed',
    },
  );
  expect(getTask).toHaveBeenCalledTimes(3);
  expect(labels).toContain('temporal.test.deadline.task-one');
  expect(
    labels.filter((name) => name === 'temporal.test.claim.task-one'),
  ).toHaveLength(3);
  expect(sleepFor).toHaveBeenCalledTimes(2);
});

it('stops a queued task at the claim deadline', async () => {
  const tasks = { getTask: vi.fn().mockResolvedValue({ status: 'queued' }) };
  await expect(
    waitForTaskClaim(
      tasks as unknown as TaskClient,
      createInlineContext(),
      'task-one',
      {
        deadlineStep: 'temporal.test.deadline.task-one',
        claimStep: 'temporal.test.claim.task-one',
        sleepStep: 'temporal.test.wait.task-one',
        timeoutSec: 0,
        pollIntervalSec: 0,
        timeoutMessage: 'unclaimed',
      },
    ),
  ).rejects.toThrow('unclaimed');
});
