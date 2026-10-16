# Temporal loading pilot

The description and situation in this directory exercise numeric-duration
PDDL 2.1 generation.

To inspect these inputs in the local wizard, open its URL with
`?example=temporal-loading` (for example,
`http://127.0.0.1:4317/?example=temporal-loading`). The wizard fills both input
fields and model names and enables temporal extraction. Start the server with
`--classify-profile NAME` (or `PDDL_CLASSIFY_PROFILE=NAME`) to prefill the
classification profile. Set `PDDL_VAL_PATH` on the worker to validate a
one-step timed schedule with VAL; without it, the schedule is marked a
candidate. Saved proofs retain the timed model; reopening one rechecks its
structure and marks the schedule as a candidate until VAL is run again.

Configure generation and classification workers for the same MoltNet team. The
same example can also be run through the CLI:

```bash
pnpm --silent cli \
  --description examples/temporal-loading/description.md \
  --problem examples/temporal-loading/situation.md \
  --domain-name temporal-loading --problem-name load-one \
  --team "$TEAM" --diary "$DIARY" \
  --profile legreffier-pddl-designer-v1 \
  --classify-profile legreffier-pddl-classifier-v1 \
  --temporal --val /path/to/VAL/build/bin/Validate \
  --out /tmp/temporal-loading-run.json
```

`--val` is optional. It checks the generated domain, problem, and one-step
timed schedule with [VAL](https://github.com/KCL-Planning/VAL). Without VAL,
the schedule is marked `candidate`; with a passing check it is `validated`.
The CLI output is a normal run: the classical plan remains under `plan`, while
the timed model and schedule are under `temporal`. The classical plan must not
be read as a temporal plan. For multiple steps, the pilot emits the timed
domain and problem but does not invent a schedule.

The run reports each classifier probability, the extracted durative actions,
and `temporal.defaultedClauses`. These defaults preserve facts from the classical draft
that the temporal extractor did not time explicitly: preconditions use `at
start`, effects use `at end`. Review them against the description before using
the model in another situation. If temporal extraction or VAL fails, `--out`
contains the classical run and an error for inspection.
