import type { GroundAction } from '@pddl/domain/planner';

export interface PlanGraphEdge {
  from: number;
  to: number;
}

export interface PlanGraph {
  edges: PlanGraphEdge[];
  layers: number[];
  layerCount: number;
}

/**
 * Preserve the order of actions that may affect one another. Every topological
 * ordering of the resulting graph is a valid reordering of the given route:
 * adjacent actions without an edge commute under this STRIPS fragment.
 */
export function buildPlanGraph(actions: GroundAction[]): PlanGraph {
  const count = actions.length;
  const reads = actions.map(
    (action) => new Set([...action.pre, ...action.neg]),
  );
  const writes = actions.map(
    (action) => new Set([...action.add, ...action.del]),
  );
  const conflicts = (a: number, b: number) => {
    for (const fact of writes[a]!)
      if (reads[b]!.has(fact) || writes[b]!.has(fact)) return true;
    for (const fact of writes[b]!) if (reads[a]!.has(fact)) return true;
    return false;
  };

  const direct = Array.from({ length: count }, () => new Set<number>());
  for (let i = 0; i < count; i++)
    for (let j = i + 1; j < count; j++) if (conflicts(i, j)) direct[i]!.add(j);

  const reachable = Array.from({ length: count }, () => new Set<number>());
  for (let i = count - 1; i >= 0; i--)
    for (const j of direct[i]!) {
      reachable[i]!.add(j);
      for (const k of reachable[j]!) reachable[i]!.add(k);
    }

  const edges: PlanGraphEdge[] = [];
  for (let i = 0; i < count; i++)
    for (const j of direct[i]!) {
      const redundant = [...direct[i]!].some(
        (via) => via !== j && reachable[via]!.has(j),
      );
      if (!redundant) edges.push({ from: i, to: j });
    }

  const layers = Array<number>(count).fill(0);
  for (let i = 0; i < count; i++)
    for (const j of direct[i]!)
      layers[j] = Math.max(layers[j]!, layers[i]! + 1);
  return {
    edges,
    layers,
    layerCount: count ? Math.max(...layers) + 1 : 0,
  };
}
