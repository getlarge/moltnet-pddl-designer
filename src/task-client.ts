import type { Agent } from '@themoltnet/sdk';
import type { TaskClient } from '@themoltnet/tasks-orchestrator';

type TaskApi = Pick<
  Agent['tasks'],
  'create' | 'get' | 'listAttempts' | 'listMessages'
>;

/** Bind all task I/O to the run's team, including reads after checkpoint replay. */
export function createTeamTaskClient(
  tasks: TaskApi,
  teamId: string,
): TaskClient {
  return {
    createTask(body, options) {
      const { teamId: requestedTeam, ...input } = body;
      if (requestedTeam !== teamId)
        throw new Error('Task team differs from the run team.');
      return tasks.create(input, {
        teamId,
        idempotencyKey: options?.idempotencyKey,
      });
    },
    getTask: (id) => tasks.get(id, { teamId }),
    listAttempts: (id) => tasks.listAttempts(id, { teamId }),
    listMessages: (id, attemptN) =>
      tasks.listMessages(id, attemptN, { limit: 100 }, { teamId }),
  };
}
