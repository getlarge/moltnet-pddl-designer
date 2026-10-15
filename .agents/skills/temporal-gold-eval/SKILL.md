---
name: temporal-gold-eval
description: Use the repository's versioned gold cases to evaluate temporal statement detection or timed PDDL extraction across saved model runs.
---

# Temporal gold evaluation

Read `evals/README.md` and the selected versioned case file before preparing an
evaluation. Keep case IDs, gold labels, and source provenance stable during a
comparison; make deliberate annotation revisions in a new dataset version.

Export model-facing inputs with `pnpm eval:temporal:inputs`. Adapt the model or
classifier output into the normalized prediction rows used by `pnpm
eval:temporal`. Supply exactly one row per case and run. Treat `dev` cases as
visible examples and `holdout` cases as scoring data only; never place holdout
gold in a runtime prompt or retrieval corpus.

Report detection confusion counts, duration accuracy, timed-condition and
timed-effect accuracy, full-case exact matches, sample size, model/profile,
prompt revision, and latency. Inspect failed cases before changing prompts or
gold. A parseable PDDL action or valid plan does not establish source fidelity.

For existing plan-level evaluations, use `scripts/score-runs.ts` and the
pre-registered `examples/*/required.json` rules. Do not mix plan-pass rates
with temporal extraction accuracy.
