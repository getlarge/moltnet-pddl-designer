# Evaluation cases

`packages/evals` contains pure scorers. This directory contains versioned gold
cases. `scripts/score-runs.ts` remains the CLI for plan requirements and now
imports its scorer from the shared package. `pnpm eval:temporal` scores saved
temporal predictions; it does not call MoltNet or a model.

Each temporal case has a stable ID, `dev` or `holdout` split, input description,
canonical predicate vocabulary, gold duration in seconds, and timed conditions
and effects. Its provenance names a public source and states whether the
project curated the annotation. A paper's example is not automatically a gold
label. Do not include local book paths or unpublished source files in fixtures.

Run the cases through a MoltNet generation profile and score actual
predictions in one command. The script starts a scoped local worker and writes
its log beside the predictions. Supply the team and repository diary IDs from
your local setup:

```bash
TEAM=<team-id> DIARY=<diary-id> pnpm eval:temporal:live \
  evals/temporal/v1.json /tmp/temporal-predictions.jsonl /tmp/temporal-report.json
```

Set `PROFILE=<generation-profile>` to compare another model. Each run gets a
fresh correlation ID, also used as the prediction `runId`. The prompt receives
only the case input; gold labels and provenance are never sent to the model.
The runner saves profile, model, prompt revision, task IDs, and per-case wall
time in `<predictions.jsonl>.meta.json`. A failed run leaves partial predictions,
metadata, and the worker log for diagnosis.

To test only whether temporal evidence is present, run a `classify` profile on
the [32-case detection benchmark](temporal/SOURCES.md). Its eight action families
are split between development and holdout, and each has two source descriptions
and two project-authored negative controls. This records each probability, a
0.5 threshold decision, elapsed wall time, and the label for inspection:

```bash
TEAM=<team-id> DIARY=<diary-id> CLASSIFY_PROFILE=legreffier-pddl-classifier-v1 \
  pnpm eval:temporal:detect evals/temporal/detection-v2.json /tmp/temporal-detection.json
```

The first two-run [baseline](temporal/BASELINE.md) and raw reports are saved
with the cases for later comparisons.

The TypeSafe profile needs a configured provider key. A local Ollama option is
documented in [Setup](../docs/SETUP.md#classification-profiles). Detection
scores do not measure duration or timed-clause extraction. The report includes
confusion counts, accuracy, balanced accuracy, a Brier score, and breakdowns
by split, family, and phenomenon. Repeat runs with a fresh correlation ID to
inspect consistency. Probabilities from different models are not
interchangeable without calibration on labeled cases. These 32 cases do not
establish general accuracy: they span eight source action families, and the
negatives were written by this project.

To compare repeat runs, give each run a separate report path, then score them
together. The scorer checks that every run includes every case and reports
decision flips and probability ranges:

```bash
pnpm eval:temporal:detect:score evals/temporal/detection-v2.json \
  /tmp/detection-comparison.json /tmp/jev-run-1.json /tmp/jev-run-2.json
```

For an external model or classifier, export inputs without gold labels and a
blank predictions template:

```bash
pnpm eval:temporal:inputs evals/temporal/v1.json /tmp/temporal-inputs.jsonl /tmp/predictions.jsonl
```

The command prints the paths it wrote and will not overwrite an existing
predictions file. The template has `null` detection answers; replace them with
actual outputs and fill in duration and timed clauses.
This export step does not call a model.

For an offline run, provide one JSONL prediction per case. Give every prediction
the same `runId`; use a new `runId` for each repeat. Each row needs `id`,
`runId`, `hasDurativeEvidence`, `durationSeconds` (or `null`), `conditions`, and
`effects`. For example:

```json
{
  "id": "synthetic-order-only",
  "runId": "profile-a-1",
  "hasDurativeEvidence": false,
  "durationSeconds": null,
  "conditions": [],
  "effects": []
}
```

```bash
pnpm eval:temporal evals/temporal/v1.json /tmp/predictions.jsonl /tmp/report.json
```

The extraction scorer reports detection confusion counts, duration and timed-clause exact
matches, and full-case exact matches. Clause order is ignored; atom identity,
polarity, and timing must match. Record model, runtime profile, prompt revision,
description revision, and latency alongside each run artifact before comparing
profiles. Keep holdout cases out of examples and retrieval prompts. The `v1`
extraction suite is a small smoke benchmark, not a population estimate of model
quality. `detection-v2` only measures the initial binary classifier gate.

The [QuMuLab source pairs](temporal/qumulab-pairs.json) preserve all 40 prose
variants and their paired reference action fields from the pinned public
dataset. They are useful for selecting extraction cases; they are not scored as
gold because a paragraph may omit or contradict a reference clause. To rebuild
them from the pinned `Data/actions.xml` file, run
`pnpm eval:temporal:import-qumulab <downloaded-actions.xml> evals/temporal/qumulab-pairs.json`.
Despite its `.xml` name, the upstream file is a Python pickle. The importer
accepts only the primitive opcodes in the pinned source.
