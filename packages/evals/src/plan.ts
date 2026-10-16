import type { Domain, Problem } from '@pddl/domain/ir';
import { forcedAnalysis } from '@pddl/domain/planner';

export interface StepRule {
  id: string;
  match: string;
  exclude?: string;
}
export interface Required {
  items: string[];
  steps: StepRule[];
  forbidden?: string;
  order: Array<[string, string]>;
  global_order: Array<[string, string]>;
  actor_type: string | null;
  produced_types: string[];
  /** Steps that occur once for the whole problem rather than per item. */
  global_steps?: StepRule[];
  /** Per step id, items that must NOT take that step (and need not cover it). */
  skip?: Record<string, string[]>;
  /** [item step, global step]: every item's step precedes the global step. */
  item_before_global?: Array<[string, string]>;
  /** [global step, item step]: the global step precedes every item's step. */
  global_before_item?: Array<[string, string]>;
  /** [global step, global step]: first occurrences in this order. */
  global_steps_order?: Array<[string, string]>;
  /** Types (or ancestors) matching this pattern are agents. */
  agent_pattern?: string;
}
export interface Run {
  status: string;
  domain?: Domain;
  problem?: Problem;
  plan?: { status: string; steps?: string[] };
}

/**
 * Score planned runs against pre-registered requirements. Check per-item step
 * coverage and order, ownership, forbidden branches, produced-object sharing,
 * and shared work from forcedAnalysis. A step belongs to the first goal item
 * among its arguments, or the item its objects were first seen with. Optional
 * rules handle skipped steps, problem-wide steps, and agent type patterns.
 */
export function scoreRun(
  run: Run,
  req: Required,
): { pass: boolean; reasons: string[] } {
  if (
    run.status !== 'planned' ||
    !run.plan?.steps ||
    !run.domain ||
    !run.problem
  )
    return { pass: false, reasons: [`no plan (${run.status})`] };
  const reasons: string[] = [];
  const typeOf = new Map(run.problem.objects.map((o) => [o.name, o.type]));
  const steps = run.plan.steps.map((label) => {
    const [action, ...args] = label.slice(1, -1).split(' ');
    return { action, args };
  });
  const matches = (rule: StepRule, action: string) =>
    new RegExp(rule.match, 'i').test(action) &&
    !(rule.exclude && new RegExp(rule.exclude, 'i').test(action));

  if (req.forbidden) {
    const re = new RegExp(req.forbidden, 'i');
    for (const s of steps)
      if (re.test(s.action)) reasons.push(`uses excluded branch ${s.action}`);
  }

  // Associate each step with an item. Agents serve many items, so they never
  // anchor an association: an object counts as an agent when its type or an
  // ancestor type names an agent role.
  const isActor = (o: string) =>
    !!req.actor_type && (typeOf.get(o) ?? '').includes(req.actor_type);
  const agentPattern = new RegExp(
    req.agent_pattern ?? 'agent|coder|reviewer|arm|robot',
  );
  const parentOf = new Map(run.domain.types.map((t) => [t.name, t.parent]));
  const isAgent = (o: string) => {
    for (let t: string | undefined = typeOf.get(o); t; t = parentOf.get(t))
      if (agentPattern.test(t)) return true;
    return false;
  };
  const objectItem = new Map<string, string>();
  const owner = steps.map((s) => {
    const direct = s.args.find((a) => req.items.includes(a));
    const item =
      direct ??
      (req.items.length === 1
        ? req.items[0]
        : s.args
            .filter((a) => !isAgent(a))
            .map((a) => objectItem.get(a))
            .find(Boolean));
    if (item)
      for (const a of s.args)
        if (!req.items.includes(a) && !isAgent(a) && !objectItem.has(a))
          objectItem.set(a, item);
    return item;
  });

  // 1. coverage and 2. order, per item.
  const firstIndex = (item: string, rule: StepRule) =>
    steps.findIndex((s, i) => owner[i] === item && matches(rule, s.action));
  const skipped = (id: string, item: string) =>
    req.skip?.[id]?.includes(item) ?? false;
  for (const item of req.items) {
    for (const rule of req.steps) {
      const found = firstIndex(item, rule) >= 0;
      if (skipped(rule.id, item)) {
        if (found) reasons.push(`${item}: takes ${rule.id}, which it must not`);
      } else if (!found) reasons.push(`${item}: no ${rule.id} step`);
    }
    for (const [a, b] of req.order) {
      const ra = req.steps.find((r) => r.id === a);
      const rb = req.steps.find((r) => r.id === b);
      if (!ra || !rb) continue;
      const ia = firstIndex(item, ra);
      const ib = firstIndex(item, rb);
      if (ia >= 0 && ib >= 0 && ia > ib)
        reasons.push(`${item}: ${b} before ${a}`);
    }
  }
  for (const [a, b] of req.global_order) {
    const [ida, itema] = a.split(':');
    const [idb, itemb] = b.split(':');
    const ra = req.steps.find((r) => r.id === ida);
    const rb = req.steps.find((r) => r.id === idb);
    if (!ra || !rb) continue;
    const ia = firstIndex(itema, ra);
    const ib = firstIndex(itemb, rb);
    if (ia >= 0 && ib >= 0 && ia > ib) reasons.push(`${b} before ${a}`);
  }

  // Global steps: once for the whole problem, in their own order and relative
  // to every item's steps.
  const globalIndex = (id: string) => {
    const rule = req.global_steps?.find((r) => r.id === id);
    return rule ? steps.findIndex((s) => matches(rule, s.action)) : -1;
  };
  for (const rule of req.global_steps ?? [])
    if (globalIndex(rule.id) < 0) reasons.push(`no ${rule.id} step`);
  for (const [a, b] of req.global_steps_order ?? []) {
    const ia = globalIndex(a);
    const ib = globalIndex(b);
    if (ia >= 0 && ib >= 0 && ia > ib) reasons.push(`${b} before ${a}`);
  }
  for (const [itemStep, globalStep] of req.item_before_global ?? []) {
    const rule = req.steps.find((r) => r.id === itemStep);
    const ig = globalIndex(globalStep);
    if (!rule || ig < 0) continue;
    for (const item of req.items) {
      const ii = firstIndex(item, rule);
      if (ii > ig) reasons.push(`${globalStep} before ${item}: ${itemStep}`);
    }
  }
  for (const [globalStep, itemStep] of req.global_before_item ?? []) {
    const rule = req.steps.find((r) => r.id === itemStep);
    const ig = globalIndex(globalStep);
    if (!rule || ig < 0) continue;
    for (const item of req.items) {
      const ii = firstIndex(item, rule);
      if (ii >= 0 && ii < ig)
        reasons.push(`${item}: ${itemStep} before ${globalStep}`);
    }
  }

  // 3. owner: the actor of the item's first step (its claim) does all its work.
  if (req.actor_type) {
    for (const item of req.items) {
      const own = steps.filter((_, i) => owner[i] === item);
      const claimant = own.flatMap((s) => s.args).find(isActor);
      for (const s of own)
        for (const a of s.args)
          if (isActor(a) && a !== claimant)
            reasons.push(
              `${item}: ${s.action} done by ${a}, claimed by ${claimant}`,
            );
    }
  }

  // 4. sharing: produced objects used for two items, and planner shared work.
  if (req.produced_types.length) {
    const usedBy = new Map<string, Set<string>>();
    steps.forEach((s, i) => {
      const item = owner[i];
      if (!item) return;
      for (const a of s.args) {
        const type = typeOf.get(a) ?? '';
        if (
          !req.produced_types.some((t) => type.includes(t)) ||
          /slot/.test(type)
        )
          continue;
        usedBy.set(a, (usedBy.get(a) ?? new Set()).add(item));
      }
    });
    for (const [obj, items] of usedBy)
      if (items.size > 1)
        reasons.push(`${obj} serves ${[...items].join(' and ')}`);
    const shared = forcedAnalysis(run.domain, run.problem, {
      maxGroundActions: 20_000,
      maxStates: 50_000,
    }).shared;
    for (const s of shared)
      reasons.push(`planner: ${s.action} shared by ${s.items.join(' and ')}`);
  }
  return { pass: reasons.length === 0, reasons: [...new Set(reasons)] };
}
