import { ClassifyInput, ClassifyOutput } from '@themoltnet/sdk';
import type { SdkTaskAttempt } from '@themoltnet/tasks-orchestrator';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { AtomSchema } from '@pddl/domain/ir';
import { parseGroundingAnswers } from '@pddl/domain/source-grounding';
export interface SourceCheckRecord {
  attempt: number;
  input: ClassifyInput;
  status: 'checking' | 'complete' | 'failed';
  taskId?: string;
  workflowId?: string;
  output?: ClassifyOutput;
  failure?: string;
  durationMs: number;
  usage?: SdkTaskAttempt['usage'];
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
  workflowId: Type.Optional(Type.String()),
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

export type SourceAssessor = (
  input: ClassifyInput,
  profile: string,
  onTask: (taskId: string) => void | Promise<void>,
) => Promise<{
  taskId: string;
  output: ClassifyOutput;
  usage?: SdkTaskAttempt['usage'];
}>;
