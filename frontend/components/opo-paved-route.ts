import type { Point } from './opo-data';

type Surface = 'walk' | 'shared' | 'gap';
type Node = { point: Point; cost: number; from?: Node; surface?: Surface };
const step = 0.8;
const surfaceCost: Record<Surface, number> = { walk: 1, shared: 1.9, gap: 12 };
const directions = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]];
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

/** Trace a route through modeled pavement and retain any caller-supplied gaps. */
export function pavedRoute(start: Point, goal: Point, surfaceAt: (point: Point) => Surface | undefined) {
  const margin = 38;
  const west = Math.min(start.x, goal.x) - margin, east = Math.max(start.x, goal.x) + margin;
  const north = Math.min(start.z, goal.z) - margin, south = Math.max(start.z, goal.z) + margin;
  const best = new Map<string, Node>();
  const frontier = new Set<Node>();
  const samples = new Map<string, Surface | undefined>();
  function sample(point: Point) {
    const key = `${point.x.toFixed(4)},${point.z.toFixed(4)}`;
    if (!samples.has(key)) samples.set(key, surfaceAt(point));
    return samples.get(key);
  }
  function edge(a: Point, b: Point): Surface | undefined {
    let kind: Surface = 'walk';
    const segments = Math.max(1, Math.ceil(distance(a, b) / 0.16));
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const surface = sample({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      if (!surface) return;
      if (surfaceCost[surface] > surfaceCost[kind]) kind = surface;
    }
    return kind;
  }
  if (!sample(start) || !sample(goal)) return;
  const first: Node = { point: start, cost: 0 };
  best.set('0,0', first);
  frontier.add(first);
  while (frontier.size) {
    let next: Node | undefined;
    let estimate = Infinity;
    for (const node of frontier) {
      const score = node.cost + distance(node.point, goal);
      if (score < estimate) { next = node; estimate = score; }
    }
    if (!next) break;
    frontier.delete(next);
    if (distance(next.point, goal) < step * 1.5) {
      const surface = edge(next.point, goal);
      if (surface) {
        let cursor: Node = { point: goal, cost: next.cost, from: next, surface };
        const legs: { surface: Surface; points: Point[] }[] = [];
        while (cursor.from && cursor.surface) {
          const previous = legs.at(-1);
          if (previous?.surface === cursor.surface) previous.points.push(cursor.from.point);
          else legs.push({ surface: cursor.surface, points: [cursor.point, cursor.from.point] });
          cursor = cursor.from;
        }
        return legs.reverse().map(leg => ({ ...leg, points: leg.points.reverse() }));
      }
    }
    const col = Math.round((next.point.x - start.x) / step);
    const row = Math.round((next.point.z - start.z) / step);
    for (const [dx, dz] of directions) {
      const key = `${col + dx},${row + dz}`;
      const point = { x: start.x + (col + dx) * step, z: start.z + (row + dz) * step };
      if (point.x < west || point.x > east || point.z < north || point.z > south) continue;
      const length = distance(next.point, point);
      const known = best.get(key);
      if (known && known.cost <= next.cost + length) continue;
      const surface = edge(next.point, point);
      if (!surface) continue;
      const cost = next.cost + length * surfaceCost[surface];
      if (known && known.cost <= cost) continue;
      if (known) frontier.delete(known);
      const node = { point, cost, from: next, surface };
      best.set(key, node);
      frontier.add(node);
    }
  }
}
