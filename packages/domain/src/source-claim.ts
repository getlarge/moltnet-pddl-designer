import type { Domain, Atom, Literal } from './ir.js';
import type { GroundingTarget } from './source-grounding.js';
import { readableRule } from './readable.js';
const sameAtom = (a: Atom, b: Atom) =>
  a.predicate === b.predicate &&
  a.args.length === b.args.length &&
  a.args.every((arg, i) => arg === b.args[i]);

/** The UI and classifier use the same claim, derived from actual formal fields. */
export function describeGroundingTarget(
  domain: Domain,
  target: GroundingTarget,
) {
  const action = domain.actions.find((a) => a.name === target.action);
  const predicate = domain.predicates.find(
    (p) => p.name === target.atom.predicate,
  );
  if (!action || !predicate)
    throw new Error('The selected rule no longer exists.');
  const present = action[target.field].some(
    (atom) =>
      sameAtom(atom, target.atom) &&
      (target.field !== 'preconditions' ||
        (atom as Literal).negated === !!target.negated),
  );
  const added = action.addEffects.some((atom) => sameAtom(atom, target.atom));
  const fact = `${target.atom.predicate}(${target.atom.args.join(', ')})`;
  const formalStatement =
    target.field === 'preconditions'
      ? `${action.name} ${present ? 'requires' : 'does not require'} ${fact} to be ${target.negated ? 'false' : 'true'} before it can execute.`
      : target.field === 'deleteEffects'
        ? added
          ? `Immediately after ${action.name}, ${fact} is true: the action adds that fact${present ? ' as well as removing it' : ''}.`
          : present
            ? `Immediately after ${action.name}, ${fact} is false: the action removes that fact.`
            : `If ${fact} is true before ${action.name}, it remains true afterward: the action does not remove that fact.`
        : present
          ? `Immediately after ${action.name}, ${fact} is true: the action establishes that fact.`
          : `${action.name} does not establish ${fact} as an effect.`;

  const words = readableRule(action, predicate, target.atom.args);
  if (!words)
    return {
      statement: formalStatement,
      formalStatement,
      wording: 'formal' as const,
      present,
    };
  const sentence = (text: string) =>
    text.charAt(0).toUpperCase() + text.slice(1) + '.';
  let statement: string;
  if (target.field === 'preconditions') {
    const condition = target.negated ? words.false : words.true;
    statement = `${sentence(words.action)} Before this action, the draft ${present ? 'requires' : 'does not require'} the following: ${condition}.`;
  } else if (target.field === 'addEffects') {
    statement = present
      ? `${sentence(words.action)} Immediately afterward, ${words.true}.`
      : `${sentence(words.action)} The draft does not make the following true: ${words.true}.`;
  } else {
    // Match the planner's STRIPS update: remove facts, then add facts.
    statement = added
      ? `${sentence(words.action)} Immediately afterward, ${words.true}.`
      : present
        ? `${sentence(words.action)} Immediately afterward, ${words.false}.`
        : `Suppose ${words.true} before the action. ${sentence(words.action)} Immediately afterward, ${words.true}.`;
  }
  return {
    statement,
    formalStatement,
    wording: 'readable' as const,
    present,
    participants: words.participants,
  };
}
