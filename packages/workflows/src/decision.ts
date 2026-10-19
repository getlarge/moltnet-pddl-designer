/**
 * Decision models answer typed questions with probabilities instead of
 * generating text. The review asks them through MoltNet `classify` tasks, so
 * every answer is a durable task record naming the provider and model that
 * produced it. The runtime profile's `models.classification` picks the model
 * (for example `ollama`/`clef` locally or `ollama-cloud`/`clef` directly).
 */
import { TASK_TAGS } from './task-tags.js';
import { createHash } from 'node:crypto';

import { type ClassifyInput, ClassifyOutput } from '@themoltnet/sdk';
import {
  createInlineContext,
  createTaskStep,
  type TaskClient,
  type WorkflowContext,
  waitForTaskOutcome,
} from '@themoltnet/tasks-orchestrator';
import { Value } from 'typebox/value';
import { TerminalTaskError, waitForTaskClaim } from './task-client.js';

export interface YesNoQuestion {
  instructions: string;
  criteria: { false: string; true: string };
}

export interface DecisionClient {
  /** Probability that the answer is "true", from 0 to 1. */
  yesNo(
    state: Record<string, unknown>,
    question: YesNoQuestion,
  ): Promise<number>;
}

export interface ClassifyDecisionOptions {
  teamId: string;
  diaryId: string;
  projectId?: string;
  correlationId: string;
  /** Runtime profile with `models.classification`. */
  profileId: string;
  pollIntervalSec?: number;
  /** Fail when no worker claims a question within this many seconds. */
  claimTimeoutSec?: number;
  ctx?: WorkflowContext;
  purpose?: 'review' | 'temporal';
}

const QUESTION = 'answer';

export function createClassifyDecisionClient(
  tasks: TaskClient,
  options: ClassifyDecisionOptions,
): DecisionClient {
  const pollIntervalSec = options.pollIntervalSec ?? 2;
  const claimTimeoutSec = options.claimTimeoutSec ?? 600;
  const temporal = options.purpose === 'temporal';
  const ctx: WorkflowContext = options.ctx ?? {
    ...createInlineContext(),
    sleepFor: (_name: string, seconds: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, seconds * 1000);
      }),
  };

  return {
    async yesNo(state, question) {
      const input: ClassifyInput = {
        version: 1,
        state,
        questions: { [QUESTION]: { type: 'bool', ...question } },
      };
      // The same question about the same state in one run is one task.
      const digest = createHash('sha256')
        .update(`${options.correlationId}\0${JSON.stringify(input)}`)
        .digest('base64url');
      const task = await createTaskStep(
        ctx,
        `temporal.classify.create.${digest}`,
        () =>
          tasks.createTask(
            {
              taskType: 'classify',
              title: temporal
                ? `PDDL temporal detection ${String(state.action ?? '')}`.trim()
                : 'PDDL review question',
              teamId: options.teamId,
              diaryId: options.diaryId,
              ...(options.projectId ? { projectId: options.projectId } : {}),
              correlationId: options.correlationId,
              allowedProfiles: [{ profileId: options.profileId }],
              runningTimeoutSec: 120,
              dispatchTimeoutSec: 300,
              expiresInSec: 3600,
              maxAttempts: 2,
              tags: [
                TASK_TAGS.designer,
                temporal ? TASK_TAGS.stage.temporal : TASK_TAGS.stage.review,
              ],
              input,
            },
            { idempotencyKey: 'pddl-review:' + digest },
          ),
      );
      await waitForTaskClaim(tasks, ctx, task.id, {
        deadlineStep: `temporal.classify.deadline.${task.id}`,
        claimStep: `temporal.classify.claim.${task.id}`,
        sleepStep: `claim.${task.id}`,
        timeoutSec: claimTimeoutSec,
        pollIntervalSec,
        timeoutMessage: `no worker claimed classify task ${task.id} within ${claimTimeoutSec}s; check that a poller serves the classification profile`,
      });
      const outcome = await waitForTaskOutcome(task.id, {
        tasks: {
          ...tasks,
          getTask: (id) =>
            ctx.step(`temporal.classify.outcome.${id}`, () =>
              tasks.getTask(id),
            ),
          listAttempts: (id) => tasks.listAttempts(id),
        },
        ctx: { ...ctx, awaitEvent: undefined },
        pollIntervalSec,
        parse: (raw) => {
          try {
            return parseYesNo(raw);
          } catch (error) {
            throw new TerminalTaskError(
              `review question returned invalid output: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        },
      });
      if (outcome.kind !== 'accepted')
        throw new TerminalTaskError(
          `review question failed: ${outcome.reason}`,
        );
      return outcome.result.state;
    },
  };
}

/** Probability of "true" from an accepted classify output. */
export function parseYesNo(output: unknown): number {
  if (!Value.Check(ClassifyOutput, output))
    throw new Error('classify output does not match ClassifyOutput');
  const answer = output.answers[QUESTION];
  if (answer?.type !== 'bool')
    throw new Error(`classify output has no bool answer for ${QUESTION}`);
  return answer.probability;
}
