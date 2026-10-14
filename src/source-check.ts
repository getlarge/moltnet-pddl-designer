import { createHash } from 'node:crypto';
import { ClassifyInput, ClassifyOutput } from '@themoltnet/sdk';
import {
  createInlineContext,
  type TaskClient,
  type SdkTaskAttempt,
  waitForTaskOutcome,
} from '@themoltnet/tasks-orchestrator';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { AtomSchema } from './ir.js';
import { parseGroundingAnswers } from './source-grounding.js';

export interface SourceCheckRecord {
  attempt: number;
  input: ClassifyInput;
  status: 'checking' | 'complete' | 'failed';
  taskId?: string;
  output?: ClassifyOutput;
  failure?: string;
  durationMs: number;
  usage?: SdkTaskAttempt['usage'];
}
export type SourceAssessor = (
  input: ClassifyInput,
  profile: string,
  onTask: (taskId: string) => void,
) => Promise<{
  taskId: string;
  output: ClassifyOutput;
  usage?: SdkTaskAttempt['usage'];
}>;

export function createSourceAssessor(
  tasks: TaskClient,
  options: {
    teamId: string;
    diaryId: string;
    correlationId: string;
    projectId?: string;
    pollIntervalSec?: number;
    claimTimeoutSec?: number;
  },
): SourceAssessor {
  return async (input, profileId, onTask) => {
    const digest = createHash('sha256')
      .update(JSON.stringify([options.correlationId, profileId, input]))
      .digest('hex');
    const task = await tasks.createTask(
      {
        taskType: 'classify',
        title: 'Compare action rules with source',
        teamId: options.teamId,
        diaryId: options.diaryId,
        projectId: options.projectId,
        correlationId: options.correlationId,
        allowedProfiles: [{ profileId }],
        input,
        tags: ['pddl:designer', 'stage:source-check'],
        maxAttempts: 1,
        dispatchTimeoutSec: 60,
        runningTimeoutSec: 120,
        expiresInSec: 240,
      },
      { idempotencyKey: `pddl-source-check:${digest}` },
    );
    onTask(task.id);
    const interval = options.pollIntervalSec ?? 1;
    const ctx = {
      ...createInlineContext(),
      sleepFor: (_name: string, seconds: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000)),
    };
    const deadline = Date.now() + (options.claimTimeoutSec ?? 60) * 1000;
    while ((await tasks.getTask(task.id)).status === 'queued') {
      if (Date.now() >= deadline)
        throw new Error(
          'No classification worker claimed the check. Start its worker and try again.',
        );
      await ctx.sleepFor('claim', interval);
    }
    let output: ClassifyOutput | undefined;
    const outcome = await waitForTaskOutcome(task.id, {
      tasks,
      ctx,
      pollIntervalSec: interval,
      parse: (raw) => {
        parseGroundingAnswers(raw, input);
        output = raw as ClassifyOutput;
        return output;
      },
    });
    if (outcome.kind !== 'accepted' || !output)
      throw new Error(
        'The source check failed. The draft is still available for review.',
      );
    return { taskId: task.id, output, usage: outcome.result.attempt.usage };
  };
}

const recordSchema = Type.Object({
  attempt: Type.Integer({ minimum: 1 }),
  input: ClassifyInput,
  status: Type.Union([
    Type.Literal('checking'),
    Type.Literal('complete'),
    Type.Literal('failed'),
  ]),
  taskId: Type.Optional(Type.String()),
  output: Type.Optional(ClassifyOutput),
  failure: Type.Optional(Type.String()),
  durationMs: Type.Number({ minimum: 0 }),
  usage: Type.Optional(
    Type.Union([
      Type.Null(),
      Type.Object({
        inputTokens: Type.Number({ minimum: 0 }),
        outputTokens: Type.Number({ minimum: 0 }),
        model: Type.String(),
        provider: Type.String(),
      }),
    ]),
  ),
});
export function readSourceChecks(value: unknown): SourceCheckRecord[] {
  if (!Value.Check(Type.Array(recordSchema, { maxItems: 100 }), value))
    throw new Error('Invalid source-check evidence.');
  for (const record of value) {
    const claims = record.input.state.claims;
    if (
      typeof record.input.state.source !== 'string' ||
      !claims ||
      typeof claims !== 'object' ||
      Array.isArray(claims)
    )
      throw new Error('Invalid source-check context.');
    for (const key of Object.keys(record.input.questions)) {
      const claim = (claims as Record<string, unknown>)[key] as
        | {
            statement?: unknown;
            target?: { action?: unknown; field?: unknown; atom?: unknown };
          }
        | undefined;
      if (
        typeof claim?.statement !== 'string' ||
        typeof claim.target?.action !== 'string' ||
        !['preconditions', 'addEffects', 'deleteEffects'].includes(
          String(claim.target.field),
        )
      )
        throw new Error('Invalid source-check claim.');
      if (!Value.Check(AtomSchema, claim.target.atom))
        throw new Error('Invalid source-check atom.');
    }
    if (record.status === 'complete') {
      if (!record.output || !record.taskId)
        throw new Error('Completed source check has no answer/task.');
      parseGroundingAnswers(record.output, record.input);
    }
  }
  // Optional usage is advisory metadata; whitelist it when consumed by UI.
  return structuredClone(value) as SourceCheckRecord[];
}
