# Temporal loading pilot

The description and situation in this directory exercise numeric-duration
PDDL 2.1 generation. Configure a generation worker and a classification worker
for the same MoltNet team, then run:

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
The built-in classical plan is kept under `baseRun` as modeling evidence. It
must not be read as a temporal plan. For multiple steps, the pilot emits the
timed domain and problem but does not invent a schedule.

The run reports each classifier probability, the extracted durative actions,
and `defaultedClauses`. These defaults preserve facts from the classical draft
that the temporal extractor did not time explicitly: preconditions use `at
start`, effects use `at end`. Review them against the description before using
the model in another situation. If temporal extraction or VAL fails, `--out`
contains the classical run and an error for inspection.
