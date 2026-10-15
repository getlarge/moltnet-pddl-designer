import type { TSchema } from 'typebox';
import { Value } from 'typebox/value';

import type { Issue } from '@pddl/domain/check';
import {
  type ActionsResult,
  ActionsResultSchema,
  type PredicatesResult,
  PredicatesResultSchema,
  type ProblemResult,
  ProblemResultSchema,
  type RefineResult,
  RefineResultSchema,
  type TypesResult,
  TypesResultSchema,
} from '@pddl/domain/ir';

export type StageName =
  'types' | 'predicates' | 'actions' | 'refine' | 'problem';

export interface DesignInput {
  /** Natural-language description of the process to model. */
  description: string;
  /** Natural-language description of one concrete situation and its goal. */
  problemDescription: string;
  domainName: string;
  problemName: string;
  teamId: string;
  diaryId: string;
  correlationId: string;
  profileId: string;
  /** Optional generation profile overrides, keyed by modeling stage. */
  stageProfiles?: Partial<Record<StageName, string>>;
  projectId?: string;
}

/** A previous invalid result and what was wrong with it, for a retry. */
export interface Correction {
  previous: unknown;
  issues: Issue[];
}

/** Pattern failures remain correctable naming issues rather than task failures. */
function parseStage<T>(output: unknown, schema: TSchema, label: string): T {
  const value: unknown = (output as { result?: unknown } | null)?.result;
  const structural = [...Value.Errors(schema, value)].filter(
    (error) => error.keyword !== 'pattern',
  );
  if (structural.length) {
    const [first] = structural;
    throw new Error(
      `${label} result ${first.instancePath || '(root)'}: ${first.message}`,
    );
  }
  return value as T;
}

export function namingIssues(schema: TSchema, value: unknown): Issue[] {
  return [...Value.Errors(schema, value)]
    .filter((error) => error.keyword === 'pattern')
    .map((error) => {
      const pointer = error.instancePath.split('/').slice(1);
      const actual = pointer.reduce<unknown>(
        (node, key) => (node as Record<string, unknown> | undefined)?.[key],
        value,
      );
      return {
        severity: 'error' as const,
        path: error.instancePath.slice(1),
        message: `${JSON.stringify(actual)} is not a valid name: use lowercase letters, digits and hyphens, starting with a letter; parameters start with ?`,
      };
    });
}

export const parseTypes = (output: unknown) =>
  parseStage<TypesResult>(output, TypesResultSchema, 'types');
export const parsePredicates = (output: unknown) =>
  parseStage<PredicatesResult>(output, PredicatesResultSchema, 'predicates');
export const parseActions = (output: unknown) =>
  parseStage<ActionsResult>(output, ActionsResultSchema, 'actions');
export const parseRefine = (output: unknown) =>
  parseStage<RefineResult>(output, RefineResultSchema, 'refine');
export const parseProblem = (output: unknown) =>
  parseStage<ProblemResult>(output, ProblemResultSchema, 'problem');
