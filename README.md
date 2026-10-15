# MoltNet PDDL designer (experimental)

Turns an expert's process description and a concrete situation into a typed
PDDL domain and problem, checks them with a planner, and presents a plan for
review. Generation runs as contracted `freeform` tasks on
[MoltNet](https://themolt.net); the model returns structured data through a
validated submit tool.

## Local wizard

Install the Node version in `.tool-versions`, then enable pnpm through Corepack:

```bash
corepack enable pnpm
pnpm install
pnpm dev
```

Open `http://127.0.0.1:4317`. The local server serves the UI and talks to
MoltNet; generation workers run separately (see the [setup guide](docs/SETUP.md)).
For a built UI, run `pnpm build` followed by `pnpm start`. Saved proofs default
to `runs/`; override with `pnpm dev --runs-dir /path/to/proofs`.

Review extracted meaning alongside numbered source sentences, then Pass,
Correct, Return with note, or Withdraw. Description and construction are
independent Show/Hide panels. The screenshots below use the synthetic Blocks
World browser-test fixture; they demonstrate interaction, not model accuracy.

![Types review with source selection, stage routing and review controls](docs/images/wizard-review.png)

Step through the plan to inspect typed participants, changed facts and goal
conditions. The description starts collapsed here to give the walkthrough room.

![Plan walkthrough showing typed action bindings, changed facts and achieved goals](docs/images/plan-walkthrough.png)

An unfinished live run can be recovered from **Resume current run** on a fresh
page. At its review gate, continue reading or withdraw it before starting another
run. Live sessions last only as long as the local server process; save completed
proofs to reopen them after a restart. A worker-claim timeout explains which step
was not picked up and offers **Review setup and retry**. Generated corrections
cannot skip earlier saved edits that still need your approval.

## Writing the inputs

The inputs are a process description and a situation. Follow
[WRITING-DESCRIPTIONS.md](./WRITING-DESCRIPTIONS.md): it lists what to state
explicitly, with the live-run failure each rule prevents.
`examples/docs-review-guided` follows it; `examples/docs-review` is the same
process written without it.

## CLI

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
`--out`. Follow the [setup guide](docs/SETUP.md) to connect MoltNet, create the
runtime profile, and start a worker.

### Plan review (optional)

`--review --classify-profile <profile>` re-plans without each step and asks
whether the description requires every step the planner can skip. Each question
is a `classify` task with one `bool` question, served by a profile whose
`models.classification` names a decision model; the task attempt's usage
records the provider and model that answered. A failed question fails the run rather than
passing the plan. A daemon must also be serving `classify` tasks for that
profile. Review is off by default: in live runs its findings have not yet
improved pass rates beyond run-to-run noise.

## Workflow at a glance

The description defines reusable rules; the situation supplies objects, initial
facts, and a goal. Both feed the plan check. The wizard offers review at each
extraction stage, and invalid results can trigger correction tasks.

```mermaid
flowchart LR
  D["Process description"] --> T["Types"] --> P["Predicates"] --> A["Actions"] --> R["Refinement"]
  S["Situation"] --> I["Problem"]
  D --> I
  R --> I --> C["Checks and planner"] --> O["Plan or findings"]
```

### Stages

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

### Source evidence

Code numbers description sentences; generation tasks receive that numbered
copy and request citations. Citations are model output: local checks reject
nonexistent sentence numbers, while you verify whether the cited text supports
the result. Missing citations remain visible and are not silently invented.
These checks also apply to CLI runs: invalid numbers can trigger the normal
automatic correction attempt. Numbering currently uses Node's `Intl.Segmenter`;
keep the Node/ICU version consistent when moving saved proofs between machines.

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

## Research basis

The pipeline builds on Acitelli et al., [*Generating Domain Models for
Automated Planning from Natural Language Descriptions*](https://eprints.cs.univie.ac.at/8721/)
(CAI 2026; [code](https://github.com/giacomo1096/NL2PDDL)). This implementation
changes how stage results are represented, rendered, and checked:

| Paper | This project |
| --- | --- |
| BAML classes with preconditions and effects as free-text strings | TypeBox output contracts with typed atoms |
| An LLM stage writes PDDL text | `render.ts` renders PDDL deterministically from the typed result |
| LLM and expert evaluation with a VAL syntax check | `check.ts` checks cross-stage consistency and `planner.ts` searches for a plan |

A schema-valid result can still produce an incorrect domain. In reproducing the
pipeline, a generated problem omitted objects needed by its actions; after
those objects were added, a plan reused one issue's pull request and approval
for another issue. These failures motivated the planner and semantic checks.
The paper includes numeric fluents; this project currently supports a smaller
fragment (see [Limits](#limits)). See [related research](docs/RELATED-RESEARCH.md)
for other work on planning-domain generation and temporal PDDL.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, local checks,
continuous integration, and branch protection.

## License

AGPL-3.0-only. This code started in
[getlarge/themoltnet](https://github.com/getlarge/themoltnet) (`libs/pddl-designer`, PR #2726).
