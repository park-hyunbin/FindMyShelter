import type { Point } from './opo-data';

export type CrossingSection = {
  a: Point; b: Point; width: number; length: number;
  road: { id: number; sidewalks: boolean[]; motor: boolean; unpaved: boolean; bridge: boolean };
};
type RoadHit = { segment: CrossingSection; point: Point; distance: number };

export type Crosswalk = {
  section: CrossingSection; center: Point; direction: Point; depth: number; confirmed: boolean;
};
export type CrosswalkArea = Pick<Crosswalk, 'center' | 'direction' | 'depth'> & { section: Pick<CrossingSection, 'width'> };

const dot = (a: Point, b: Point) => a.x * b.x + a.z * b.z;
const relative = (a: Point, b: Point) => ({ x: a.x - b.x, z: a.z - b.z });

export function crosswalkFrame(crosswalk: CrosswalkArea) {
  const { center, direction } = crosswalk;
  return (along: number, across: number): Point => ({
    x: center.x + direction.x * along + direction.z * across,
    z: center.z + direction.z * along - direction.x * across,
  });
}

export function zebraOffsets(width: number, edgeGap = 0.24) {
  const span = width - 2 * edgeGap;
  if (span < 0.8) return [];
  const count = Math.max(1, Math.round(span / 0.82));
  return Array.from({ length: count }, (_, i) => ((i + 0.5) / count - 0.5) * span);
}

export function fitCrosswalk(outline: Point[], hits: RoadHit[], confirmed: boolean): Crosswalk[] {
  const possible = hits.flatMap(({ segment, point, distance }) => {
    if (segment.road.unpaved || segment.road.bridge) return [];
    const direction = { x: (segment.b.x - segment.a.x) / segment.length, z: (segment.b.z - segment.a.z) / segment.length };
    if (!outline.length) return distance <= 4 ? [{ section: segment, center: point, direction, depth: 2.4, confirmed, score: distance }] : [];

    const across = { x: direction.z, z: -direction.x };
    const sides = outline.map(vertex => dot(relative(vertex, point), across));
    const along = outline.map(vertex => dot(relative(vertex, point), direction));
    const low = Math.min(...sides), high = Math.max(...sides);
    const half = segment.width / 2;
    const span = high - low;
    const run = Math.max(...along) - Math.min(...along);
    const overlap = Math.min(high, half) - Math.max(low, -half);
    if (low >= -0.25 || high <= 0.25 || overlap < Math.min(segment.width * 0.48, 4) || span < run * 0.90) return [];

    const depth = Math.min(5.5, Math.max(2.0, run));
    // Prefer the road that the survey spans substantially across, over a junction arm it touches briefly.
    const score = distance / Math.max(5, span) + 0.7 * run / span + 0.8 * (1 - overlap / segment.width);
    return [{ section: segment, center: point, direction, depth, confirmed, score }];
  }).sort((a, b) => a.score - b.score);
  const first = possible[0];
  if (!first) return [];

  // A surveyed crossing can span separate carriageways. Preserve the median by painting each carriageway independently.
  const fitted: Crosswalk[] = [first];
  for (const crosswalk of possible.slice(1)) {
    if (!outline.length || Math.abs(dot(first.direction, crosswalk.direction)) < 0.91) continue;
    const delta = relative(crosswalk.center, first.center);
    if (Math.abs(dot(delta, first.direction)) > Math.max(first.depth, crosswalk.depth)) continue;
    const differentCarriageway = fitted.every(prior => {
      const offset = relative(crosswalk.center, prior.center);
      const lateral = Math.abs(offset.x * prior.direction.z - offset.z * prior.direction.x);
      return lateral >= (prior.section.width + crosswalk.section.width) * 0.47;
    });
    if (differentCarriageway) fitted.push(crosswalk);
  }
  return fitted;
}

export function sameCrosswalk(a: Crosswalk, b: Crosswalk) {
  return Math.abs(dot(a.direction, b.direction)) > 0.92
    && Math.hypot(a.center.x - b.center.x, a.center.z - b.center.z) < Math.min(4.5, (a.depth + b.depth) / 2);
}

export function crossingOutline(a: Point, b: Point) {
  const length = Math.hypot(a.x - b.x, a.z - b.z);
  if (length < 0.6) return [];
  const dx = (b.z - a.z) / length * 1.15, dz = (a.x - b.x) / length * 1.15;
  return [a, b].flatMap(point => [{ x: point.x + dx, z: point.z + dz }, { x: point.x - dx, z: point.z - dz }]);
}

export function leaveCrosswalkGaps(line: Point[], crossings: CrosswalkArea[], shoulder = 0) {
  if (!crossings.length) return [line];
  const runs: Point[][] = [];
  let current: Point[] = [];
  function interval(start: number, change: number, limit: number) {
    if (Math.abs(change) < 1e-6) return Math.abs(start) <= limit ? [0, 1] : null;
    const a = (-limit - start) / change, b = (limit - start) / change;
    return [Math.min(a, b), Math.max(a, b)];
  }
  for (const [i, a] of line.slice(0, -1).entries()) {
    const b = line[i + 1];
    const delta = relative(b, a);
    const at = (t: number) => ({ x: a.x + delta.x * t, z: a.z + delta.z * t });
    const holes = crossings.flatMap(({ center, direction, depth, section }) => {
      const start = relative(a, center);
      const across = { x: direction.z, z: -direction.x };
      const longitudinal = interval(dot(start, direction), dot(delta, direction), depth / 2 + 0.09);
      const lateral = interval(dot(start, across), dot(delta, across), section.width / 2 + shoulder);
      if (!longitudinal || !lateral) return [];
      const enter = Math.max(0, longitudinal[0], lateral[0]);
      const leave = Math.min(1, longitudinal[1], lateral[1]);
      return enter < leave ? [[enter, leave]] : [];
    }).sort((p, q) => p[0] - q[0]);
    let cursor = 0;
    for (const [enter, leave] of holes) {
      if (enter > cursor) {
        if (!current.length) current.push(at(cursor));
        current.push(at(enter));
      }
      if (current.length > 1) runs.push(current);
      current = [];
      cursor = Math.max(cursor, leave);
    }
    if (cursor < 1) {
      if (!current.length) current.push(at(cursor));
      current.push(b);
    }
  }
  if (current.length > 1) runs.push(current);
  return runs;
}
