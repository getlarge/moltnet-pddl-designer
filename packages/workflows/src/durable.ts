import {
  asWorkflowContext,
  isWorkflowInterruption,
} from '@themoltnet/tasks-orchestrator';
import { parseGroundingAnswers } from '@pddl/domain/source-grounding';
import type { StageDecision } from '@pddl/contracts/design';
import {
  DurableRuns,
  TASK_NAME,
  SOURCE_TASK,
  type Params,
  type SourceParams,
} from '@pddl/persistence/durable-runs';
import type { Execute, SourceExecute } from './executor.js';
export function registerWorkflows(
  runs: DurableRuns,
  execute: Execute,
  assess?: SourceExecute,
) {
  runs.absurd.registerTask<Params, null>(
    { name: TASK_NAME, defaultMaxAttempts: 5 },
    async ({ id, input, options: runOptions }, ctx) => {
      let eventOrdinal = 0;
      let gateOrdinal = 0;
      await execute(input, {
        ...runOptions,
        ctx: asWorkflowContext(ctx),
        onEvent: async (event) => {
          const ordinal = ++eventOrdinal;
          await ctx.step(`publish.${ordinal}`, async () => {
            await runs.publish(id, ordinal, event);
            return null;
          });
        },
        confirmStage: async (gate) => {
          const ordinal = ++gateOrdinal;
          await ctx.step(`gate.${ordinal}.publish`, async () => {
            await runs.publishGate(id, ordinal, gate);
            return null;
          });
          return (await ctx.awaitEvent(
            `decision:${id}:${ordinal}`,
          )) as StageDecision;
        },
      });
      return null;
    },
  );
  runs.absurd.registerTask<SourceParams, null>(
    { name: SOURCE_TASK, defaultMaxAttempts: 5 },
    async ({ id, gateId, request, profile, startedAt }, ctx) => {
      const snapshot = await runs.get(id);
      if (
        !snapshot ||
        snapshot.state !== 'awaiting' ||
        snapshot.gate?.id !== gateId ||
        snapshot.sourceCheck?.workflowId !== ctx.taskID ||
        snapshot.sourceCheck.status !== 'checking'
      )
        return null;
      try {
        if (!assess) throw new Error('Source assessment is unavailable.');
        const answer = await assess(
          snapshot.input,
          request,
          profile,
          async (taskId) => {
            await ctx.step('source.publish-task', async () => {
              await runs.updateSource(id, gateId, ctx.taskID, { taskId });
              return null;
            });
          },
          asWorkflowContext(ctx),
        );
        parseGroundingAnswers(answer.output, request);
        await ctx.step('source.publish-answer', async () => {
          await runs.updateSource(id, gateId, ctx.taskID, {
            ...answer,
            status: 'complete',
            durationMs: Date.now() - startedAt,
          });
          return null;
        });
      } catch (error) {
        if (isWorkflowInterruption(error)) throw error;
        await ctx.step('source.publish-failure', async () => {
          await runs.updateSource(id, gateId, ctx.taskID, {
            status: 'failed',
            failure: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - startedAt,
          });
          return null;
        });
      }
      return null;
    },
  );
}
