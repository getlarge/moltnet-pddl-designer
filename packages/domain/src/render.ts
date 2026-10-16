/**
 * Render the typed IR as PDDL text. Pure and deterministic: the same IR always
 * produces the same bytes, so a rendered domain can be content-addressed,
 * diffed, and signed. Requirements are derived from the IR, never guessed.
 */
import type { Atom, Domain, Literal, Problem } from './ir.js';
import { checkDurativeAction, type DurativeAction } from './temporal.js';

const atom = (x: Atom) =>
  x.args.length ? `(${x.predicate} ${x.args.join(' ')})` : `(${x.predicate})`;
const literal = (x: Literal) => (x.negated ? `(not ${atom(x)})` : atom(x));
const conj = (parts: string[]) =>
  parts.length === 0
    ? '(and)'
    : parts.length === 1
      ? parts[0]
      : `(and ${parts.join(' ')})`;

/** Group names by type into PDDL's `a b - type` lines, in first-seen order. */
function typedList(items: Array<{ name: string; type: string }>): string[] {
  const groups = new Map<string, string[]>();
  for (const item of items) {
    const names = groups.get(item.type) ?? [];
    names.push(item.name);
    groups.set(item.type, names);
  }
  return [...groups].map(([type, names]) => `${names.join(' ')} - ${type}`);
}

export function requirements(domain: Domain): string[] {
  const reqs = [':strips', ':typing'];
  const negated = domain.actions.some((a) =>
    a.preconditions.some((p) => p.negated),
  );
  if (negated) reqs.push(':negative-preconditions');
  return reqs;
}

export function renderDomain(domain: Domain): string {
  return renderDomainWithTiming(domain, []);
}

/** Render a mixed domain, replacing the named classical drafts with durative actions. */
export function renderDomainWithTiming(
  domain: Domain,
  durativeActions: DurativeAction[],
): string {
  const timed = new Map<string, DurativeAction>();
  for (const action of durativeActions) {
    if (timed.has(action.name))
      throw new Error(`Duplicate durative action ${action.name}.`);
    checkDurativeAction(domain, action);
    timed.set(action.name, action);
  }
  const reqs = requirements(domain);
  if (timed.size) reqs.push(':durative-actions');
  if (
    [...timed.values()].some((a) => a.conditions.some((c) => c.negated)) &&
    !reqs.includes(':negative-preconditions')
  )
    reqs.push(':negative-preconditions');
  const lines = [
    `(define (domain ${domain.name})`,
    `  (:requirements ${reqs.join(' ')})`,
    '  (:types',
    ...typedList(
      domain.types.map((t) => ({ name: t.name, type: t.parent ?? 'object' })),
    ).map((l) => `    ${l}`),
    '  )',
    '  (:predicates',
    ...domain.predicates.map((p) => {
      const params = typedList(p.parameters).join(' ');
      return `    (${p.name}${params ? ' ' + params : ''})`;
    }),
    '  )',
  ];
  for (const a of domain.actions) {
    const durative = timed.get(a.name);
    if (durative) {
      const timedLiteral = (c: DurativeAction['conditions'][number]) =>
        c.timing === 'overall'
          ? `(over all ${literal(c)})`
          : `(at ${c.timing} ${literal(c)})`;
      lines.push(
        `  (:durative-action ${a.name}`,
        `    :parameters (${typedList(a.parameters).join(' ')})`,
        `    :duration (= ?duration ${durative.durationSeconds})`,
        `    :condition ${conj(durative.conditions.map(timedLiteral))}`,
        `    :effect ${conj(durative.effects.map(timedLiteral))}`,
        '  )',
      );
      continue;
    }
    const effects = [
      ...a.addEffects.map(atom),
      ...a.deleteEffects.map((x) => `(not ${atom(x)})`),
    ];
    lines.push(
      `  (:action ${a.name}`,
      `    :parameters (${typedList(a.parameters).join(' ')})`,
      `    :precondition ${conj(a.preconditions.map(literal))}`,
      `    :effect ${conj(effects)}`,
      '  )',
    );
  }
  lines.push(')');
  return lines.join('\n') + '\n';
}

export function renderProblem(problem: Problem, domainName: string): string {
  return [
    `(define (problem ${problem.name})`,
    `  (:domain ${domainName})`,
    '  (:objects',
    ...typedList(problem.objects).map((l) => `    ${l}`),
    '  )',
    '  (:init',
    ...problem.init.map((x) => `    ${atom(x)}`),
    '  )',
    `  (:goal ${conj(problem.goal.map(literal))})`,
    ')',
    '',
  ].join('\n');
}
