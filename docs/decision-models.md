# Decision models in the designer

A decision model receives evidence and a defined question, then returns a typed
judgment. It does not discover the entire process, prove the PDDL correct, or
write a repair. Code validates structure and searches plans; the generation model
writes model changes; the expert reviews their meaning.

## What the current implementation sends

The wizard's optional warning assessment uses the same path as `--warning-review`.
[`workflow.ts`](../src/workflow.ts) constructs this context from the accepted
Actions result, including reviewer edits, and [`decision.ts`](../src/decision.ts)
wraps it in the MoltNet task input:

```ts
const input = {
  version: 1,
  state: {
    process: originalDescription, // Complete Markdown source, not a summary.
    domain: {
      name: domainName,
      types: acceptedTypes,
      predicates: acceptedPredicates,
      actions: acceptedActions,
    },
    warning: issue, // severity, path, code, message from a local static check.
  },
  questions: {
    answer: {
      type: 'bool',
      instructions: warningQuestion(issue).instructions,
      criteria: warningQuestion(issue).criteria,
    },
  },
};
```

The domain fields are JSON arrays. A predicate defines its name, typed parameters,
and description. An action defines its name, parameters, preconditions,
`addEffects`, `deleteEffects`, and optional source notes/references. An atom such
as `certified(?s)` is `{ predicate: 'certified', args: ['?s'] }`; preconditions
also carry `negated`. This request does not contain the starting situation or a
computed plan. The complete question text and criteria live in
[`warning-review.ts`](../src/warning-review.ts).

MoltNet's provider-neutral format is `bool` / `probability`. TypeSafe's native
API calls the equivalent yes/no primitive `noul` and its returned value `noul`.
Do not copy the MoltNet payload directly into the TypeSafe endpoint.

## One concrete question and its expected answer

- Source: certification is permanent; processing never consumes or invalidates it.
- Draft: `certify-station` adds `certified`; no action deletes it.
- Local warning: `no action deletes certified: once added it stays true`.
- Judgment: does the source establish that this permanent fact is a defect?
- Expected answer: no. Deleting certification would contradict the source.
- Recorded live return, certification repetition 1: probability `0.04`.
- Code action: dismiss this warning; send no targeted repair feedback.

The normalized MoltNet answer has this shape:

```json
{
  "answers": {
    "answer": { "probability": 0.04, "type": "bool" }
  },
  "version": 1
}
```

This is a probability of the particular defect proposition, not a score of model
quality or the probability that the whole workflow is correct. The explanation
above comes from reading the source; the classifier returned no written rationale.
The default 0.9 repair threshold is application policy, not a validated universal
cutoff. Intermediate probabilities are recorded without targeted repair.

## What the completed experiment establishes

The original exploratory matrix ran four examples, three modes, three repetitions:
36 complete generations, not 36 classification calls. Early review asked 18
questions: all concerned benign warnings; 15 were dismissed, three uncertain,
and none confirmed. Final review asked zero questions because no actions were
skippable. A separate smoke test asked two early-review questions.

This exercised execution and benign-warning handling. It did not test live
positive-defect detection, classifier-directed repair, or establish quality gains.
These results belong to the original implementation at `48cfc21`, before the
wizard integration. The wizard is verified locally with synthetic task responses;
no new live model experiment was run for it.

## Better questions to investigate next

The [citation-check cookbook](https://docs.typesafe.ai/cookbooks/citation_check)
checks source text against one specific claim and distinguishes support,
contradiction, and silence. Its useful lesson here is to make the comparison
explicit rather than ask for a broad judgment about correctness.

For permanent facts, code already knows no action deletes the fact. A narrower
semantic question could be: "Does `process` require this certification to expire,
be consumed, or be reset?" Supply the original description and the relevant
predicate definition. Code can combine that answer with its known lifetime check.

For independent parameters, code already knows the prerequisites do not link
certain participants. A narrower question could be: "Does `process` require a
particular worker to be assigned to the ticket before `claim-ticket`?" Supply
that action and its participant roles. Do not confuse a relationship an action
creates with one it must require beforehand.

These are proposals, not implemented or benchmarked replacements. They should
first be tested on fixed correct/broken model pairs: missing ownership on
`finish-ticket`, missing inspection consumption, unrestricted shared workers,
and permanent certification. Establish expected answers before calling a model.
Evaluate the resulting repair behavior as well as the answer.

The [extraction-cascade cookbook](https://docs.typesafe.ai/cookbooks/sde_cascade)
provides a related pattern: verify individual extracted fields and escalate only
when a specific signal fires. The [fan-out pattern](https://docs.typesafe.ai/patterns/fan-out)
shows how independent questions sharing context can be submitted together. The
current warning client still submits one task per warning; batching is future
work and should preserve a separate answer and audit record for each warning.

## Learning resources

Read the official sources in this order:

1. [State](https://docs.typesafe.ai/concepts/state): what context looks like and how to structure it.
2. [Noul](https://docs.typesafe.ai/primitives/noul): questions, criteria, probabilities, and thresholds.
3. [Known limitations of Jev 1.13](https://docs.typesafe.ai/model-jaggedness/jev-1.13): literal reading, indirection, irrelevant context, and other version-specific limits.
4. [Agent skill](https://docs.typesafe.ai/agent-skill): guidance for coding agents and links to its source.

Typed output makes an interface predictable; it does not make the judgment true.
Use representative labeled cases to evaluate the question and thresholds for this
application. Keep the expert's source authoritative, and preserve uncertainty.
