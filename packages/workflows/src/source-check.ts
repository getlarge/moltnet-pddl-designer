import { TASK_TAGS } from './task-tags.js';
import { createHash, randomUUID } from 'node:crypto';
import { ClassifyOutput } from '@themoltnet/sdk';
import {
  createInlineContext,
  createTaskStep,
  beginWorkflowStep,
  completeWorkflowStep,
  type WorkflowContext,
  type TaskOutcome,
  type TaskClient,
  waitForTaskOutcome,
} from '@themoltnet/tasks-orchestrator';
import { parseGroundingAnswers } from '@pddl/domain/source-grounding';

export type { SourceCheckRecord } from '@pddl/contracts/source-check';
export { readSourceChecks } from '@pddl/contracts/source-check';
import type { SourceAssessor } from '@pddl/contracts/source-check';
export type { SourceAssessor } from '@pddl/contracts/source-check';
export function createSourceAssessor(
  tasks: TaskClient,
  options: {
    teamId: string;
    diaryId: string;
    correlationId: string;
    projectId?: string;
    pollIntervalSec?: number;
    claimTimeoutSec?: number;
    ctx?: WorkflowContext;
  },
): SourceAssessor {
  return async (input, profileId, onTask) => {
    // A manual rerun is a new submission, even when its input is unchanged.
    // Transport retries within createTask reuse this submission's fixed key.
    const ctx: WorkflowContext = options.ctx ?? {
      ...createInlineContext(),
      sleepFor: (_name, seconds) =>
        new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000)),
    };
    const submissionId = await ctx.step('source.submission', async () =>
      randomUUID(),
    );
    const digest = createHash('sha256')
      .update(
        JSON.stringify([options.correlationId, profileId, input, submissionId]),
      )
      .digest('hex');
    const task = await createTaskStep(
      ctx,
      'source.create',
      ({ idempotencyKey }) =>
        tasks.createTask(
          {
            taskType: 'classify',
            title: 'Compare action rules with source',
            teamId: options.teamId,
            diaryId: options.diaryId,
            projectId: options.projectId,
            correlationId: options.correlationId,
            allowedProfiles: [{ profileId }],
            input,
            tags: [TASK_TAGS.designer, TASK_TAGS.stage['source-check']],
            maxAttempts: 1,
            dispatchTimeoutSec: 60,
            runningTimeoutSec: 120,
            expiresInSec: 240,
          },
          { idempotencyKey: idempotencyKey ?? `pddl-source-check:${digest}` },
        ),
    );
    await onTask(task.id);
    const interval = options.pollIntervalSec ?? 1;
    const claimed = await beginWorkflowStep<boolean>(ctx, 'source.claimed');
    if (!claimed.done) {
      const deadline = await ctx.step(
        'source.claim.deadline',
        async () => Date.now() + (options.claimTimeoutSec ?? 60) * 1000,
      );
      for (;;) {
        const observation = await ctx.step('source.claim.poll', async () => ({
          status: (await tasks.getTask(task.id)).status,
          checkedAt: Date.now(),
        }));
        if (observation.status !== 'queued') {
          await completeWorkflowStep(ctx, claimed, true);
          break;
        }
        if (observation.checkedAt >= deadline)
          throw new Error(
            'No classification worker claimed the check. Start its worker and try again.',
          );
        await ctx.sleepFor('source.claim.wait', interval);
      }
    }
    const terminal = await beginWorkflowStep<TaskOutcome<ClassifyOutput>>(
      ctx,
      'source.outcome',
    );
    const outcome = terminal.done
      ? terminal.state
      : await completeWorkflowStep(
          ctx,
          terminal,
          await waitForTaskOutcome(task.id, {
            tasks: {
              ...tasks,
              getTask: (id) =>
                ctx.step('source.outcome.poll', () => tasks.getTask(id)),
              listAttempts: (id) => tasks.listAttempts(id),
            },
            ctx: { ...ctx, awaitEvent: undefined },
            pollIntervalSec: interval,
            parse: (raw) => {
              parseGroundingAnswers(raw, input);
              return raw as ClassifyOutput;
            },
          }),
        );
    if (outcome.kind !== 'accepted')
      throw new Error(
        `The source check failed: ${outcome.reason}. The draft is still available for review.`,
      );
    return {
      taskId: task.id,
      output: outcome.result.state,
      usage: outcome.result.attempt.usage,
    };
  };
}
