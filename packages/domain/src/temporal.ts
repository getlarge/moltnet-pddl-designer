import { isSubtype } from './check.js';
import type { ActionDef, Domain, Parameter } from './ir.js';

export type ConditionTiming = 'start' | 'overall' | 'end';
export type EffectTiming = 'start' | 'end';

export interface TimedLiteral<T extends ConditionTiming = ConditionTiming> {
  predicate: string;
  args: string[];
  negated: boolean;
  timing: T;
}

/** A numeric-duration PDDL 2.1 action. Durations use seconds throughout this app. */
export interface DurativeAction {
  name: string;
  parameters: Parameter[];
  durationSeconds: number;
  conditions: TimedLiteral[];
  effects: TimedLiteral<EffectTiming>[];
}

/** Reject unsupported or inconsistent model output before rendering any PDDL. */
export function checkDurativeAction(
  domain: Domain,
  action: DurativeAction,
): void {
  const source = domain.actions.find((item) => item.name === action.name);
  if (!source) throw new Error(`Unknown action ${action.name}.`);
  if (JSON.stringify(source.parameters) !== JSON.stringify(action.parameters))
    throw new Error(`Parameters changed for ${action.name}.`);
  if (!Number.isFinite(action.durationSeconds) || action.durationSeconds <= 0)
    throw new Error(`Duration for ${action.name} must be positive seconds.`);

  const params = new Map(action.parameters.map((p) => [p.name, p.type]));
  const signatures = new Map(domain.predicates.map((p) => [p.name, p]));
  for (const [kind, clauses] of [
    ['condition', action.conditions],
    ['effect', action.effects],
  ] as const) {
    const seen = new Set<string>();
    for (const clause of clauses) {
      if (
        ![
          'start',
          'end',
          ...(kind === 'condition' ? ['overall'] : []),
        ].includes(clause.timing)
      )
        throw new Error(`Invalid ${kind} timing in ${action.name}.`);
      const signature = signatures.get(clause.predicate);
      if (!signature || signature.parameters.length !== clause.args.length)
        throw new Error(
          `Unknown predicate or wrong arity: ${clause.predicate}.`,
        );
      clause.args.forEach((arg, i) => {
        const actual = params.get(arg);
        if (
          !actual ||
          !isSubtype(domain.types, actual, signature.parameters[i].type)
        )
          throw new Error(`Invalid argument ${arg} in ${clause.predicate}.`);
      });
      const key = JSON.stringify([
        clause.timing,
        clause.predicate,
        clause.args,
      ]);
      if (seen.has(key))
        throw new Error(
          `Duplicate or contradictory ${kind} clause in ${action.name}: ${key}.`,
        );
      seen.add(key);
    }
  }
  if (!action.effects.length)
    throw new Error(`Durative action ${action.name} has no effects.`);
}

/** A timed rewrite must retain every fact represented by the classical draft. */
export function assertActionCoverage(
  base: ActionDef,
  timed: DurativeAction,
): void {
  const key = (x: { predicate: string; args: string[]; negated: boolean }) =>
    JSON.stringify([x.predicate, x.args, x.negated]);
  // Over-all and end conditions do not require a fact at the exact start.
  const conditions = new Set(
    timed.conditions.filter((item) => item.timing === 'start').map(key),
  );
  const effects = new Set(timed.effects.map(key));
  for (const pre of base.preconditions)
    if (!conditions.has(key(pre)))
      throw new Error(
        `${base.name}: temporal extraction omitted precondition ${key(pre)}`,
      );
  for (const effect of base.addEffects)
    if (!effects.has(key({ ...effect, negated: false })))
      throw new Error(
        `${base.name}: temporal extraction omitted add effect ${key({ ...effect, negated: false })}`,
      );
  for (const effect of base.deleteEffects)
    if (!effects.has(key({ ...effect, negated: true })))
      throw new Error(
        `${base.name}: temporal extraction omitted delete effect ${key({ ...effect, negated: true })}`,
      );
}
