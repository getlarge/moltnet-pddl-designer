/** Saved runs are data, never authority for current checks or a cached plan. */
import { readSourceChecks } from './source-check.js';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import {
  checkActions,
  checkPredicates,
  checkTypes,
  hasErrors,
  type Issue,
} from '@pddl/domain/check';
import {
  ActionsResultSchema,
  PredicatesResultSchema,
  ProblemResultSchema,
  RefineResultSchema,
  ParameterSchema,
  TypesResultSchema,
  type Domain,
  type ProblemResult,
  type TypesResult,
  type PredicatesResult,
  type ActionsResult,
} from '@pddl/domain/ir';
import { checkPlan } from '@pddl/domain/planner';
import { checkProblemWithReachability } from '@pddl/domain/problem-check';
import { checkSources, sourceSentences } from '@pddl/domain/provenance';
import {
  renderDomain,
  renderDomainWithTiming,
  renderProblem,
} from '@pddl/domain/render';
import { assertActionCoverage } from '@pddl/domain/temporal';
import {
  namingIssues,
  parseTypes,
  parsePredicates,
  parseActions,
  parseRefine,
  parseProblem,
  type StageName,
} from './stages.js';
import type { DesignRun } from './design.js';

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
const timedLiteralSchema = Type.Object(
  {
    predicate: Type.String(),
    args: Type.Array(Type.String()),
    negated: Type.Boolean(),
    timing: Type.Union(
      ['start', 'overall', 'end'].map((value) => Type.Literal(value)),
    ),
  },
  { additionalProperties: false },
);
const temporalSchema = Type.Object({
  status: Type.Literal('complete'),
  detections: Type.Array(
    Type.Object({
      action: Type.String(),
      probability: Type.Number({ minimum: 0, maximum: 1 }),
      timed: Type.Boolean(),
      unsupportedReason: Type.Optional(
        Type.Literal('numeric-duration-required'),
      ),
    }),
  ),
  durativeActions: Type.Array(
    Type.Object({
      name: Type.String(),
      parameters: Type.Array(ParameterSchema),
      durationSeconds: Type.Number({ exclusiveMinimum: 0 }),
      conditions: Type.Array(timedLiteralSchema),
      effects: Type.Array(timedLiteralSchema),
    }),
  ),
  defaultedClauses: Type.Array(
    Type.Object({
      action: Type.String(),
      kind: Type.Union([Type.Literal('condition'), Type.Literal('effect')]),
      clause: timedLiteralSchema,
    }),
  ),
  domainPddl: Type.String(),
  problemPddl: Type.String(),
  temporalPlan: Type.Union([
    Type.Null(),
    Type.Object({
      status: Type.Union([
        Type.Literal('candidate'),
        Type.Literal('validated'),
      ]),
      text: Type.String(),
      validator: Type.Optional(Type.Literal('VAL')),
    }),
  ]),
  validationError: Type.Optional(Type.String()),
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
    classificationProfileId: Type.Optional(Type.String({ minLength: 1 })),
    temporal: Type.Optional(
      Type.Union([
        Type.Literal(true),
        Type.Object(
          { classificationProfile: Type.String({ minLength: 1 }) },
          { additionalProperties: false },
        ),
      ]),
    ),
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
  const legacyTemporal = raw.input.temporal as
    { classificationProfile: string } | true | undefined;
  const classificationProfileId =
    raw.input.classificationProfileId ||
    (typeof legacyTemporal === 'object'
      ? legacyTemporal.classificationProfile
      : undefined);
  const run: DesignRun = {
    version: 1,
    status: raw.status,
    input: {
      description: raw.input.description,
      problemDescription: raw.input.problemDescription,
      domainName: raw.input.domainName,
      problemName: raw.input.problemName,
      correlationId: raw.input.correlationId,
      ...(legacyTemporal ? { temporal: true } : {}),
      ...(classificationProfileId ? { classificationProfileId } : {}),
    },
    stages: structuredClone(raw.stages).map((s) => ({
      ...s,
      source: s.source ?? (s.taskId ? 'task' : 'edit'),
    })),
    issues: [],
    durationMs: raw.durationMs,
    ...(raw.sourceChecks
      ? { sourceChecks: readSourceChecks(raw.sourceChecks) }
      : {}),
  };
  if (raw.needsReview) {
    if (
      !Array.isArray(raw.needsReview) ||
      raw.needsReview.some((s) => !STAGES.includes(s))
    )
      throw new Error('Invalid saved review state.');
    run.needsReview = [...raw.needsReview];
  }
  const checked = recheckRun(run);
  if (
    raw.temporal?.status === 'complete' &&
    checked.domain &&
    checked.problem
  ) {
    if (!Value.Check(temporalSchema, raw.temporal))
      throw new Error('The saved timed model has invalid fields.');
    try {
      const domainPddl = renderDomainWithTiming(
        checked.domain,
        raw.temporal.durativeActions,
      );
      for (const action of raw.temporal.durativeActions)
        assertActionCoverage(
          checked.domain.actions.find((item) => item.name === action.name)!,
          action,
        );
      checked.temporal = {
        status: 'complete',
        detections: structuredClone(raw.temporal.detections),
        durativeActions: structuredClone(raw.temporal.durativeActions),
        defaultedClauses: structuredClone(raw.temporal.defaultedClauses),
        domainPddl,
        problemPddl: renderProblem(checked.problem, checked.domain.name),
        temporalPlan: raw.temporal.temporalPlan
          ? { status: 'candidate', text: raw.temporal.temporalPlan.text }
          : null,
        ...(raw.temporal.validationError
          ? { validationError: raw.temporal.validationError.slice(0, 1000) }
          : {}),
      };
    } catch (error) {
      checked.temporal = {
        status: 'failed',
        error: `Saved timed model failed local checks: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  } else if (raw.temporal?.status === 'failed') {
    checked.temporal = {
      status: 'failed',
      error: String(raw.temporal.error).slice(0, 1000),
    };
  }
  return checked;
}
export function recheckRun(original: DesignRun): DesignRun {
  const run = structuredClone(original);
  delete run.temporal;
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
  if (['types', 'predicates', 'actions'].includes(stage))
    delete run.sourceChecks;
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
