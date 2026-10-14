# Test source grounding before changing the wizard

This pilot asks whether a generated action field agrees with the expert's source.
It uses fixed model fragments rather than paid generation tasks. The request
builder turns actual preconditions/effects into claims; a caller cannot provide
an unrelated, reassuring claim. The decision model selects `supported`,
`contradicted`, or `not_established` and returns its distribution and confidence.
There is no automatic repair or acceptance threshold in this pilot.

## What is being tested

The eight cases in `examples/source-grounding-pilot/cases.json` vary one field:

| Cases | Source rule                                                                    | Candidate fields                             | Expected results                  |
| ----- | ------------------------------------------------------------------------------ | -------------------------------------------- | --------------------------------- |
| 01–02 | Only the worker who claimed a ticket may finish it.                            | Ownership precondition present / absent      | supported / contradicted          |
| 03–04 | Each processing operation consumes its fresh inspection.                       | Inspection delete effect present / absent    | supported / contradicted          |
| 05–06 | Certification is permanent and processing never invalidates it.                | Certification delete effect present / absent | contradicted / supported          |
| 07–08 | Workers process tickets; finishing marks a ticket done. Ownership is unstated. | Ownership precondition present / absent      | not_established / not_established |

Expectations and human-written reasons live separately in `gold.json`. Neither
is sent to the classifier. The two members of each pair are separate requests,
so the classifier cannot solve the task just by comparing a correct and broken
candidate in the same state. One attempt per request gives eight classify tasks
and zero generation tasks. Always choosing supported or contradicted scores only
3/8; always choosing not_established scores 2/8.

These are controlled action fragments, not complete process models. Other action
fields are intentionally minimal to isolate the selected prerequisite or effect.
The pilot checks direct, exact-typed encodings: it does not resolve equivalent
indirect encodings, infer omitted targets, evaluate complete process coverage,
prove reachability, or demonstrate repair quality.

## Preview every request locally

From the repository root:

```bash
node --import tsx scripts/eval/source-grounding.ts \
  --out /tmp/grounding-requests.json
```

This is the default mode. It does not initialize credentials or make API calls.
Inspect the output before running anything live. Each request contains:

- `state.source`: the original process text.
- `state.claims`: a statement rendered from the actual candidate field, its
  presence/absence, target atom, predicate definition, and participant types.
- `questions`: a fixed Choice question referencing that claim, with explicit
  criteria distinguishing support, contradiction, and missing evidence.

For example, removing an ownership prerequisite changes the rendered claim to:
`finish-ticket does not require the fact claimed-by(?t, ?w) to be true as an explicit prerequisite.`
It cannot leave an older claim that ownership is still checked.

The preview includes a content hash and the task count. Live mode requires an
unchanged eight-request manifest and one question per request. The builder also
supports batching multiple different targets for one model, although this pilot
keeps the cases separate for inspection.

## Run the bounded live pilot

Use an existing classification profile in your team, such as the configured
`legreffier-pddl-classifier-v1` from [Runtime profiles](../README.md#choose-a-classification-profile).
Create a fresh correlation ID, and use the same ID in both terminals:

```bash
# Set CORRELATION to a fresh UUID, and TEAM, DIARY, AGENT, CLASSIFY_PROFILE.
# Terminal 1: leave this worker running while the pilot executes.
moltnet-agent poll --team "$TEAM" --agent "$AGENT" \
  --profile "$CLASSIFY_PROFILE" --task-types classify \
  --correlation-id "$CORRELATION" --diary-ids "$DIARY" \
  --general --workspace-strategy none
```

```bash
# Terminal 2: this creates paid tasks and sends the preview payloads to
# MoltNet and the classification provider selected by CLASSIFY_PROFILE.
node --import tsx scripts/eval/source-grounding.ts --mode run \
  --requests /tmp/grounding-requests.json --out /tmp/grounding-results.json \
  --team "$TEAM" --diary "$DIARY" --profile "$CLASSIFY_PROFILE" \
  --correlation "$CORRELATION"
```

Stop the worker with Ctrl-C after the runner exits. The runner creates at most
eight tasks, with one attempt each. It stops on the first technical failure;
there are no generation calls, automatic retries, or full-design comparisons.
Every completed case is saved immediately with its exact input, normalized raw
output, task ID, elapsed time, and reported usage. A failed case is retained too;
remaining cases are not run. Task expiration bounds abandoned queued work.

## Compare answers with the expectations

After the live run:

```bash
node --import tsx scripts/eval/source-grounding.ts --mode report \
  --results /tmp/grounding-results.json --out /tmp/grounding-report.json
```

Reporting is local. It verifies the request hash and recorded inputs, reparses
raw outputs, and compares each returned choice with the separate gold labels.
It includes missing/failed cases, all distributions, and the trivial baselines.
The expected reasons are human interpretations, not explanations returned by Jev.
Confidence is a statistic of the Choice distribution, not the probability that
the full PDDL model is correct. No 90% automatic-action rule is applied here.

Inspect disagreements first. Missing source evidence, a misleading claim, a
classifier error, and an infrastructure failure require different fixes. Do not
rewrite questions against these same eight answers and call the improvement a
held-out result. If the pattern is useful, freeze a larger unseen set and only
then consider stage-gate integration in the wizard.

## Why this shape

The [TypeSafe citation-check cookbook](https://docs.typesafe.ai/cookbooks/citation_check)
compares one claim with source evidence and distinguishes support, contradiction,
and silence. The [extraction-cascade cookbook](https://docs.typesafe.ai/cookbooks/sde_cascade)
verifies specific extracted fields before escalating. This pilot applies those
patterns to a PDDL action's explicit prerequisites and effects.

It deliberately starts with fixed criteria and claims built in code. It does not
yet test an LLM that writes arbitrary classification questions. That extension
should be evaluated separately once this simpler source-grounding mechanism has
useful evidence.

## Initial live observation — 2026-10-14

The frozen eight-case pilot matched all eight expected choices: three supported,
three contradicted, two not established. It used `jev-latest` on Typesafe through
an existing classification profile (revision 1). The provider usage also reports
that alias; the underlying model version was not pinned/resolved in this record.
There were eight classify tasks, zero generation tasks, no retries, and no
technical failures. Reported usage was 5,796 input and 393 output tokens; billed
currency cost was not recorded.

| Case | Expected and returned choice | Probability of that choice | Choice confidence |
| ---- | ---------------------------- | -------------------------- | ----------------- |
| 01   | supported                    | 1.00                       | 1.00              |
| 02   | contradicted                 | 1.00                       | 1.00              |
| 03   | supported                    | 0.99                       | 0.98              |
| 04   | contradicted                 | 0.96                       | 0.94              |
| 05   | contradicted                 | 1.00                       | 1.00              |
| 06   | supported                    | 1.00                       | 1.00              |
| 07   | not_established              | 0.99                       | 0.98              |
| 08   | not_established              | 0.80                       | 0.70              |

[Recorded distributions and task IDs](../examples/source-grounding-pilot/observed-20261014.json)
include all options, the frozen request hash, and end-to-end case durations.
The three deliberate contradictions were detected, unlike the earlier benign-only
warning experiment. Both unstated-rule cases were distinguished from supported
or contradicted claims. This supports trying the mechanism further; eight simple
cases with one attempt each do not establish production accuracy, confidence
calibration, complete source coverage, or automatic repair quality. The prompts
were not revised after observing the returns. No further live runs were started.
