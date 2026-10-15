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

To test only whether temporal evidence is present, run a `classify` profile.
This records each probability, a 0.5 threshold decision, elapsed wall time, and
the label for inspection:

```bash
TEAM=<team-id> DIARY=<diary-id> CLASSIFY_PROFILE=legreffier-pddl-classifier-v1 \
  pnpm eval:temporal:detect evals/temporal/v1.json /tmp/temporal-detection.json
```

The TypeSafe profile needs a configured provider key. A local Ollama option is
documented in [Setup](../docs/SETUP.md#classification-profiles). Detection
scores do not measure duration or timed-clause extraction. Probabilities from
different models are not interchangeable without calibration on labeled cases.

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

The scorer reports detection confusion counts, duration and timed-clause exact
matches, and full-case exact matches. Clause order is ignored; atom identity,
polarity, and timing must match. Record model, runtime profile, prompt revision,
description revision, and latency alongside each run artifact before comparing
profiles. Keep holdout cases out of examples and retrieval prompts. The current
suite is a small smoke benchmark, not a population estimate of model quality.
