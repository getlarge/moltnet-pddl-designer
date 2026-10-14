import type { StageName } from '../src/stages.js';
import type { DesignRun, StageRecord } from '../src/workflow.js';
import type { RunSnapshot } from '../server/types.js';
import type { ActionDef, Atom, Literal, PredicateDef } from '../src/ir.js';
export const stages = [
  'types',
  'predicates',
  'actions',
  'refine',
  'problem',
  'plan',
] as const;
export type ViewStage = (typeof stages)[number];
export const labels: Record<ViewStage, string> = {
  types: 'Types',
  predicates: 'Facts',
  actions: 'Actions',
  refine: 'Refinement',
  problem: 'Situation',
  plan: 'Plan',
};
export const explain: Record<ViewStage, string> = {
  types: 'The kinds of things in your process.',
  predicates: 'What can be true or false about those things.',
  actions: 'What must be true before a step, and what changes after it.',
  refine: 'Check that the actions still say what you mean.',
  problem: 'The objects, starting facts, and goal for this situation.',
  plan: 'Try the steps. Watch the facts change.',
};
/** Plain-language reading instructions shared by every stage view. */
export const readingGuide: Record<ViewStage, readonly string[]> = {
  types: [
    'Types are categories, such as a block or a robotic arm, not individual objects. A subtype is a more specific kind of its parent. You will name the actual objects in Situation.',
    'Check that every kind of participant or resource your process needs is represented. Facts and actions will use these types to say what can take part. Select a type to see its source lines.',
  ],
  predicates: [
    'These are fact templates. Each can be true or false for particular participants; the Situation step decides which are true at the start.',
    'Check the meaning and who takes part. Numbered participants distinguish roles of the same type, not specific objects. Select a fact to see its source lines.',
  ],
  actions: [
    'Actions are reusable step templates. Their parameters, such as ?b, stand for objects of the listed types. The planner later chooses concrete objects for each step.',
    'Before lists what must hold for a step to run. Add makes facts true; Remove makes them false. Everything else stays unchanged. Check prerequisites and what must stop being true, especially when a resource is used or released.',
    'Select an action to see its source lines. Refinement will check how these actions work together.',
  ],
  refine: [
    'This is the revised action model after checking how the steps work together. It replaces the draft from Actions when the planner runs.',
    'Read “What changed in refinement,” then check the revised prerequisites and effects against your process. A correction should fix the model without dropping a required step or inventing a new rule. Select an action to see its source lines.',
  ],
  problem: [
    'A situation gives the model concrete objects, starting facts, and a goal. Types, facts, and actions describe the general process; this stage describes one case to solve.',
    'Check that every needed object is listed with the right type. Starting facts are true initially; facts not listed are treated as false. Every goal condition must hold at the end, including any condition marked “not.”',
    'The planner can change facts through actions, but cannot create new objects. Include any resources or items the process will need.',
  ],
  plan: [
    'A plan is a sequence of concrete actions that reaches the goal under this model. Finding one checks the model’s logic; it does not prove the model captures everything in your real process.',
    'Step through and watch which facts are added or removed and which goal conditions are met. You can try another available action, undo a step, or reset to the starting situation. This is a simulation; it does not perform the real work.',
    'If the planner finds no plan, revisit the model and situation. A search-limit result means the search stopped before it could decide, not that the goal is impossible.',
  ],
};
export async function api<T>(path: string, data?: unknown): Promise<T> {
  const response = await fetch(
    `/api/${path}`,
    data === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
  );
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error ?? 'The request failed. Try again.');
  return value as T;
}
export function records(
  snapshot?: RunSnapshot,
  run?: DesignRun,
): StageRecord[] {
  return (
    run?.stages ??
    snapshot?.events.flatMap(({ event }) =>
      event.type === 'stage-result' ? [event.record] : [],
    ) ??
    []
  );
}
export function fact(atom: Atom | Literal) {
  return `${'negated' in atom && atom.negated ? 'not ' : ''}${atom.predicate.replaceAll('-', ' ')}${atom.args.length ? ` (${atom.args.join(', ')})` : ''}`;
}
/** Render positional bindings using the declared parameter types, without guessing roles. */
export function actionLabel(label: string, definitions: ActionDef[]): string {
  return bindingLabel(label, definitions);
}
export function factLabel(label: string, definitions: PredicateDef[]): string {
  return bindingLabel(label, definitions);
}
function bindingLabel(
  label: string,
  definitions: Pick<PredicateDef, 'name' | 'parameters'>[],
): string {
  const tokens = /^\(([^()]*)\)$/.exec(label)?.[1]?.trim().split(/\s+/);
  if (!tokens) return label;
  const definition = definitions.find(
    (definition) => definition.name === tokens[0],
  );
  if (!definition || tokens.length !== definition.parameters.length + 1)
    return label;
  const seen = new Map<string, number>();
  const bindings = definition.parameters.map((parameter, index) => {
    const count = (seen.get(parameter.type) ?? 0) + 1;
    seen.set(parameter.type, count);
    const repeated =
      definition.parameters.filter((p) => p.type === parameter.type).length > 1;
    const role =
      parameter.type.replaceAll('-', ' ') + (repeated ? ` ${count}` : '');
    return `${role}: ${tokens[index + 1]}`;
  });
  return [definition.name.replaceAll('-', ' '), ...bindings].join(' · ');
}
export function latest(rows: StageRecord[], stage: ViewStage) {
  return rows.findLast((s) => s.stage === stage);
}
export function stageState(
  stage: ViewStage,
  snapshot?: RunSnapshot,
  run?: DesignRun,
): string {
  if (run?.needsReview?.includes(stage as StageName)) return 'Review again';
  if (snapshot?.gate?.stage === stage) return 'Awaiting you';
  if (run && !snapshot) {
    const failed =
      run.failure?.stage === 'warning-review' ? 'actions' : run.failure?.stage;
    if (failed && stages.indexOf(stage) >= stages.indexOf(failed))
      return stage === failed ? 'Corrections' : 'Waiting';
    if (stage === 'plan')
      return run.plan?.status === 'found'
        ? 'Checked'
        : run.status.replaceAll('_', ' ');
    return latest(run.stages, stage) ? 'Checked' : 'Waiting';
  }
  if (stage === 'plan')
    return run ? run.status.replaceAll('_', ' ') : 'Waiting';
  const events =
    snapshot?.events
      .map((x) => x.event)
      .filter(
        (e) =>
          ('stage' in e && e.stage === stage) ||
          (e.type === 'stage-result' && e.record.stage === stage),
      ) ?? [];
  const event = events.at(-1);
  if (snapshot?.state === 'failed' && event && event.type !== 'stage-accepted')
    return 'Failed';
  switch (event?.type) {
    case 'stage-accepted':
      return 'Passed';
    case 'task-created':
      return event.attempt > 1 ? 'Correcting' : 'Task sent';
    case 'task-claimed':
      return 'Picked up';
    case 'stage-checking':
      return 'Checking';
    case 'stage-result':
      return event.record.issues.some((i) => i.severity === 'error')
        ? 'Corrections'
        : 'Checking';
    default:
      return 'Waiting';
  }
}
