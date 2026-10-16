# Temporal detection baseline: 2026-10-15

The four saved [run reports](baselines/) use `detection-v2.json`, the
`temporal-detection-v2` question, and a fixed 0.5 threshold. Each profile was
run twice through MoltNet with a fresh correlation ID. The model saw only each
case's `input`, not its label or provenance.

| Profile                                | Model              | Correct across two runs | Decision flips | Mean wall time per case |
| -------------------------------------- | ------------------ | ----------------------: | -------------: | ----------------------: |
| `legreffier-pddl-classifier-v1`        | `jev-latest`       |                   64/64 |              0 |                  6.50 s |
| `legreffier-pddl-classifier-ollama-v1` | `nimble:9b-q4_k_m` |                   64/64 |              0 |                  8.34 s |

Both profiles got 16/16 development and 16/16 holdout cases correct in each
run. The largest cross-run probability change was 0.01 for Jev and zero for
Nimble. The elapsed times include task dispatch and were measured while runs
overlapped, so they are indicative rather than a controlled speed comparison.

These results do not distinguish general classifier accuracy. The benchmark
contains eight action families, two related source paraphrases per family,
and project-authored negative controls. It also tests detection alone; no
duration values or timed clauses were scored here. Keep the classifier out of
the production workflow until independent domains and a larger extraction
gold set have been evaluated.

Recompute repeat scores with:

```bash
pnpm eval:temporal:detect:score evals/temporal/detection-v2.json \
  /tmp/jev-comparison.json \
  evals/temporal/baselines/2026-10-15-jev-1.json \
  evals/temporal/baselines/2026-10-15-jev-2.json
```
