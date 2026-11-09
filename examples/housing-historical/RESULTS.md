# Historical housing PDDL baseline result

The unchanged 15 September description produced a structurally valid but semantically inadequate model. The planner found only `(derive-building-program sys-1 bp-1)`. It satisfies the generated goal `used-up(bp-1)`, not the requested reviewed design ready for handoff.

## Recorded outcome

- Profile: legreffier-pddl-designer-v1, revision 2, Ollama Cloud gpt-oss:120b; signed Agent 0.74.4; Designer ddc4d39.
- Six model tasks: types, predicates, actions, one structural action correction, refinement, problem. Workflow duration 117318 ms. Optional semantic plan review disabled.
- First action draft: 17 errors and 23 warnings. Correction passed with 29 warnings; refinement retained 28 warnings. No human repair was applied.
- Eleven action names cover the historical task list, but eight actions have no effects: solving, plan validation, elements, IFC export, IFC validation, presentation staging, rendering and human review.
- Only three predicates were generated: free(project-requirements), in-use(planning-constraints), used-up(building-program). All have empty sourceLines. The programme action has no preconditions and can satisfy the invented goal immediately.
- Independent validatePlan replay accepts the programme-only plan. Empty and human-review-only plans fail the generated goal. This verifies model execution, not fidelity to the historical text.

## Findings separated by cause

**Explicit-source/situation mismatch:** the situation asks for a reviewed design ready for Archicad handoff. Replacing this with a consumed programme is unsupported. The description explicitly includes human selection/rejection, rendering and IFC validation; these do not contribute to the generated goal. Coverage by action name conceals this failure.

**Original-description ambiguity:** the task list does not spell out every prerequisite, artifact lifecycle, iteration reset or resource pool. These are legitimate gaps to annotate, not permission to silently add today's rules. The synthetic situation also leaves staffing/resource details sparse. Keep it as part of this baseline.

**Later requirements:** the current implementation makes extraction verification, scoped qualification and revision-bound provisional-model review explicit. Do not score every later mechanism as a violation of September's text. Current executable coverage and the full intended process remain different; approval/resume and other target capabilities are still incomplete according to the coverage register.

**Tool limitation:** structural checks allow warnings and actions without effects. The generated goal is reachable, so the planner correctly solves the wrong abstraction. This single run does not identify whether revised source wording, a different modelling prompt, or a different model would improve it.

## Integrity and launch record

Both task input strings match the frozen files after the existing CLI's whitespace trimming. Raw and effective hashes are in manifest.json. run.json, all six stage results, PDDL texts, profile snapshot and validation.json are preserved in the checked-in baseline directory; the original local run archive remains unchanged.

An initial launch failed before task creation due to moltnet start changing cwd. Absolute paths fixed launch. During the successful model run, editing the launcher while its shell was waiting caused a shell-tail failure (exit 127) and damaged progress.log after the CLI had saved run.json. Do not use that shell exit/log as the model outcome. The model artifact and worker task-completion log are intact; no generation rerun or result replacement occurred. The final runner passes shell syntax validation and stub-based smoke checks for successful completion/worker cleanup, existing-output rejection and relative-output rejection. Avoid editing a running script.

## Next discussion

These failures can seed annotation questions: does the goal express the requested outcome; which source statement supports each prerequisite/effect; and can the model complete without human review? Keep these as agent-authored observations until reviewed. The housing inventory is ready for choosing actual examples and a rubric; no new experience-delivery convention or dataset-effect claim is made.

Result directory: examples/housing-historical/baseline (PDDL Designer repository)
