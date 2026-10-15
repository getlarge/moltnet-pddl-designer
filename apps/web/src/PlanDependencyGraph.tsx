import { useEffect } from 'react';
import type { GroundAction } from '@pddl/domain/planner';
import { buildPlanGraph } from './plan-graph.js';
import { useCurrentInView } from './useCurrentInView.js';

const nodeWidth = 184;
const nodeHeight = 80;
const columnGap = 80;
const rowGap = 28;
const padding = 24;

interface Point {
  x: number;
  y: number;
}

export function PlanDependencyGraph({
  actions,
  position,
  describeAction,
  onSelect,
}: {
  actions: GroundAction[];
  position: number;
  describeAction: (label: string) => string;
  onSelect: (position: number) => void;
}) {
  const rail = useCurrentInView<HTMLElement>(position);
  useEffect(() => {
    const container = rail.current;
    const current = container?.querySelector<HTMLElement>('[aria-current]');
    if (!container || !current) return;
    const bounds = container.getBoundingClientRect();
    const item = current.getBoundingClientRect();
    if (item.top < bounds.top) container.scrollTop += item.top - bounds.top;
    else if (item.bottom > bounds.bottom)
      container.scrollTop += item.bottom - bounds.bottom;
  }, [position, rail]);
  const graph = buildPlanGraph(actions);
  const columns = Array.from(
    { length: graph.layerCount },
    () => [] as number[],
  );
  graph.layers.forEach((layer, index) => columns[layer]!.push(index));
  const rowCount = Math.max(1, ...columns.map((column) => column.length));
  const contentHeight = rowCount * nodeHeight + (rowCount - 1) * rowGap;
  const width =
    padding * 2 +
    (graph.layerCount + 2) * nodeWidth +
    (graph.layerCount + 1) * columnGap;
  const height = padding * 2 + contentHeight;
  const start: Point = { x: padding, y: (height - nodeHeight) / 2 };
  const end: Point = {
    x: padding + (graph.layerCount + 1) * (nodeWidth + columnGap),
    y: start.y,
  };
  const points: Point[] = actions.map((_, index) => {
    const layer = graph.layers[index]!;
    const column = columns[layer]!;
    const row = column.indexOf(index);
    const columnHeight =
      column.length * nodeHeight + (column.length - 1) * rowGap;
    return {
      x: padding + (layer + 1) * (nodeWidth + columnGap),
      y:
        padding +
        (contentHeight - columnHeight) / 2 +
        row * (nodeHeight + rowGap),
    };
  });
  const incoming = new Set(graph.edges.map((edge) => edge.to));
  const outgoing = new Set(graph.edges.map((edge) => edge.from));
  const lines: [Point, Point][] = [
    ...points
      .filter((_, index) => !incoming.has(index))
      .map((point) => [start, point] as [Point, Point]),
    ...graph.edges.map(
      (edge) => [points[edge.from]!, points[edge.to]!] as [Point, Point],
    ),
    ...points
      .filter((_, index) => !outgoing.has(index))
      .map((point) => [point, end] as [Point, Point]),
  ];
  const path = (from: Point, to: Point) => {
    const x1 = from.x + nodeWidth;
    const x2 = to.x;
    const y1 = from.y + nodeHeight / 2;
    const y2 = to.y + nodeHeight / 2;
    const bend = (x2 - x1) / 2;
    return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
  };

  return (
    <nav ref={rail} className="plan-graph" aria-label="Plan dependencies">
      <div className="plan-graph-canvas" style={{ width, height }}>
        <svg aria-hidden="true" viewBox={`0 0 ${width} ${height}`}>
          <defs>
            <marker
              id="plan-graph-arrow"
              markerWidth="7"
              markerHeight="7"
              refX="6"
              refY="3.5"
              orient="auto"
            >
              <path d="M 0 0 L 7 3.5 L 0 7" />
            </marker>
          </defs>
          {lines.map(([from, to], index) => (
            <path
              key={index}
              d={path(from, to)}
              markerEnd="url(#plan-graph-arrow)"
            />
          ))}
        </svg>
        <button
          className="plan-graph-node boundary"
          style={{ left: start.x, top: start.y }}
          aria-current={position === 0 ? 'step' : undefined}
          onClick={() => onSelect(0)}
        >
          <span>Start</span>
          <strong>Initial facts</strong>
        </button>
        {actions.map((action, index) => (
          <button
            key={index}
            className={`plan-graph-node${index + 1 < position ? ' visited' : ''}`}
            style={{ left: points[index]!.x, top: points[index]!.y }}
            aria-label={`Step ${index + 1}: ${describeAction(action.label)}; ${
              graph.edges
                .filter((edge) => edge.to === index)
                .map((edge) => `after step ${edge.from + 1}`)
                .join(', ') || 'after Start'
            }`}
            aria-current={position === index + 1 ? 'step' : undefined}
            onClick={() => onSelect(index + 1)}
          >
            <span>Step {index + 1}</span>
            <strong>{describeAction(action.label)}</strong>
          </button>
        ))}
        <div
          className="plan-graph-node boundary"
          style={{ left: end.x, top: end.y }}
        >
          <span>End</span>
          <strong>Resulting facts</strong>
        </div>
      </div>
    </nav>
  );
}
