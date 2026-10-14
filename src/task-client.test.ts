import { expect, it, vi } from 'vitest';
import { createTeamTaskClient } from './task-client.js';
import { buildTypesTask } from './stages.js';
import { syntheticInput } from '../server/test-support.js';

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
