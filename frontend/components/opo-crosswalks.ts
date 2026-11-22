import type { Point } from './opo-data';
import type { createSurfaceClipper } from './opo-surface-clip';

export type CrossingSection = {
  a: Point; b: Point; width: number; length: number;
  road: { id: number; sidewalks: boolean[]; motor: boolean; unpaved: boolean; bridge: boolean };
};
type RoadHit = { segment: CrossingSection; point: Point; distance: number };

export type Crosswalk = {
  section: CrossingSection; center: Point; direction: Point; depth: number; confirmed: boolean;
};
export type CrosswalkArea = Pick<Crosswalk, 'center' | 'direction' | 'depth'> & { section: Pick<CrossingSection, 'width'> };
type SectionSurface = Pick<ReturnType<typeof createSurfaceClipper>, 'section'>;
export type CrossingSupport = 'connected' | 'no_carriageway' | 'paint_ends_inside_road' | 'paint_beyond_road' | 'no_landing';

const dot = (a: Point, b: Point) => a.x * b.x + a.z * b.z;
const relative = (a: Point, b: Point) => ({ x: a.x - b.x, z: a.z - b.z });

export function crosswalkFrame(crosswalk: CrosswalkArea) {
  const { center, direction } = crosswalk;
  return (along: number, across: number): Point => ({
    x: center.x + direction.x * along + direction.z * across,
    z: center.z + direction.z * along - direction.x * across,
  });
}

export function crossingSupport(area: CrosswalkArea, roads: SectionSurface, walks: SectionSurface,
  paint?: SectionSurface): CrossingSupport {
  return crossingSectionEvidence(area, roads, walks, paint).status;
}

function crossingSectionEvidence(area: CrosswalkArea, roads: SectionSurface, walks: SectionSurface,
  paint?: SectionSurface, fromRoadEdge = false): { status: CrossingSupport; landings?: number; edgeGap?: number } {
  const landingRange = 1.25;
  const half = area.section.width / 2;
  const direction = { x: area.direction.z, z: -area.direction.x };
  const radius = half + landingRange * 2;
  const coversCenter = ([from, to]: [number, number]) => from <= 0 && to >= 0;
  const road = roads.section(area.center, direction, radius).find(coversCenter);
  if (!road) return { status: 'no_carriageway' };
  const outline = paint?.section(area.center, direction, radius).find(coversCenter);
  if (paint && !outline) return { status: 'paint_ends_inside_road' };
  const ends = outline ? [Math.max(-half, outline[0]), Math.min(half, outline[1])] : [-half, half];
  if (ends[0] - road[0] > landingRange || road[1] - ends[1] > landingRange) return { status: 'paint_ends_inside_road' };
  if (road[0] - ends[0] > landingRange || ends[1] - road[1] > landingRange) return { status: 'paint_beyond_road' };
  const walking = walks.section(area.center, direction, radius);
  // Each landing must lie beyond its road edge in the crossing direction.
  const [landingStart, landingEnd] = fromRoadEdge ? road : ends;
  const onLeft = walking.some(([from, to]) =>
    Math.min(to, road[0]) - Math.max(from, road[0] - landingRange, landingStart - landingRange) >= 0.15);
  const onRight = walking.some(([from, to]) =>
    Math.min(to, road[1] + landingRange, landingEnd + landingRange) - Math.max(from, road[1]) >= 0.15);
  return { status: onLeft && onRight ? 'connected' : 'no_landing',
    landings: Number(onLeft) + Number(onRight),
    edgeGap: Math.max(Math.abs(ends[0] - road[0]), Math.abs(ends[1] - road[1])) };
}

export function fitCrosswalkToMeasuredRoad(crossing: Crosswalk, roads: SectionSurface): Crosswalk {
  const reach = 45;
  const axis = { x: crossing.direction.z, z: -crossing.direction.x };
  const road = roads.section(crossing.center, axis, reach).find(([from, to]) => from <= 0 && to >= 0);
  if (!road || road[0] <= -reach || road[1] >= reach) return crossing;
  const [from, to] = road;
  const width = to - from, shift = (from + to) / 2;
  if (width < 2 || Math.abs(shift) > Math.min(3, width / 4)) return crossing;
  return { ...crossing, center: crosswalkFrame(crossing)(0, shift), section: { ...crossing.section, width } };
}

export function surveyedCrosswalkArea(crossing: CrosswalkArea, outline: Point[]): CrosswalkArea {
  const { center, direction } = crossing;
  const normal = { x: direction.z, z: -direction.x };
  const extents = (axis: Point) => {
    const projections = outline.map(point => dot(relative(point, center), axis));
    return [Math.min(...projections), Math.max(...projections)];
  };
  const [back, front] = extents(direction);
  const [left, right] = extents(normal);
  return {
    center: crosswalkFrame(crossing)((front + back) / 2, (right + left) / 2),
    direction, depth: front - back, section: { width: right - left },
  };
}

export function surveyedCrosswalkFrame(outline: Point[], roads: SectionSurface,
  compactLandings?: (area: CrosswalkArea) => boolean): CrosswalkArea | undefined {
  // A mapped outline describes the crossing direction, even when the
  // nearest road link is missing or runs along a different intersection arm.
  let frame: CrosswalkArea | undefined;
  let footprint = Infinity;
  for (const [i, a] of outline.entries()) {
    const b = outline[(i + 1) % outline.length];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 0.01) continue;
    const direction = { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
    let candidate = surveyedCrosswalkArea({ center: a, direction, depth: 0, section: { width: 0 } }, outline);
    if (candidate.depth > candidate.section.width) {
      const across = { x: direction.z, z: -direction.x };
      candidate = { ...candidate, direction: across, depth: candidate.section.width, section: { width: candidate.depth } };
    }
    const area = candidate.depth * candidate.section.width;
    if (area < footprint) { frame = candidate; footprint = area; }
  }
  if (!frame || frame.section.width < frame.depth * 1.5) return undefined;
  // A short paint field is only reliable if it meets the measured walking
  // surfaces on both sides. Its width still comes from the survey.
  if (frame.depth < 1.25) return compactLandings?.(frame) ? frame : undefined;
  const { depth, direction, section: { width } } = frame;
  const at = crosswalkFrame(frame);
  const across = { x: direction.z, z: -direction.x };
  const supported = [-depth / 4, 0, depth / 4].filter(along => {
    const covered = roads.section(at(along, 0), across, width / 2)
      .reduce((sum, [from, to]) => sum + to - from, 0);
    return covered >= width * 0.65;
  });
  return supported.length >= 2 ? frame : undefined;
}

export function surveyedLandingFrame(outline: Point[], roads: SectionSurface, walks: SectionSurface,
  paint: SectionSurface): CrosswalkArea | undefined {
  const supported: { frame: CrosswalkArea; sections: number }[] = [];
  for (const [i, a] of outline.entries()) {
    const b = outline[(i + 1) % outline.length];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 0.01) continue;
    const dx = (b.x - a.x) / length, dz = (b.z - a.z) / length;
    // Test both orientations from each surveyed edge. The two road boundaries
    // and their landings can disambiguate a nearly square paint outline.
    for (const direction of [{ x: dx, z: dz }, { x: -dz, z: dx }]) {
      const frame = surveyedCrosswalkArea({ center: a, direction, depth: 0, section: { width: 0 } }, outline);
      const at = crosswalkFrame(frame);
      // The measured paint-to-road gap is checked separately from the
      // pedestrian landing beyond the surveyed road edge.
      const sections = [-0.22, 0, 0.22].filter(offset => {
        const support = crossingSectionEvidence({ ...frame, center: at(offset * frame.depth, 0) }, roads, walks, paint, true);
        // One mapped landing also supplies direction when the paint closely
        // spans both measured road edges on this section.
        return support.status === 'connected' || (support.landings === 1 && (support.edgeGap ?? Infinity) <= 0.30);
      }).length;
      if (sections >= 2) supported.push({ frame, sections });
    }
  }
  supported.sort((a, b) => b.sections - a.sections
    || a.frame.depth * a.frame.section.width - b.frame.depth * b.frame.section.width);
  const best = supported[0]?.frame;
  if (best && supported.every(({ frame }) => Math.abs(dot(frame.direction, best.direction)) >= Math.cos(Math.PI / 9))) return best;
}

export function zebraOffsets(width: number, edgeGap = 0.24) {
  const span = width - 2 * edgeGap;
  if (span < 0.8) return [];
  const count = Math.max(1, Math.round(span / 0.82));
  return Array.from({ length: count }, (_, i) => ((i + 0.5) / count - 0.5) * span);
}

export const surveyedZebraStripeM = 0.45;

export function surveyedZebraOffsets(width: number) {
  const period = surveyedZebraStripeM * 2;
  const count = Math.max(0, Math.floor((width + surveyedZebraStripeM) / period));
  return Array.from({ length: count }, (_, index) => (index - (count - 1) / 2) * period);
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

export function sameCrosswalk(a: CrosswalkArea, b: CrosswalkArea) {
  return Math.abs(dot(a.direction, b.direction)) > 0.92
    && Math.hypot(a.center.x - b.center.x, a.center.z - b.center.z) < Math.min(4.5, (a.depth + b.depth) / 2);
}

export function crossingOutline(a: Point, b: Point) {
  const length = Math.hypot(a.x - b.x, a.z - b.z);
  if (length < 0.6) return [];
  const dx = (b.z - a.z) / length * 1.15, dz = (a.x - b.x) / length * 1.15;
  return [
    { x: a.x + dx, z: a.z + dz }, { x: b.x + dx, z: b.z + dz },
    { x: b.x - dx, z: b.z - dz }, { x: a.x - dx, z: a.z - dz },
  ];
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
