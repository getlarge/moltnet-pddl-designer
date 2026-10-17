import type { Agent } from '@themoltnet/sdk';
import type {
  TaskClient,
  WorkflowContext,
} from '@themoltnet/tasks-orchestrator';

type TaskApi = Pick<
  Agent['tasks'],
  'create' | 'get' | 'listAttempts' | 'listMessages'
>;

/** A completed task cannot succeed on a durable retry with the same key. */
export class TerminalTaskError extends Error {}

/** Checkpoint claim observations so a worker can safely sleep past its lease. */
export async function waitForTaskClaim(
  tasks: TaskClient,
  ctx: WorkflowContext,
  taskId: string,
  options: {
    deadlineStep: string;
    claimStep: string;
    sleepStep: string;
    timeoutSec: number;
    pollIntervalSec: number;
    timeoutMessage: string;
  },
): Promise<void> {
  const deadline = await ctx.step(
    options.deadlineStep,
    async () => Date.now() + options.timeoutSec * 1000,
  );
  for (;;) {
    const observation = await ctx.step(options.claimStep, async () => ({
      status: (await tasks.getTask(taskId)).status,
      checkedAt: Date.now(),
    }));
    if (observation.status !== 'queued') return;
    if (observation.checkedAt >= deadline)
      throw new Error(options.timeoutMessage);
    await ctx.sleepFor(options.sleepStep, options.pollIntervalSec);
  }
}

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
