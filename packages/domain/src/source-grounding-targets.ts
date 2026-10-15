import type { Domain } from './ir.js';
import type { GroundingTarget } from './source-grounding.js';

/** Offer explicit model claims and lifetime checks for positive prerequisites. */
export function groundingTargets(domain: Domain): GroundingTarget[] {
  const targets: GroundingTarget[] = [];
  const seen = new Set<string>();
  const add = (target: GroundingTarget) => {
    const key = JSON.stringify([
      target.action,
      target.field,
      target.atom.predicate,
      target.atom.args,
      !!target.negated,
    ]);
    if (!seen.has(key)) {
      seen.add(key);
      targets.push(target);
    }
  };
  for (const action of domain.actions) {
    for (const precondition of action.preconditions) {
      const atom = {
        predicate: precondition.predicate,
        args: precondition.args,
      };
      add({
        action: action.name,
        field: 'preconditions',
        atom,
        negated: precondition.negated,
      });
      if (!precondition.negated)
        add({ action: action.name, field: 'deleteEffects', atom });
    }
    for (const field of ['addEffects', 'deleteEffects'] as const)
      for (const atom of action[field])
        add({ action: action.name, field, atom });
  }
  return targets;
}
