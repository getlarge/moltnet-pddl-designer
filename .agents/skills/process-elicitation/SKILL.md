---
name: process-elicitation
description: Interview a process expert about real experiences and turn their stories into source-grounded process descriptions, concrete situations, and behavioral tests for MoltNet PDDL Designer. Use when someone wants to discover, describe, or refine a process without knowing PDDL.
---

# Process elicitation

Help an expert articulate a process they know from experience. Do not require them to already know the steps, write formal rules, or use planning terminology.

## Source of truth

Read [WRITING-DESCRIPTIONS.md](references/WRITING-DESCRIPTIONS.md) before interviewing or producing final drafts. Its guidance is grounded in actual failed model runs and takes precedence over generic process-writing habits. Check the repository's supported PDDL fragment in [README.md](../../../README.md) before promising something can be modeled.

Treat the conversation as **elicitation**, not automatic conversion from a story to verified requirements. The expert must confirm inferred rules.

Keep restricted source documents, quotes, diagrams, and process-specific drafts in an approved private location. A public skill may describe reusable questions and modeling lessons, but anonymized object names alone do not make a distinctive workflow safe to publish.

## Interview protocol

1. **Invite a concrete account.** Ask for an incident, an ordinary routine, an exception, or a decision. "What happened?" is a better opening than "Describe your workflow." Let the expert ramble, dictate, skip chronology, or change course.
2. **Reconstruct the particular case first.** Track participants, items, initial conditions, what was done, resulting changes, decisions, blockers, and what counted as success. Do not prematurely convert everything into a general rule.
3. **Ask one discriminating question at a time.** Prioritize the missing answer that would change the possible actions, their ordering, their effects, or whether a goal can be reached. Follow the expert's answer rather than marching through a checklist. Avoid introducing the PDDL vocabulary in questions.
4. **Contrast actual events with possible alternatives.** Ask what would happen if the step were skipped, done twice, done by someone else, done in the wrong order, or failed. Distinguish the normal path from exceptions and from _forbidden_ behavior.
5. **Generalize cautiously.** Propose candidate rules, clearly distinguished from verbatim evidence. Ask the expert to correct them. Never treat plausible industry practice as a fact about this process.
6. **Run the completeness audit.** Use the concrete failure modes in `references/WRITING-DESCRIPTIONS.md` to detect gaps (see below). Probe only where a missing answer actually matters. Explain the motivating modeling risk in plain language when helpful.
7. **Draft and review.** Separate domain-wide rules from a concrete situation, show assumptions and unresolved questions, and request confirmation before marking a draft expert-approved. Iterate from corrections without discarding the original account.

A helpful turn may contain a brief reflection of what was learned and **one** next question. Do not batch an interview into a form or demand every detail at once.

## Completeness audit derived from WRITING-DESCRIPTIONS.md

Check silently first, then ask only about consequential gaps:

- **Actor and responsibility:** Who performs each step? Agent, person, or trusted code?
- **Preconditions and effects:** What must already hold? What becomes true, false, consumed, or available again?
- **Resource availability:** When can a busy actor act again? Can a resource be reused? Is capacity constrained?
- **Finite objects:** Do created-looking items come from prepared slots or a fixed initial set? Never silently assume the planner can create objects.
- **Ownership and identity:** Which work product belongs to which item or agent? Can two cases accidentally share a resource or approval?
- **Causal completion:** Does a step count as completed only after the underlying work actually happened?
- **Invalidation:** What becomes stale or resets after a subsequent step, revision, or iteration?
- **Joins and alternatives:** Are all required branches fixed and explicit? If someone says "every item", establish a fixed small count or flag that the current fragment cannot express a variable universal condition.
- **Ordering:** If one account or diagram shows A before B, ask whether that order is required, merely possible, or caused by that case's circumstances. Check when a one-time approval can occur relative to partially completed work.
- **Conditions:** Convert meaningful decisions into observable facts; preserve judgment-dependent or unknown conditions as open questions, not invented booleans.
- **Timing when it matters:** Does the account give a measured or required duration for a step? What must be true when it starts, remain true while it runs, or become true or false when it ends? When are people and equipment released? Ask whether overlap with another step is allowed only if it changes the process. Keep ordering alone, elapsed timestamps, and words such as "quickly" distinct from a stated action duration.
- **Scope:** Avoid budgets, infrastructure timeouts, tool brands, and implementation details that do not change process behavior. Flag unsupported requirements rather than quietly approximating them; see the temporal pilot limits below.

For the **situation**, ask which exact objects and agents exist, which are initially free/available, the initial facts for branches, and observable goal facts.

## Working evidence ledger

Internally maintain (and show on request) concise entries:

| Element                    | Source                            | Status                        |
| -------------------------- | --------------------------------- | ----------------------------- |
| Observed event             | The expert's account              | Stated                        |
| Candidate generalized rule | Supporting quote or turn          | Inferred — needs confirmation |
| Constraint / exception     | Expert confirmation               | Confirmed                     |
| Gap                        | Missing or conflicting statements | Open question                 |

Do not invent citations or claim a derived rule was directly spoken. If several accounts conflict, surface the conflict instead of silently reconciling it.

## Outputs

When enough information has been elicited, offer these **separate** artifacts:

1. **Process description** (`description.md`): General types of participants and items, actions and who performs them, necessary conditions, added/removed facts, resource release and ownership, branches and resets. When supported by the account, state a positive numeric duration and distinguish conditions at the start, throughout, and at the end from effects at the start or end. Never include case-specific names. Use clear, literal language suitable for the designer.
2. **Concrete situation** (`situation.md`): Named objects and agents, available slots/resources, initial conditions, and observable goal. Do not repeat the rules here.
3. **Review notes** (`elicitation-notes.md`): Source-to-rule trace, confirmed vs inferred rules, gaps, unsupported constructs, and disagreements. These notes are for people; do not silently feed assumptions into the model.
4. **Behavioral tests** (`scenarios.md`): At least one permitted sequence and one plausible but disallowed shortcut, with why the expert expects each outcome. Include exception cases when available. For timed work, capture any meaningful early release or forbidden overlap as an expert expectation. These are hypotheses until validated.

Do not mark a description "complete" merely because the designer parses it or produces a plan. The plan may exploit a missing rule. Review the actual action order for early approvals, reused resources, premature completion, and other shortcuts; revisit the interview if necessary.

## Working with the modeller

Once the expert has reviewed the two input texts, point to the existing CLI and wizard instructions in `README.md`. Feed only `description.md` and `situation.md` as the core domain/problem inputs. Preserve the original story and evidence separately. In the wizard, expert corrections should become traceable stage edits; when revision tracking is available, retain source revisions and run settings separately so an experiment can attribute improvements accurately.

Test several situations against the same action rules: a normal case, a missing prerequisite, an exception, and an unavailable dependency when those conditions matter. Ask the expert whether each resulting plan or failure is credible. A successful normal plan establishes reachability in the draft model, not fidelity to the real process.

For a process with explicit timing, use the optional temporal pass described in `README.md` and [the temporal-loading example](../../../examples/temporal-loading/README.md). It first builds a classical model, then classifies each action for timing evidence and extracts numeric-duration PDDL 2.1 actions where possible. Review the reported `defaultedClauses`: untimed classical preconditions default to the start and effects to the end, which may differ from the expert's account. A missing usable numeric duration leaves that action classical. VAL can validate a one-step timed schedule; a multi-step classical plan is not a validated temporal schedule. Preserve timing gaps and untested overlap expectations in the review notes.

## Interview opening

Ask one question, then wait for the account:

> Tell me about one time something had to get done — especially a case that was surprising, difficult, or went wrong. What happened?

If the expert already supplied a story, skip the opening and ask the highest-value unanswered question.
