/** Saved runs are data, never authority for current checks or a cached plan. */
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import {
  checkActions,
  checkPredicates,
  checkTypes,
  hasErrors,
  type Issue,
} from './check.js';
import {
  ActionsResultSchema,
  PredicatesResultSchema,
  ProblemResultSchema,
  RefineResultSchema,
  TypesResultSchema,
  type Domain,
  type ProblemResult,
  type TypesResult,
  type PredicatesResult,
  type ActionsResult,
} from './ir.js';
import { checkPlan } from './planner.js';
import { checkProblemWithReachability } from './problem-check.js';
import { checkSources, sourceSentences } from './provenance.js';
import { renderDomain, renderProblem } from './render.js';
import {
  namingIssues,
  parseTypes,
  parsePredicates,
  parseActions,
  parseRefine,
  parseProblem,
  type StageName,
} from './stages.js';
import type { DesignRun } from './workflow.js';

export const STAGES: StageName[] = [
  'types',
  'predicates',
  'actions',
  'refine',
  'problem',
];
const parsers = {
  types: parseTypes,
  predicates: parsePredicates,
  actions: parseActions,
  refine: parseRefine,
  problem: parseProblem,
};
const schemas = {
  types: TypesResultSchema,
  predicates: PredicatesResultSchema,
  actions: ActionsResultSchema,
  refine: RefineResultSchema,
  problem: ProblemResultSchema,
};
const issueSchema = Type.Object({
  severity: Type.Union([Type.Literal('error'), Type.Literal('warning')]),
  path: Type.String(),
  message: Type.String(),
  code: Type.Optional(Type.String()),
});
const runSchema = Type.Object({
  version: Type.Literal(1),
  status: Type.Union(
    ['planned', 'unsolvable', 'search_limit', 'invalid', 'failed'].map((x) =>
      Type.Literal(x),
    ),
  ),
  input: Type.Object({
    description: Type.String({ maxLength: 100000 }),
    problemDescription: Type.String({ maxLength: 100000 }),
    domainName: Type.String({ pattern: '^[a-z][a-z0-9-]{0,39}$' }),
    problemName: Type.String({ pattern: '^[a-z][a-z0-9-]{0,39}$' }),
    correlationId: Type.String(),
  }),
  stages: Type.Array(
    Type.Object({
      stage: Type.Union(STAGES.map((x) => Type.Literal(x))),
      attempt: Type.Integer({ minimum: 1 }),
      source: Type.Optional(
        Type.Union([Type.Literal('task'), Type.Literal('edit')]),
      ),
      taskId: Type.Optional(Type.String()),
      brief: Type.String(),
      result: Type.Unknown(),
      issues: Type.Array(issueSchema),
      durationMs: Type.Number({ minimum: 0 }),
    }),
    { maxItems: 1000 },
  ),
  issues: Type.Array(issueSchema),
  durationMs: Type.Number({ minimum: 0 }),
});
export function readRun(value: unknown): DesignRun {
  if (!Value.Check(runSchema, value))
    throw new Error(
      'This file is not a version 1 DesignRun. Check its input and stage records.',
    );
  // Whitelist fields: imported derived results and review claims are recomputed.
  const raw = value as DesignRun;
  const run: DesignRun = {
    version: 1,
    status: raw.status,
    input: {
      description: raw.input.description,
      problemDescription: raw.input.problemDescription,
      domainName: raw.input.domainName,
      problemName: raw.input.problemName,
      correlationId: raw.input.correlationId,
    },
    stages: structuredClone(raw.stages).map((s) => ({
      ...s,
      source: s.source ?? (s.taskId ? 'task' : 'edit'),
    })),
    issues: [],
    durationMs: raw.durationMs,
  };
  if (raw.needsReview) {
    if (
      !Array.isArray(raw.needsReview) ||
      raw.needsReview.some((s) => !STAGES.includes(s))
    )
      throw new Error('Invalid saved review state.');
    run.needsReview = [...raw.needsReview];
  }
  return recheckRun(run);
}
export function recheckRun(original: DesignRun): DesignRun {
  const run = structuredClone(original);
  delete run.domain;
  delete run.problem;
  delete run.domainPddl;
  delete run.problemPddl;
  delete run.plan;
  delete run.grounding;
  delete run.reachability;
  delete run.review;
  delete run.reviewPassed;
  delete run.failure;
  run.sourceSentences = sourceSentences(run.input.description);
  run.issues = [];
  run.status = 'invalid';
  const domain: Domain = {
    name: run.input.domainName,
    types: [],
    predicates: [],
    actions: [],
  };
  let problem: ProblemResult | undefined;
  for (const stage of STAGES) {
    const record = run.stages.findLast((s) => s.stage === stage);
    if (!record) {
      run.failure = { stage, reason: `The ${stage} stage has no result yet.` };
      return run;
    }
    try {
      const result = parsers[stage]({ result: record.result });
      const findings: Issue[] = [
        ...namingIssues(schemas[stage], result),
        ...checkSources(result, run.sourceSentences),
      ];
      switch (stage) {
        case 'types':
          domain.types = (result as TypesResult).types;
          findings.push(...checkTypes(domain.types));
          break;
        case 'predicates':
          domain.predicates = (result as PredicatesResult).predicates;
          findings.push(...checkPredicates(domain.types, domain.predicates));
          break;
        case 'actions':
        case 'refine':
          domain.actions = (result as ActionsResult).actions;
          findings.push(
            ...checkActions(domain.types, domain.predicates, domain.actions),
          );
          break;
        case 'problem':
          problem = result as ProblemResult;
          findings.push(
            ...checkProblemWithReachability(
              domain,
              problem,
              run.input.problemName,
            ),
          );
          break;
      }
      record.issues = findings;
      run.issues.push(...findings);
      if (hasErrors(findings)) {
        run.failure = {
          stage,
          reason: 'Correct the marked findings before passing this stage.',
        };
        return run;
      }
    } catch (error) {
      record.issues = [
        {
          severity: 'error',
          code: 'schema',
          path: stage,
          message: error instanceof Error ? error.message : String(error),
        },
      ];
      run.issues.push(...record.issues);
      run.failure = {
        stage,
        reason: 'The edited result does not match this stage.',
      };
      return run;
    }
  }
  if (problem) {
    run.domain = domain;
    run.problem = { name: run.input.problemName, ...problem };
    run.domainPddl = renderDomain(domain);
    run.problemPddl = renderProblem(run.problem, domain.name);
    const check = checkPlan(domain, run.problem);
    Object.assign(run, check);
    run.status =
      check.plan.status === 'found'
        ? 'planned'
        : check.plan.status === 'limit'
          ? 'search_limit'
          : 'unsolvable';
  }
  return run;
}
export function editRun(
  original: DesignRun,
  stage: StageName,
  result: unknown,
): DesignRun {
  const run = structuredClone(original);
  run.stages.push({
    stage,
    source: 'edit',
    attempt:
      Math.max(
        0,
        ...run.stages.filter((s) => s.stage === stage).map((s) => s.attempt),
      ) + 1,
    brief: '',
    result,
    issues: [],
    durationMs: 0,
  });
  // A new draft action list replaces its old refinement; never retain a stale plan.
  if (stage === 'actions')
    run.stages.push({
      stage: 'refine',
      source: 'edit',
      attempt:
        Math.max(
          0,
          ...run.stages
            .filter((s) => s.stage === 'refine')
            .map((s) => s.attempt),
        ) + 1,
      brief: '',
      result: {
        actions: (result as ActionsResult)?.actions,
        changes: ['Draft actions changed; review the refinement again.'],
      },
      issues: [],
      durationMs: 0,
    });
  run.needsReview = [
    ...new Set([
      ...(run.needsReview ?? []),
      ...STAGES.slice(STAGES.indexOf(stage)),
    ]),
  ];
  return recheckRun(run);
}
export function passSavedStage(
  original: DesignRun,
  stage: StageName,
): DesignRun {
  const run = recheckRun(original);
  const record = run.stages.findLast((s) => s.stage === stage);
  if (
    !record ||
    hasErrors(record.issues) ||
    (run.failure && STAGES.indexOf(run.failure.stage) <= STAGES.indexOf(stage))
  )
    throw new Error('Correct this stage and its preceding stages first.');
  if (
    (run.needsReview ?? []).some(
      (s) => STAGES.indexOf(s) < STAGES.indexOf(stage),
    )
  )
    throw new Error('Pass the preceding edited stages first.');
  run.needsReview = run.needsReview?.filter((s) => s !== stage);
  return run;
}
