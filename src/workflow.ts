/**
 * NL → planning-domain design workflow, after Acitelli et al. (CAI 2026),
 * "Generating Domain Models for Automated Planning from Natural Language
 * Descriptions", with three changes found by reproducing it:
 *
 * 1. Stage outputs are typed atoms delivered through freeform output
 *    contracts, and PDDL is rendered by code instead of written by a model.
 * 2. Deterministic checks run after every stage; an invalid result gets one
 *    bounded correction task listing the exact problems.
 * 3. A planner checks the result. The grounding table and the plan (or its
 *    absence) are part of the output, because schema-valid stages can still
 *    produce a domain that cannot reach the goal or that skips required work.
 *
 * The returned DesignRun holds everything a reviewer or a UI needs: each
 * stage's brief, result and findings, the rendered PDDL, and the plan check.
 */
import { createHash } from 'node:crypto';
import {
  checkSources,
  sourceSentences,
  type SourceSentence,
} from './provenance.js';

import {
  createInlineContext,
  createTaskStep,
  beginWorkflowStep,
  completeWorkflowStep,
  type TaskOutcome,
  type WorkflowContext,
  type TaskClient,
  waitForTaskOutcome,
} from '@themoltnet/tasks-orchestrator';

import {
  checkActions,
  checkPredicates,
  checkTypes,
  hasErrors,
  type Issue,
  REVIEW_ONLY_CODES,
} from './check.js';
import {
  ActionsResultSchema,
  type Domain,
  PredicatesResultSchema,
  type Problem,
  type ProblemResult,
  ProblemResultSchema,
  RefineResultSchema,
  TypesResultSchema,
} from './ir.js';
import {
  checkPlan,
  DEFAULT_LIMITS,
  type GroundingRow,
  type PlannerLimits,
  type PlanResult,
  type Reachability,
} from './planner.js';
import { checkProblemWithReachability } from './problem-check.js';
import { renderDomain, renderProblem } from './render.js';
import { type PlanReview, type ReviewOptions, reviewPlan } from './review.js';
import {
  buildActionsTask,
  buildPredicatesTask,
  buildProblemTask,
  buildRefineTask,
  buildTypesTask,
  type Correction,
  type DesignInput,
  namingIssues,
  parseActions,
  parsePredicates,
  parseProblem,
  parseRefine,
  parseTypes,
  type StageName,
  type StageTaskBody,
} from './stages.js';

export interface StageRecord {
  stage: StageName;
  attempt: number;
  /** `task`: a model produced the result; `edit`: the reviewer replaced it. */
  source: 'task' | 'edit';
  /** The stage task, for `task` records. */
  taskId?: string;
  brief: string;
  result: unknown;
  issues: Issue[];
  durationMs: number;
}

export type DesignStatus =
  'planned' | 'unsolvable' | 'search_limit' | 'invalid' | 'failed';

export interface DesignRun {
  version: 1;
  sourceSentences?: SourceSentence[];
  /** Gates needing renewed approval after an offline edit. */
  needsReview?: StageName[];
  status: DesignStatus;
  failure?: { stage: StageName; reason: string; code?: 'claim-timeout' };
  input: Pick<
    DesignInput,
    | 'description'
    | 'problemDescription'
    | 'domainName'
    | 'problemName'
    | 'correlationId'
  >;
  stages: StageRecord[];
  domain?: Domain;
  problem?: Problem;
  domainPddl?: string;
  problemPddl?: string;
  /** Changes the refine stage reports making to the draft actions. */
  refinements?: string[];
  /** Warnings that remain on the final domain and problem. */
  issues: Issue[];
  grounding?: GroundingRow[];
  reachability?: Reachability;
  plan?: PlanResult;
  /** Plan reviews, one per round, when review is enabled. */
  review?: Array<PlanReview & { round: number }>;
  /** True when the last review found no shortcuts. */
  reviewPassed?: boolean;
  durationMs: number;
}

/** Progress of a run, emitted as it happens, for live display. */
export type DesignEvent =
  | { type: 'task-created'; stage: StageName; attempt: number; taskId: string }
  | { type: 'task-claimed'; stage: StageName; attempt: number; taskId: string }
  | { type: 'stage-checking'; stage: StageName; attempt: number }
  | { type: 'stage-result'; record: StageRecord }
  | { type: 'stage-accepted'; stage: StageName; attempt: number }
  | { type: 'plan-checked'; status: DesignStatus; plan: PlanResult }
  | { type: 'review'; round: number; findings: Issue[] }
  | { type: 'finished'; run: DesignRun };

/** A stage result waiting for the reviewer's decision. */
export interface StageGate {
  stage: StageName;
  attempt: number;
  result: unknown;
  /** Check findings on `result`; errors mean it cannot be accepted. */
  issues: Issue[];
}

export type StageDecision =
  /** Continue with this result. Refused while the checks report errors. */
  | { action: 'accept' }
  /** Replace the result; it is re-checked and the gate asks again. */
  | { action: 'edit'; result: unknown }
  /** Send a correction task carrying this message. */
  | { action: 'feedback'; message: string }
  | { action: 'abort'; reason?: string };

export interface DesignOptions {
  /** Start a correction at a saved stage; preceding results are checked again. */
  resume?: { run: DesignRun; stage: StageName; feedback: string };
  /** Durable execution context; omitted for the single-process CLI. */
  ctx?: WorkflowContext;
  /** Progress persistence is awaited before execution advances. */
  onEvent?: (event: DesignEvent) => void | Promise<void>;
  /**
   * Called when a stage result is ready: after it passes the checks, or once
   * the automatic corrections are used up. Without it, a passing result is
   * accepted and a failing one stops the run as `invalid`.
   */
  confirmStage?: (gate: StageGate) => Promise<StageDecision>;
  /** Correction tasks allowed per stage after a result fails the checks. */
  maxCorrections?: number;
  pollIntervalSec?: number;
  /**
   * Fail the run when no worker claims a stage task within this many seconds
   * (default 600), instead of waiting for the task to expire.
   */
  claimTimeoutSec?: number;
  limits?: PlannerLimits;
  /**
   * Review a found plan for shortcuts and send findings back for correction.
   * `rounds` bounds how many review rounds may trigger a fix (default 1).
   * Shared work needs item-specific facts, so it re-runs the predicates and
   * actions stages; a skippable required step only re-runs refine.
   */
  review?: ReviewOptions & { rounds?: number };
}

class StageStopped extends Error {
  constructor(
    readonly stage: StageName,
    readonly status: 'invalid' | 'failed',
    reason: string,
    readonly code?: 'claim-timeout',
  ) {
    super(reason);
  }
}

function idempotencyKey(input: DesignInput, stage: string, attempt: number) {
  const digest = createHash('sha256')
    .update(`${input.correlationId}\0${stage}\0${attempt}`)
    .digest('base64url');
  return 'pddl:' + digest;
}

const reviewOnly = (issues: Issue[]) =>
  issues.filter((i) => !REVIEW_ONLY_CODES.has(i.code ?? ''));

export async function runPddlDesign(
  tasks: TaskClient,
  input: DesignInput,
  options: DesignOptions = {},
): Promise<DesignRun> {
  const ctx: WorkflowContext = options.ctx ?? {
    ...createInlineContext(input.correlationId),
    sleepFor: (_name, seconds) =>
      new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000)),
  };
  const started = await ctx.step('run.started', async () => Date.now());
  const maxCorrections = options.maxCorrections ?? 1;
  const pollIntervalSec = options.pollIntervalSec ?? 2;
  const claimTimeoutSec = options.claimTimeoutSec ?? 600;
  if (options.resume) {
    const order: StageName[] = [
      'types',
      'predicates',
      'actions',
      'refine',
      'problem',
    ];
    const pending = options.resume.run.needsReview?.find(
      (stage) => order.indexOf(stage) < order.indexOf(options.resume!.stage),
    );
    if (pending)
      throw new Error(
        `Pass the saved ${pending} stage before requesting a correction to ${options.resume.stage}.`,
      );
  }
  const run: DesignRun = {
    version: 1,
    sourceSentences: sourceSentences(input.description),
    status: 'failed',
    input: {
      description: input.description,
      problemDescription: input.problemDescription,
      domainName: input.domainName,
      problemName: input.problemName,
      correlationId: input.correlationId,
    },
    stages: [],
    issues: [],
    durationMs: 0,
  };

  /** Wait until a worker claims the task, or fail with a pointed reason. */
  async function awaitClaim(name: StageName, taskId: string) {
    const handle = await beginWorkflowStep<boolean>(
      ctx,
      `claim.${taskId}.done`,
    );
    if (handle.done) return;
    const deadline = await ctx.step(
      `claim.${taskId}.deadline`,
      async () => Date.now() + claimTimeoutSec * 1000,
    );
    for (;;) {
      const task = await tasks.getTask(taskId);
      if (task.status !== 'queued') {
        await completeWorkflowStep(ctx, handle, true);
        return;
      }
      if (Date.now() >= deadline)
        throw new StageStopped(
          name,
          'failed',
          `no worker claimed task ${taskId} within ${claimTimeoutSec}s; check that a poller is running for this profile and correlation`,
          'claim-timeout',
        );
      await ctx.sleepFor(`claim.${taskId}`, pollIntervalSec);
    }
  }

  const resumed = new Set<StageName>();
  const stageOrder: StageName[] = [
    'types',
    'predicates',
    'actions',
    'refine',
    'problem',
  ];
  if (
    options.resume &&
    options.resume.run.input.description !== input.description
  )
    throw new Error('A correction must use the saved description.');
  const emit = (event: DesignEvent) => options.onEvent?.(event);
  const record = async (entry: StageRecord) => {
    run.stages.push(entry);
    await emit({ type: 'stage-result', record: entry });
  };
  const decide = (gate: StageGate): Promise<StageDecision> =>
    options.confirmStage
      ? options.confirmStage(gate)
      : Promise.resolve(
          hasErrors(gate.issues) ? { action: 'abort' } : { action: 'accept' },
        );

  /**
   * Run one stage: automatic corrections while the checks report errors, then
   * the reviewer's decision, which may edit the result or ask for another
   * task with feedback.
   */
  async function stage<T>(
    name: StageName,
    build: (attempt: number, correction?: Correction) => StageTaskBody,
    parse: (output: unknown) => T,
    check: (result: T) => Issue[],
    seed?: Correction,
  ): Promise<{ result: T; issues: Issue[] }> {
    // Attempts keep counting across review rounds so idempotency keys differ.
    let attempt = run.stages.filter((s) => s.stage === name).length + 1;
    let correction: Correction | undefined = seed;
    const resume = options.resume;
    if (resume && !resumed.has(name)) {
      resumed.add(name);
      const saved = resume.run.stages.findLast((s) => s.stage === name);
      if (stageOrder.indexOf(name) < stageOrder.indexOf(resume.stage)) {
        if (!saved)
          throw new StageStopped(
            name,
            'invalid',
            'The saved run has no preceding stage result.',
          );
        const result = parse({ result: saved.result });
        const issues = [
          ...check(result),
          ...checkSources(result, run.sourceSentences ?? []),
        ];
        if (hasErrors(issues))
          throw new StageStopped(
            name,
            'invalid',
            'Correct the preceding saved stage before continuing.',
          );
        await record({ ...saved, issues });
        await emit({
          type: 'stage-accepted',
          stage: name,
          attempt: saved.attempt,
        });
        return { result, issues };
      }
      if (name === resume.stage)
        correction = {
          previous: saved?.result ?? {},
          issues: [
            {
              severity: 'error',
              path: name,
              code: 'reviewer-feedback',
              message: resume.feedback,
            },
          ],
        };
    }
    let corrections = 0;
    for (;;) {
      const stageStart = await ctx.step(
        `stage.${name}.${attempt}.started`,
        async () => Date.now(),
      );
      const body = build(attempt, correction);
      const task = await createTaskStep(
        ctx,
        `stage.${name}.${attempt}.create`,
        ({ idempotencyKey: durableKey }) =>
          tasks.createTask(body, {
            idempotencyKey: durableKey ?? idempotencyKey(input, name, attempt),
          }),
      );
      await emit({
        type: 'task-created',
        stage: name,
        attempt,
        taskId: task.id,
      });
      await awaitClaim(name, task.id);
      await emit({
        type: 'task-claimed',
        stage: name,
        attempt,
        taskId: task.id,
      });
      const outcomeHandle = await beginWorkflowStep<TaskOutcome<T>>(
        ctx,
        `stage.${name}.${attempt}.outcome`,
      );
      const outcome = outcomeHandle.done
        ? outcomeHandle.state
        : await completeWorkflowStep(
            ctx,
            outcomeHandle,
            await waitForTaskOutcome(task.id, {
              tasks,
              // MoltNet task update events have no generation. Fresh reads + durable
              // timers avoid reusing immutable events during repeated polling.
              ctx: { ...ctx, awaitEvent: undefined },
              pollIntervalSec,
              parse,
            }),
          );
      if (outcome.kind !== 'accepted')
        throw new StageStopped(name, 'failed', outcome.reason);
      let result = outcome.result.state;
      await emit({ type: 'stage-checking', stage: name, attempt });
      let issues = [
        ...check(result),
        ...checkSources(result, run.sourceSentences ?? []),
      ];
      await record({
        stage: name,
        attempt,
        source: 'task',
        taskId: task.id,
        brief: body.input.brief,
        result,
        issues,
        durationMs: await ctx.step(
          `stage.${name}.${attempt}.duration`,
          async () => Date.now() - stageStart,
        ),
      });
      const errors = () => issues.filter((i) => i.severity === 'error');
      if (hasErrors(issues) && corrections < maxCorrections) {
        corrections++;
        correction = { previous: result, issues: errors() };
        attempt++;
        continue;
      }

      // What the reviewer last saw: the result, or an edit the schema rejected.
      let shown: unknown = result;
      let feedback: string | undefined;
      while (feedback === undefined) {
        const decision = await decide({
          stage: name,
          attempt,
          result: shown,
          issues,
        });
        if (decision.action === 'accept' && !hasErrors(issues)) {
          await emit({ type: 'stage-accepted', stage: name, attempt });
          return { result, issues };
        }
        if (decision.action === 'accept' || decision.action === 'abort') {
          throw hasErrors(issues)
            ? new StageStopped(
                name,
                'invalid',
                `still failing checks after ${maxCorrections} correction(s)`,
              )
            : new StageStopped(
                name,
                'failed',
                (decision.action === 'abort' && decision.reason) ||
                  `stopped by the reviewer at the ${name} stage`,
              );
        }
        if (decision.action === 'feedback') {
          feedback = decision.message;
          break;
        }
        // An edit is checked like a model result, schema first.
        attempt++;
        shown = decision.result;
        try {
          result = parse({ result: decision.result });
          await emit({ type: 'stage-checking', stage: name, attempt });
          issues = [
            ...check(result),
            ...checkSources(result, run.sourceSentences ?? []),
          ];
        } catch (error) {
          issues = [
            {
              severity: 'error',
              path: name,
              code: 'schema',
              message: error instanceof Error ? error.message : String(error),
            },
          ];
        }
        await record({
          stage: name,
          attempt,
          source: 'edit',
          brief: '',
          result: decision.result,
          issues,
          durationMs: 0,
        });
      }
      correction = {
        previous: shown,
        issues: [
          {
            severity: 'error',
            path: name,
            code: 'reviewer-feedback',
            message: feedback,
          },
          ...errors(),
        ],
      };
      attempt++;
    }
  }

  try {
    const types = await stage(
      'types',
      (n, c) => buildTypesTask(input, n, c),
      parseTypes,
      (r) => [...namingIssues(TypesResultSchema, r), ...checkTypes(r.types)],
    );
    const runPredicates = (seed?: Correction) =>
      stage(
        'predicates',
        (n, c) => buildPredicatesTask(input, types.result, n, c),
        parsePredicates,
        (r) => [
          ...namingIssues(PredicatesResultSchema, r),
          ...checkPredicates(types.result.types, r.predicates),
        ],
        seed,
      );
    let predicates = await runPredicates();
    const runActions = (seed?: Correction) =>
      stage(
        'actions',
        (n, c) =>
          buildActionsTask(input, types.result, predicates.result, n, c),
        parseActions,
        (r) => [
          ...namingIssues(ActionsResultSchema, r),
          ...checkActions(
            types.result.types,
            predicates.result.predicates,
            r.actions,
          ),
        ],
        seed,
      );
    let draft = await runActions();
    const runRefine = (seed?: Correction) =>
      stage(
        'refine',
        (n, c) =>
          buildRefineTask(
            input,
            types.result,
            predicates.result,
            draft.result.actions,
            reviewOnly(draft.issues),
            n,
            c,
          ),
        parseRefine,
        (r) => [
          ...namingIssues(RefineResultSchema, r),
          ...checkActions(
            types.result.types,
            predicates.result.predicates,
            r.actions,
          ),
        ],
        seed,
      );
    let refined = await runRefine();

    let problemResult: ProblemResult | undefined;
    const rounds = options.review ? (options.review.rounds ?? 1) : 0;
    for (let round = 0; ; round++) {
      const domain: Domain = {
        name: input.domainName,
        types: types.result.types,
        predicates: predicates.result.predicates,
        actions: refined.result.actions,
      };
      run.domain = domain;
      run.refinements = refined.result.changes;
      run.domainPddl = renderDomain(domain);

      // Keep the problem across review rounds unless the new domain rejects it.
      const existing = problemResult
        ? checkProblemWithReachability(domain, problemResult, input.problemName)
        : [];
      let problemIssues = existing;
      if (!problemResult || hasErrors(existing)) {
        const parameterTypes = [
          ...new Set(
            domain.actions.flatMap((a) => a.parameters.map((p) => p.type)),
          ),
        ];
        const problemStage = await stage(
          'problem',
          (n, c) =>
            buildProblemTask(input, run.domainPddl ?? '', parameterTypes, n, c),
          parseProblem,
          (r) => [
            ...namingIssues(ProblemResultSchema, r),
            ...checkProblemWithReachability(domain, r, input.problemName),
          ],
          problemResult
            ? {
                previous: problemResult,
                issues: existing.filter((x) => x.severity === 'error'),
              }
            : undefined,
        );
        problemResult = problemStage.result;
        problemIssues = problemStage.issues;
      }
      const problem: Problem = { name: input.problemName, ...problemResult };
      run.problem = problem;
      run.problemPddl = renderProblem(problem, domain.name);
      run.issues = [...refined.issues, ...problemIssues];

      const check = checkPlan(
        domain,
        problem,
        options.limits ?? DEFAULT_LIMITS,
      );
      run.grounding = check.grounding;
      run.reachability = check.reachability;
      run.plan = check.plan;
      run.status =
        check.plan.status === 'found'
          ? 'planned'
          : check.plan.status === 'unsolvable'
            ? 'unsolvable'
            : 'search_limit';
      await emit({
        type: 'plan-checked',
        status: run.status,
        plan: check.plan,
      });
      if (!options.review || check.plan.status !== 'found') break;

      const review = await reviewPlan(
        domain,
        problem,
        { description: input.description, situation: input.problemDescription },
        { ...options.review, limits: options.limits ?? DEFAULT_LIMITS },
      );
      run.review = [...(run.review ?? []), { ...review, round: round + 1 }];
      await emit({
        type: 'review',
        round: round + 1,
        findings: review.findings,
      });
      run.reviewPassed = review.findings.length === 0;
      if (run.reviewPassed || round >= rounds) break;

      const findings = review.findings;
      if (findings.some((f) => f.code === 'shared-work')) {
        // Item-specific facts may not exist yet: let the predicates stage add
        // them, then rebuild the actions from the previous ones.
        predicates = await runPredicates({
          previous: predicates.result,
          issues: [
            {
              severity: 'error',
              path: 'predicates',
              code: 'shared-work',
              message:
                "A plan check found that one item can reach its goal with another item's work. Add predicates that name the item a result belongs to (for example a fact relating a produced thing to its item), keeping every existing predicate the actions still need.",
            },
            ...findings,
          ],
        });
        draft = await runActions({
          previous: refined.result.actions.length
            ? { actions: refined.result.actions }
            : draft.result,
          issues: findings,
        });
        refined = await runRefine();
      } else {
        refined = await runRefine({
          previous: refined.result,
          issues: findings,
        });
      }
    }
  } catch (error) {
    if (!(error instanceof StageStopped)) throw error;
    run.status = error.status;
    run.failure = {
      stage: error.stage,
      reason: error.message,
      ...(error.code ? { code: error.code } : {}),
    };
  }
  run.durationMs = await ctx.step(
    'run.duration',
    async () => Date.now() - started,
  );
  await emit({ type: 'finished', run });
  return run;
}
