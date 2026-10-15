import { FakeTasks } from '@themoltnet/tasks-orchestrator/testing';
import type { TaskClient } from '@themoltnet/tasks-orchestrator';
import { describe, expect, it, vi } from 'vitest';
import { createSourceAssessor } from './source-check.js';
import { buildGroundingRequest, groundingTargets } from './source-grounding.js';
import { blocksDomain } from './test-fixtures.js';

const input = buildGroundingRequest(
  'An arm moves blocks.',
  blocksDomain,
  [groundingTargets(blocksDomain)[0]],
  'Blocks start on the table.',
);
const output = {
  version: 1,
  answers: {
    claim_1: {
      type: 'choice',
      choice: 'supported',
      probabilities: {
        supported: 0.9,
        contradicted: 0.05,
        not_established: 0.05,
      },
      confidence: 0.8,
    },
  },
};
const options = {
  teamId: 'team',
  diaryId: 'diary',
  correlationId: 'correlation',
  pollIntervalSec: 0,
};

describe('production source assessor', () => {
  it('creates one classify task, exposes its ID, validates the answer and preserves usage', async () => {
    const tasks = new FakeTasks([output]);
    const usage = {
      inputTokens: 80,
      outputTokens: 20,
      model: 'synthetic',
      provider: 'local',
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    const attempts = tasks.listAttempts.bind(tasks);
    vi.spyOn(tasks, 'listAttempts').mockImplementation(async (id) =>
      (await attempts(id)).map((a) => ({ ...a, usage })),
    );
    const onTask = vi.fn();
    const result = await createSourceAssessor(tasks, options)(
      input,
      'profile',
      onTask,
    );
    expect(tasks.created).toHaveLength(1);
    expect(tasks.created[0]).toMatchObject({
      taskType: 'classify',
      maxAttempts: 1,
      input,
      allowedProfiles: [{ profileId: 'profile' }],
    });
    expect(onTask).toHaveBeenCalledWith(result.taskId);
    expect(result.output).toEqual(output);
    expect(result.usage).toEqual(usage);
  });
  it('rejects malformed returned answers with their validation reason', async () => {
    const tasks = new FakeTasks([{ version: 1, answers: {} }]);
    await expect(
      createSourceAssessor(tasks, options)(input, 'profile', vi.fn()),
    ).rejects.toThrow('Classification answer count does not match');
  });
  it('times out a queued task without inventing an answer', async () => {
    const tasks: TaskClient = {
      createTask: async () => ({ id: 'queued-task' }) as never,
      getTask: async () => ({ id: 'queued-task', status: 'queued' }) as never,
      listAttempts: async () => [],
    };
    const onTask = vi.fn();
    await expect(
      createSourceAssessor(tasks, { ...options, claimTimeoutSec: 0 })(
        input,
        'profile',
        onTask,
      ),
    ).rejects.toThrow('No classification worker claimed');
    expect(onTask).toHaveBeenCalledWith('queued-task');
  });
  it('starts a fresh task when the user reruns identical input after terminal failure', async () => {
    const tasks = new FakeTasks([{ __taskStatus: 'failed' }, output]);
    const create = tasks.createTask.bind(tasks);
    const submissions = new Map<
      string,
      Awaited<ReturnType<TaskClient['createTask']>>
    >();
    // Model the server's actual idempotency behavior: the same key returns the old task.
    vi.spyOn(tasks, 'createTask').mockImplementation(
      async (body, creationOptions) => {
        const key = creationOptions!.idempotencyKey!;
        if (submissions.has(key)) return submissions.get(key)!;
        const task = await create(body, creationOptions);
        submissions.set(key, task);
        return task;
      },
    );
    const assess = createSourceAssessor(tasks, options);
    const onTask = vi.fn();
    await expect(assess(input, 'profile', onTask)).rejects.toThrow(
      'ended with status failed',
    );
    const second = await assess(input, 'profile', onTask);
    expect(second.output).toEqual(output);
    expect(tasks.created).toHaveLength(2);
    expect(onTask.mock.calls[0][0]).not.toBe(onTask.mock.calls[1][0]);
    expect(tasks.creationOptions[0]?.idempotencyKey).not.toBe(
      tasks.creationOptions[1]?.idempotencyKey,
    );
  });
});
