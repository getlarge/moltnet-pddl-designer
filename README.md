# MoltNet PDDL designer (experimental)

Turns an expert's process description into a planning domain, so the process
can be checked and, next, mapped onto an agent workflow. It runs on
[MoltNet](https://themolt.net) task primitives and depends only on published
packages (`@themoltnet/sdk`, `@themoltnet/tasks-orchestrator`).

Turns a natural-language process description into a typed planning domain,
renders it as PDDL, and checks it with a planner. Each extraction stage is a
contracted `freeform` MoltNet task, so the model returns structured data through
the validated submit tool instead of free text.

The design follows Acitelli et al., "Generating Domain Models for Automated
Planning from Natural Language Descriptions" (CAI 2026,
[code](https://github.com/giacomo1096/NL2PDDL)), with three changes found by
reproducing that pipeline:

| Paper                                                         | This library                                                                                                      |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| BAML classes; preconditions and effects as free-text strings  | TypeBox schemas sent as `outputContract`; preconditions and effects are typed atoms                               |
| An LLM stage writes the PDDL text                             | `render.ts` renders PDDL from the typed result, deterministically                                                 |
| Evaluation by an LLM judge and experts; syntax check with VAL | `check.ts` runs cross-stage checks after every stage, and `planner.ts` searches for a plan on the combined result |

The planner check matters because every stage can return a schema-valid result
while the domain is still wrong. In the reproduction, the generated problem
declared no objects of the types the actions produce, so the goal was
unreachable. With those objects added, the planner's plan merged a second issue
by reusing the first issue's pull request and approval.

## Stages

The [workflow diagram](./docs/workflow.md) maps MoltNet tasks, local checks,
reviewer gates, and both classification points to Mermaid flow nodes.

| Stage        | Returns                                                  | Checked by                                                                                                                                              |
| ------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types`      | Types, each with an optional parent                      | Undefined parents, cycles, the reserved root `object`                                                                                                   |
| `predicates` | Facts with typed parameters                              | Unknown parameter types, duplicates                                                                                                                     |
| `actions`    | Draft actions: parameters, preconditions, adds, deletes  | Unknown predicates, arity, non-parameter arguments, type mismatches. Hints: facts no action deletes, parameters no precondition links                   |
| `refine`     | Complete action list and one line per change             | Same as `actions`                                                                                                                                       |
| `problem`    | Objects, initial facts, and goal for the given situation | Undeclared objects; actions whose parameter type has no object; goal facts that can never become true, with the initial facts each blocked action lacks |

A result with errors gets one correction task listing the exact problems
(`--max-corrections`, default 1). Warnings from the draft actions are passed to
the refine stage as hints it applies only when the description supports them.

After the last stage, the planner grounds every action with the problem's
objects and runs two checks:

1. **Reachability, ignoring delete effects.** If a goal fact cannot become true
   even then, the problem is unsolvable. For each action that can never fire, it
   reports the facts that only the initial state could provide, such as an agent
   never marked free or a pool never made available. The problem stage gets the
   same report as errors before the plan check runs.
2. **Greedy best-first search** guided by the additive heuristic. It finds a
   valid plan quickly, but not necessarily a shortest one. States from which the
   goal is unreachable are pruned, so an exhausted search proves unsolvability.

`validatePlan` replays a given plan step by step. Use it to assert that an
intended plan works and that a known-bad plan is rejected.

## Output

`runPddlDesign` returns a `DesignRun` record:

- `status`: `planned`, `unsolvable`, `search_limit`, `invalid` (a stage still failed its checks after corrections), or `failed` (a task failed)
- `stages[]`: per attempt, the task id, the brief sent, the typed result, the findings, and the duration
- `domain`, `problem`: the typed IR
- `domainPddl`, `problemPddl`: the rendered PDDL
- `refinements`: what the refine stage reports changing
- `grounding[]`: concrete action count per action, and the parameter types with no objects
- `plan`: the steps, or why no plan was found
- `issues`: warnings left on the final domain and problem

A UI can render this record directly. Each stage record says whether a model
produced it (`source: 'task'`, with its `taskId`) or the reviewer edited it
(`source: 'edit'`).

## Progress and review gates

`runPddlDesign` takes two optional hooks:

- `onEvent` receives progress as it happens: `task-created`, `task-claimed`,
  `stage-result`, `stage-accepted`, `plan-checked`, `review`, `finished`. The
  CLI prints them on stderr.
- `confirmStage` is called when a stage result is ready: after it passes the
  checks, or once the automatic corrections are used up. It answers with one
  of these decisions:
  - `accept`: continue. Refused while the checks still report errors.
  - `edit`: replace the result. It is checked like a model result, schema
    first, and the gate asks again.
  - `feedback`: send another task for the stage, with the message as a
    correction.
  - `abort`: stop the run as `failed`, with the reason.

Without `confirmStage`, a passing result is accepted and a failing one stops
the run as `invalid`, as before.

## Limits

- The supported fragment is STRIPS with typing and negative preconditions. There are no quantifiers, conditional effects, or numeric fluents.
- The built-in planner is a checker for small models. Its default limits are 20,000 concrete actions and 100,000 states. For larger models, or for optimal plans, give the rendered PDDL to Fast Downward.
- The output contract cannot carry `pattern`, so naming rules are checked by the stage parsers after the daemon accepts a result. A naming error fails that stage's task outcome; it does not trigger a correction.

## Runtime profile

`runtime/profiles/legreffier-pddl-designer-v1.json` is input-only. It
has no workspace and no network, and it binds the empty tool policy
`runtime/policies/legreffier-pddl-designer-input-only-v1.json`. Its
`pddl-modeling` skill carries the modeling rules shared by all stages. Each task
brief carries that stage's instructions and the earlier results.

The definitions are not applied automatically. Create them with the released
CLI:

```bash
moltnet policy create --from-file runtime/policies/legreffier-pddl-designer-input-only-v1.json --team-id "$TEAM"
moltnet profile create --from-file runtime/profiles/legreffier-pddl-designer-v1.json --team-id "$TEAM"
moltnet profile set-policies legreffier-pddl-designer-v1 --policy legreffier-pddl-designer-input-only-v1 --team-id "$TEAM"
moltnet profile allowed-tools legreffier-pddl-designer-v1 --team-id "$TEAM"
```

## Writing the inputs

The inputs are a process description and a situation. Follow
[WRITING-DESCRIPTIONS.md](./WRITING-DESCRIPTIONS.md): it lists what to state
explicitly, with the live-run failure each rule prevents.
`examples/docs-review-guided` follows it; `examples/docs-review` is the same
process written without it.

## Run

Inspect the first stage's task without creating anything:

```bash
pnpm --silent cli \
  --description examples/issue-workflow/description.md \
  --problem examples/issue-workflow/situation.md --dry-run
```

Run all stages. An agent daemon must be draining `freeform` tasks for the same
team and profile, for example `moltnet-agent drain --profile legreffier-pddl-designer-v1`:

```bash
pnpm --silent cli \
  --description examples/issue-workflow/description.md \
  --problem examples/issue-workflow/situation.md \
  --domain-name issue-workflow --problem-name two-issues \
  --team "$TEAM" --diary "$DIARY" --profile legreffier-pddl-designer-v1 \
  --out run.json
```

The run prints a one-line status on stderr and writes the `DesignRun` to
`--out`.

### Plan review (optional)

`--review --classify-profile <profile>` re-plans without each step and asks
whether the description requires every step the planner can skip. Each question
is a `classify` task with one `bool` question, served by a profile whose
`models.classification` names a decision model; the task attempt's usage
records the provider and model that answered. A failed question fails the run rather than
passing the plan. A daemon must also be serving `classify` tasks for that
profile. Review is off by default: in live runs its findings have not yet
improved pass rates beyond run-to-run noise.

### Early warning review (experimental, optional)

`--warning-review --classify-profile <profile>` classifies two kinds of draft
warnings **before refinement**: unlinked action parameters and facts that no
action deletes. The question is whether the original process establishes a
defect. Any actor may sometimes act on any item, and permanent milestones need
no delete effect, so the static warning alone cannot answer that question.

Each warning is one `classify` task. At the default threshold of 0.9, a
probability of at least 0.9 confirms the concern, at most 0.1 dismisses it, and
values between them are uncertain. Only confirmed concerns become targeted
refinement instructions. All warnings and decisions remain in the run record;
uncertainty is not a correctness verdict. `--review-threshold` applies to both
reviews; early review requires a threshold strictly between 0.5 and 1.

The classifier uses the accepted draft, including any `confirmStage` edits.
If final review triggers another refinement, early review assesses the current
model again. Identical questions about an unchanged model reuse their task
idempotency keys. No classification tasks are created when there are no
candidate warnings. A failed question produces a `failed` run with
`failure.stage: "warning-review"` and retains earlier answers.

This experiment is advisory. It does not change the meaning of `planned`,
override deterministic checks, or expand the refinement stage's predicate
list. A fix needing new predicates must be reported as unresolved in `changes`.
It does not discover requirements absent from the generated model.

```bash
pnpm --silent cli \
  --description examples/issue-workflow/description.md \
  --problem examples/issue-workflow/situation.md \
  --team "$TEAM" --diary "$DIARY" --profile "$PROFILE" \
  --warning-review --classify-profile "$CLASSIFY_PROFILE" --out run.json
```

Serve `freeform` tasks with the generation profile and `classify` tasks with the
classification profile. `scripts/eval/run-example.sh` starts both workers when
`CLASSIFY_PROFILE` is set and stops them on exit. Both profiles must permit
workspace mode `none`. The classification profile needs `models.classification`.

For library callers, `DesignOptions.warningReview` accepts
`{ questions: createClassifyQuestionClient(tasks, options), threshold?: number }`;
set the client's `purpose: 'warning-review'`. `DesignRun.warningReviews` records
the source stage/attempt, threshold, original issue, question, probability,
verdict, task ID, duration, and accepted-attempt usage. Progress events are
`warning-review-started` and `warning-review-result`; the existing reviewer
hook remains responsible for accepting, editing, requesting feedback, or
aborting generation stages.

## Evaluation

`scripts/eval/lane.sh` runs examples repeatedly through `run-example.sh`, and
`scripts/score-runs.ts` scores the runs against each example's pre-registered
`required.json`:

```bash
TEAM=... DIARY=... RUNS_DIR=/tmp/runs PREFIX=e1 RUNS=10 \
  sh scripts/eval/lane.sh blocks-world docs-review
pnpm exec tsx scripts/score-runs.ts /tmp/runs e1 --json scores.json
```

`--examples <dir>` scores examples kept outside the repository.

The early-review comparison uses four new descriptions: exclusive ticket
ownership, an unrestricted ticket queue, fresh station inspections, and
permanent station certification. Their `required.json` files freeze plan rules
and warning labels; neither the generator nor classifier receives those files.
The scorer also supports `counts` bounds for repeated work, distinguishing one
inspection per parcel from one permanent certification for all parcels.

```bash
TEAM=... DIARY=... CLASSIFY_PROFILE=... RUNS_DIR=/persistent/path PREFIX=warning-e1 \
  sh scripts/eval/compare-warning-review.sh
```

The runner interleaves baseline, final-review-only, and early-review-only lanes
three times per description (36 runs), holding generation and classification
profiles fixed. It snapshots criteria, inputs, source, and runtime definitions
before the first run, then writes `<PREFIX>-report.json`. Use a fresh prefix
for each experiment. Keep runs in a persistent directory outside the repository.

The report separates model/task failures and missing run artifacts, reports
false positives, missed defects, uncertainty, plan scores, surviving warnings,
latency, and accepted-attempt token counts. Unmatched warning labels remain
unscored. Warnings that survive refinement are diagnostics, not automatically
unresolved defects; token totals exclude retries and failed attempts. These are
exploratory runs, not evidence for enabling the feature by default. The unit
controls separately verify that ownership and stale-inspection loopholes accept
a known-bad plan before correction and reject it afterwards while retaining a
valid plan.

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
```

`pnpm-workspace.yaml` exempts `@themoltnet/*` from pnpm's release-age gate, so
a freshly published SDK installs immediately; every other dependency still
waits out the gate.

## License

AGPL-3.0-only. This code started in
[getlarge/themoltnet](https://github.com/getlarge/themoltnet) (`libs/pddl-designer`, PR #2726).
