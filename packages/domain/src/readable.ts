import type { ActionDef, Parameter, PredicateDef } from './ir.js';

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\?[a-z][a-z0-9-]*)\}/g)].map((match) => match[1]);

/** Syntactic checks only: a person still reviews whether wording means the rule. */
export function templateProblems(
  text: string,
  parameters: Parameter[],
): string[] {
  const found = placeholders(text);
  const names = parameters.map((p) => p.name);
  const problems: string[] = [];
  if (!text.trim()) problems.push('provide a non-empty readable sentence');
  for (const name of found)
    if (!names.includes(name)) problems.push(`unknown participant ${name}`);
  for (const name of names)
    if (!found.includes(name)) problems.push(`include participant {${name}}`);
  if (/[{}]/.test(text.replace(/\{\?[a-z][a-z0-9-]*\}/g, '')))
    problems.push('use placeholders such as {?b}; remove unmatched braces');
  return problems;
}

export function participantLabels(action: ActionDef) {
  const counts = new Map<string, number>();
  for (const p of action.parameters)
    counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
  const used = new Map<string, number>();
  return new Map(
    action.parameters.map((p) => {
      const index = used.get(p.type) ?? 0;
      used.set(p.type, index + 1);
      const type = p.type.replaceAll('-', ' ');
      return [
        p.name,
        p.label?.trim() ??
          (counts.get(p.type) === 1
            ? `the ${type}`
            : `${type} ${String.fromCharCode(65 + index)}`),
      ];
    }),
  );
}

export function renderTemplate(text: string, bindings: Map<string, string>) {
  return text
    .replace(
      /\{(\?[a-z][a-z0-9-]*)\}/g,
      (_, name: string) => bindings.get(name) ?? `{${name}}`,
    )
    .trim()
    .replace(/[.!?]+$/, '');
}

export function readableRule(
  action: ActionDef,
  predicate: PredicateDef,
  args: string[],
) {
  if (!action.reading || !predicate.reading) return undefined;
  if (
    templateProblems(action.reading, action.parameters).length ||
    templateProblems(predicate.reading.true, predicate.parameters).length ||
    templateProblems(predicate.reading.false, predicate.parameters).length
  )
    return undefined;
  if (predicate.parameters.length !== args.length) return undefined;
  const labels = participantLabels(action);
  if (
    new Set([...labels.values()].map((s) => s.toLowerCase())).size !==
    labels.size
  )
    return undefined;
  const bindings = new Map(
    predicate.parameters.map((p, i) => [p.name, labels.get(args[i])!]),
  );
  if ([...bindings.values()].some((v) => !v)) return undefined;
  return {
    action: renderTemplate(action.reading, labels),
    true: renderTemplate(predicate.reading.true, bindings),
    false: renderTemplate(predicate.reading.false, bindings),
    participants: Object.fromEntries(labels),
  };
}
