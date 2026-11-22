import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { extent, inShape, nearestOnLine, splitLineAt, type OpoData, type Point, type Shape, type Street, type StreetPaint } from './opo-data';
import { sidewalkFascia, sidewalkRise, type createSidewalkSeams } from './opo-curb-walk';
import { opoEntranceBridgeId, opoEntranceDrivewayId, opoEntranceTurnId } from './opo-entrance';
import { surfaceUV, type TourMaterials, type TourSurface } from './opo-materials';
import { groundPolygon, paintRibbon, ribbon, streetDeckLift, terrainSurface, type createTerrainProjection, type RibbonSection } from './opo-meshes';
import {
  crossingOutline, crossingSupport, crosswalkFrame, fitCrosswalk, fitCrosswalkToMeasuredRoad,
  leaveCrosswalkGaps, sameCrosswalk, surveyedCrosswalkArea, surveyedCrosswalkFrame, surveyedLandingFrame,
  surveyedZebraOffsets, surveyedZebraStripeM, zebraOffsets,
  type CrossingSupport, type Crosswalk, type CrosswalkArea,
} from './opo-crosswalks';
import { siteSurfaces } from './data/site-surfaces';
import { projectSiteCrossing, sidewalkTreeWell } from './opo-site-surfaces';
import { createSurfaceClipper } from './opo-surface-clip';
import { attachPaintFilter } from './opo-paint-filter';

const major = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
const paths = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway']);
const streetWidths: Record<string, number> = {
  motorway: 13, trunk: 13, primary: 10, secondary: 8, tertiary: 6.4, residential: 5.3, living_street: 4.8,
  unclassified: 4.8, service: 3.8, track: 3, pedestrian: 3, steps: 1.5, cycleway: 2.3,
};

export function streetWidth(road: Street) {
  const base = road.category.replace('_link', '');
  const width = road.width ?? (road.lanes ? road.lanes * (major.has(base) ? 3.1 : 2.8) + 0.5 : streetWidths[base] ?? 1.7);
  return T.MathUtils.clamp(width, 1.2, (road.lanes ?? 0) > 8 ? 38 : 26);
}

export function inferredRoadSection(covered: [number, number][], halfWidth: number): [number, number] {
  let left = -halfWidth, right = halfWidth;
  for (const [from, to] of covered) {
    // Where a sampled center is already on measured pavement, use that
    // section at the seam and let the measured mesh own the overlap.
    if (from < -0.002 && to > 0.002) return [from, to];
    if (to <= 0.002) left = Math.max(left, Math.min(0, to));
    if (from >= -0.002) right = Math.min(right, Math.max(0, from));
  }
  return [left, right];
}

type Segment = { road: Street; a: Point; b: Point; aId: number; bId: number; length: number; width: number };
type RoadPosition = { segment: Segment; point: Point; distance: number; t: number };
const cellSize = 36;
const pointBetween = (a: Point, b: Point, t: number): Point => ({
  x: T.MathUtils.lerp(a.x, b.x, t), z: T.MathUtils.lerp(a.z, b.z, t),
});

function pavementBounds(rings: Shape, margin = 0) {
  return {
    rings, boundaries: rings.map(ring => [...ring, ring[0]]),
    bounds: new T.Box2().setFromPoints(rings[0].map(({ x, z }) => new T.Vector2(x, z))).expandByScalar(margin),
  };
}

function segmentLocation(position: Point, segment: Segment): RoadPosition {
  const { a, b, length } = segment;
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = T.MathUtils.clamp(((position.x - a.x) * dx + (position.z - a.z) * dz) / length ** 2, 0, 1);
  const point = { x: a.x + t * dx, z: a.z + t * dz };
  return { segment, point, t, distance: Math.hypot(position.x - point.x, position.z - point.z) };
}

export function createStreetNetwork(roads: Street[]) {
  const cells = new Map<string, Segment[]>();
  const junctions = new Map<number, Segment[]>();
  const bridges = new Map<string, Segment[]>();
  const append = <K>(index: Map<K, Segment[]>, key: K, segment: Segment) => {
    const entries = index.get(key);
    if (entries) entries.push(segment);
    else index.set(key, [segment]);
  };
  function indexSegment(index: Map<string, Segment[]>, segment: Segment, margin: number) {
    const { a, b } = segment;
    const lowX = Math.floor((Math.min(a.x, b.x) - margin) / cellSize);
    const highX = Math.floor((Math.max(a.x, b.x) + margin) / cellSize);
    const lowZ = Math.floor((Math.min(a.z, b.z) - margin) / cellSize);
    const highZ = Math.floor((Math.max(a.z, b.z) + margin) / cellSize);
    for (let x = lowX; x <= highX; x++) for (let z = lowZ; z <= highZ; z++) append(index, `${x},${z}`, segment);
  }
  for (const road of roads) {
    const width = streetWidth(road);
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i];
      const length = Math.hypot(a.x - b.x, a.z - b.z);
      if (length < 0.05) continue;
      const segment = { road, a, b, aId: road.nodeIds[i - 1], bId: road.nodeIds[i], length, width };
      if (road.bridge) indexSegment(bridges, segment, width / 2 + 0.55);
      if (!road.motor) continue;
      append(junctions, segment.aId, segment);
      append(junctions, segment.bId, segment);
      indexSegment(cells, segment, width);
    }
  }

  function nearby(point: Point, radius: number) {
    const x = Math.floor(point.x / cellSize), z = Math.floor(point.z / cellSize);
    const range = Math.ceil(radius / cellSize);
    const candidates = new Set<Segment>();
    for (let dx = -range; dx <= range; dx++) for (let dz = -range; dz <= range; dz++) {
      for (const segment of cells.get(`${x + dx},${z + dz}`) ?? []) candidates.add(segment);
    }
    return [...candidates].map(segment => segmentLocation(point, segment)).filter(hit => hit.distance <= radius);
  }

  function nearest(point: Point, radius = 34) {
    return nearby(point, radius).reduce<RoadPosition | undefined>((best, hit) =>
      !best || hit.distance < best.distance ? hit : best, undefined);
  }

  function drive(point: Point, current: Segment) {
    const candidates = new Set([current, ...(junctions.get(current.aId) ?? []), ...(junctions.get(current.bId) ?? [])]);
    let best: RoadPosition | undefined;
    for (const segment of candidates) {
      const hit = segmentLocation(point, segment);
      if (!best || hit.distance < best.distance) best = hit;
    }
    if (!best) return undefined;
    const margin = Math.max(0.35, best.segment.width / 2 - 0.92);
    if (best.distance > margin + 0.7) return undefined;
    const fraction = best.distance > margin ? margin / best.distance : 1;
    return { ...best, point: {
      x: best.point.x + (point.x - best.point.x) * fraction,
      z: best.point.z + (point.z - best.point.z) * fraction,
    } };
  }

  function raiseBridge(point: Point, owners?: ReadonlySet<number>) {
    const nearby = bridges.get(`${Math.floor(point.x / cellSize)},${Math.floor(point.z / cellSize)}`);
    if (!nearby) return 0;
    let height = 0;
    for (const segment of nearby) {
      if (owners && !owners.has(segment.road.id)) continue;
      const hit = segmentLocation(point, segment);
      if (hit.distance > segment.width / 2 + 0.55) continue;
      const roadStart = segment.road.points[0], roadEnd = segment.road.points.at(-1)!;
      const fromEnd = Math.min(Math.hypot(hit.point.x - roadStart.x, hit.point.z - roadStart.z),
        Math.hypot(hit.point.x - roadEnd.x, hit.point.z - roadEnd.z));
      height = Math.max(height, Math.min(1.05, fromEnd * 0.14));
    }
    return height;
  }

  function route(start: RoadPosition, end: RoadPosition) {
    const distanceAt = new Map<number, number>();
    const points = new Map<number, Point>();
    const previous = new Map<number, number>();
    const frontier = new Set<number>();
    const starts = [[start.segment.aId, start.segment.a, -1], [start.segment.bId, start.segment.b, 1]] as const;
    const goals = new Map([
      [end.segment.aId, { point: end.segment.a, direction: 1 }],
      [end.segment.bId, { point: end.segment.b, direction: -1 }],
    ]);
    const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
    const canTravel = (oneWay: number, direction: number, length: number) => length < 0.05 || !oneWay || oneWay === direction;
    for (const [id, point, direction] of starts) {
      const distance = gap(start.point, point);
      if (!canTravel(start.segment.road.oneWay, direction, distance)) continue;
      distanceAt.set(id, distance);
      points.set(id, point);
      frontier.add(id);
    }
    let goalId: number | undefined;
    let best = Infinity;
    while (frontier.size) {
      let node = 0, distance = Infinity;
      for (const candidate of frontier) {
        const cost = distanceAt.get(candidate)!;
        if (cost < distance) { node = candidate; distance = cost; }
      }
      if (distance >= best) break;
      frontier.delete(node);
      const goal = goals.get(node);
      if (goal) {
        const extra = gap(goal.point, end.point);
        if (distance + extra < best && canTravel(end.segment.road.oneWay, goal.direction, extra)) {
          goalId = node;
          best = distance + extra;
        }
      }
      for (const edge of junctions.get(node) ?? []) {
        const forward = edge.aId === node;
        if (!canTravel(edge.road.oneWay, forward ? 1 : -1, edge.length)) continue;
        const next = forward ? edge.bId : edge.aId;
        const nextDistance = distance + edge.length;
        if (nextDistance >= (distanceAt.get(next) ?? Infinity)) continue;
        distanceAt.set(next, nextDistance);
        previous.set(next, node);
        points.set(next, forward ? edge.b : edge.a);
        frontier.add(next);
      }
    }
    if (start.segment === end.segment) {
      const forward = gap(start.point, start.segment.a) <= gap(end.point, start.segment.a);
      const direct = gap(start.point, end.point);
      if (direct <= best && canTravel(start.segment.road.oneWay, forward ? 1 : -1, direct)) return [start.point, end.point];
    }
    if (goalId === undefined) return [];
    const line = [end.point];
    for (let id: number | undefined = goalId; id !== undefined; id = previous.get(id)) line.push(points.get(id)!);
    line.push(start.point);
    return line.reverse().filter((point, i, ordered) => i === 0 || gap(point, ordered[i - 1]) >= 0.05);
  }
  return { nearest, nearby, drive, raiseBridge, route };
}

function offsetLine(points: Point[], offset: number) {
  return points.map((point, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: point.x + (b.z - a.z) / length * offset, z: point.z - (b.x - a.x) / length * offset };
  });
}

function cleanMarking(points: Point[], tolerance: number) {
  const last = points[points.length - 1];
  const separated = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z) >= 0.01;
  const line = points.filter((point, i) => !i || i === points.length - 1
    || (separated(point, points[i - 1]) && separated(point, last)));
  if (line.length < 3) return line;
  const keep = new Set([0, line.length - 1]);
  const spans = [[0, line.length - 1]];
  while (spans.length) {
    const [start, end] = spans.pop()!;
    const a = line[start], b = line[end];
    const dx = b.x - a.x, dz = b.z - a.z;
    const lengthSquared = dx * dx + dz * dz;
    let farthest = start, limit = tolerance * tolerance;
    for (let i = start + 1; i < end; i++) {
      const x = line[i].x - a.x, z = line[i].z - a.z;
      const t = lengthSquared ? T.MathUtils.clamp((x * dx + z * dz) / lengthSquared, 0, 1) : 0;
      const error = (x - t * dx) ** 2 + (z - t * dz) ** 2;
      if (error <= limit) continue;
      farthest = i;
      limit = error;
    }
    if (farthest === start) continue;
    keep.add(farthest);
    spans.push([start, farthest], [farthest, end]);
  }
  return line.filter((_, i) => keep.has(i));
}

function offsetMarking(points: Point[], offset: number) {
  const normals = points.slice(1).map((b, i) => {
    const a = points[i];
    const dx = b.x - a.x, dz = b.z - a.z;
    const length = Math.hypot(dx, dz) || 1;
    return { x: dz / length, z: -dx / length };
  });
  return points.map((point, i) => {
    const before = normals[Math.max(i - 1, 0)], after = normals[Math.min(i, normals.length - 1)];
    const miter = Math.max(0.7, 1 + before.x * after.x + before.z * after.z);
    return { x: point.x + (before.x + after.x) * offset / miter, z: point.z + (before.z + after.z) * offset / miter };
  });
}

export function surveyedDashSegments(points: Point[], style: StreetPaint, busLane: boolean, startDistance = 0): Point[][] {
  // Korean road-marking diagram 525 specifies equal 0.5–1m strokes and gaps.
  const [run, gap] = style === 'white-guide-dash' ? [0.75, 0.75]
    : busLane ? [3, 3] : [style === 'yellow-dash' ? 2.7 : 4, 4.5];
  const chunks: Point[][] = [];
  const phase = startDistance % (run + gap);
  let paint = phase < run;
  let remaining = (paint ? run : run + gap) - phase;
  let segment: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const end = points[i];
    let start = points[i - 1], distance = Math.hypot(end.x - start.x, end.z - start.z);
    while (distance >= remaining) {
      const t = remaining / distance;
      const split = { x: start.x + (end.x - start.x) * t, z: start.z + (end.z - start.z) * t };
      if (paint) chunks.push([...segment, split]);
      paint = !paint;
      segment = [split];
      distance -= remaining;
      remaining = paint ? run : gap;
      start = split;
    }
    if (paint && distance > 0) segment.push(end);
    remaining -= distance;
  }
  if (paint && segment.length > 1) chunks.push(segment);
  return chunks;
}

function leaveJunctionGap(points: Point[], start: number, end: number) {
  const length = points.slice(1).reduce((sum, point, i) => sum + Math.hypot(point.x - points[i].x, point.z - points[i].z), 0);
  const remaining: Point[] = [];
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const distance = Math.hypot(b.x - a.x, b.z - a.z);
    const begin = Math.max(walked, start), finish = Math.min(walked + distance, length - end);
    if (finish - begin > 0.02) {
      const at = (offset: number) => {
        const ratio = (offset - walked) / distance;
        return { x: T.MathUtils.lerp(a.x, b.x, ratio), z: T.MathUtils.lerp(a.z, b.z, ratio) };
      };
      if (remaining.length === 0) remaining.push(at(begin));
      remaining.push(at(finish));
    }
    walked += distance;
  }
  return remaining;
}

type CrossingSource = 'site_estimate' | 'osm_way' | 'osm_point' | 'city_archive' | 'city_current';
type CrossingCheck = {
  source: CrossingSource; center: Point;
  status: CrossingSupport | 'surveyed_outline' | 'no_aligned_road' | 'unconfirmed_direction' | 'duplicate';
  roadId?: number; sourceId?: string; direction?: Point;
};

export function addStreets(data: OpoData, scene: T.Scene, finish?: TourMaterials,
  terrain?: ReturnType<typeof createTerrainProjection>, insideBuilding?: (position: Point) => boolean,
  sidewalkSeams?: ReturnType<typeof createSidewalkSeams>, auditCrossing?: (check: CrossingCheck) => void) {
  const urban = data.region !== 'opo';
  const deckLift = streetDeckLift(data.region);
  const sidewalkLift = deckLift + (urban ? sidewalkRise : 0.10);
  const site = siteSurfaces[data.region];
  const driveway = site?.layout.drivewayRoad;
  const driveOutline = site?.layout.pavedDrive;
  const pavementSources = [
    ...(site?.layout.surveyedRoads ?? []).map(road => ({ ...road, siteDriveway: false })),
    ...(driveway && driveOutline ? [{ ...driveway, outline: driveOutline, siteDriveway: true }] : []),
  ];
  const replacements = new Map(pavementSources.flatMap(road =>
    road.axis.map(({ nodeId, coordinate }) => [nodeId, data.project(coordinate)] as const)));
  const centerlineRoads = replacements.size ? data.streets.map(road => {
    if (!road.motor || !road.nodeIds.some(id => replacements.has(id))) return road;
    return { ...road, points: road.points.map((point, i) => replacements.get(road.nodeIds[i]) ?? point) };
  }) : data.streets;
  const centerlines = createStreetNetwork(centerlineRoads);
  const survey = data.roadMarkings;
  const surveyedLines = survey?.lanes.map(lane => ({ ...lane, points: lane.points.map(data.project) })) ?? [];
  const elevatedLines = survey?.elevatedMarkings?.records ?? [];
  const paintedDeckIds = new Set(elevatedLines.map(line => line.deckId));
  const paintedHumps = survey?.paintedHumps?.records.map(hump => projectSiteCrossing(data.project, hump)) ?? [];
  const hasSiteCrossings = site?.layout.surveyedCrossings?.length || (!urban && site?.layout.estimatedCrossings?.length);
  const roadPaint = surveyedLines.length || paintedHumps.length || hasSiteCrossings || survey?.crosswalks.length
    || survey?.currentCrosswalks?.records.length || data.servicePaving.length
    ? createSurfaceClipper() : undefined;
  const crossingPaint = roadPaint && createSurfaceClipper();
  const edgeOffsets = new Map<number, number[]>();
  for (const { points, edge } of surveyedLines) for (const [index, a] of points.slice(0, -1).entries()) {
    if (!edge) continue;
    const b = points[index + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    const samples = Math.max(1, Math.ceil(length / 7));
    for (let i = 0; i < samples; i++) {
      const t = (i + 0.5) / samples;
      const hit = centerlines.nearest({ x: a.x + dx * t, z: a.z + dz * t }, 22);
      if (!hit) continue;
      const { segment, distance } = hit;
      if (segment.road.width || length < 1 || distance < segment.width / 2 - 0.3 || distance > segment.width / 2 + 1.65) continue;
      const alignment = Math.abs(dx * (segment.b.x - segment.a.x) + dz * (segment.b.z - segment.a.z)) / (length * segment.length);
      if (alignment < 0.9) continue;
      const offsets = edgeOffsets.get(segment.road.id) ?? [];
      offsets.push(distance);
      edgeOffsets.set(segment.road.id, offsets);
    }
  }
  const roads = centerlineRoads.map(road => {
    const offsets = edgeOffsets.get(road.id);
    if (!offsets || offsets.length < 3) return road;
    const robustEdge = offsets.sort((a, b) => a - b)[Math.floor((offsets.length - 1) * 0.75)];
    return { ...road, width: Math.max(streetWidth(road), 2 * (robustEdge + 0.18)) };
  });
  const network = edgeOffsets.size ? createStreetNetwork(roads) : centerlines;
  const surveyedWalks = site?.layout.surveyedWalks?.map(({ roadId, side, outline, centerline }) => {
    const ring = outline.map(data.project);
    const bounds = new T.Box2().setFromPoints(ring.map(point => new T.Vector2(point.x, point.z)));
    return { roadId, side, ring, boundary: [...ring, ring[0]], bounds,
      ends: centerline && [data.project(centerline[0]), data.project(centerline[centerline.length - 1])] };
  }) ?? [];
  const surveyedPavements = pavementSources.flatMap(({ roadId, nodes, outline, siteDriveway }) => {
    const road = roads.find(road => road.id === roadId);
    const first = road?.nodeIds.indexOf(nodes[0]) ?? -1;
    const last = road?.nodeIds.indexOf(nodes[1]) ?? -1;
    if (!road || first < 0 || last <= first) return [];
    const ring = outline.map(data.project);
    const bounds = new T.Box2().setFromPoints(ring.map(point => new T.Vector2(point.x, point.z))).expandByScalar(24);
    return [{ roadId, siteDriveway, coveredNodes: new Set(road.nodeIds.slice(first, last)), ring,
      boundary: [...ring, ring[0]], bounds }];
  });
  const junctionPavements = (site?.layout.surveyedJunctions ?? []).map(outline => {
    const ring = outline.map(data.project);
    const bounds = new T.Box2().setFromPoints(ring.map(point => new T.Vector2(point.x, point.z))).expandByScalar(24);
    return { ring, boundary: [...ring, ring[0]], bounds };
  });
  const streetPavements = [...surveyedPavements.filter(patch => !patch.siteDriveway), ...junctionPavements];
  const sitePavement = surveyedPavements.find(patch => patch.siteDriveway);
  const municipalRoads = (data.pavement?.roads ?? []).map(rings => pavementBounds(rings, 4));
  const municipalWalks = (data.pavement?.sidewalks ?? []).map(rings => pavementBounds(rings));
  const servicePavements = data.servicePaving.map(rings => pavementBounds(rings));
  const trafficIslands = (data.pavement?.trafficIslands ?? []).map(({ shape, ...detail }) => ({
    ...pavementBounds(shape), ...detail,
  }));
  const elevatedRoads = data.pavement?.elevatedRoads;
  const bridgeOwners = new Map(roads.filter(road => road.bridge).map(({ id }) => [id, new Set([id])]));
  const pedestrianPavements = [...municipalWalks, ...trafficIslands];
  const municipalSurface = data.pavement?.paired ? createSurfaceClipper() : undefined;
  if (municipalSurface) for (const { rings } of [...municipalRoads, ...pedestrianPavements]) {
    const footprint = groundPolygon(rings, () => 0, 28, 0);
    municipalSurface.addSurface(footprint);
    footprint.dispose();
  }
  const measuredSegments = new Map<string, [number, number][]>((data.pavement?.coveredSegments ?? []).map(([road, node, spans]) => [
    `${road}:${node}`, spans,
  ] as const));
  const exactCrossings = (site?.layout.surveyedCrossings ?? []).map(crossing => projectSiteCrossing(data.project, crossing));
  function footprint(shapes: Shape[], maxEdge = 28) {
    const surface = createSurfaceClipper();
    for (const rings of shapes) {
      const geometry = groundPolygon(rings, () => 0, maxEdge, 0);
      surface.addSurface(geometry);
      geometry.dispose();
    }
    return surface;
  }
  const pedestrianSurface = footprint(pedestrianPavements.map(({ rings }) => rings));
  const islandSurface = footprint(trafficIslands.map(({ rings }) => rings));
  const roadSurface = createSurfaceClipper();
  for (const { rings } of municipalRoads) {
    const polygon = groundPolygon(rings, () => 0, 28, 0);
    const exposed = islandSurface.subtract(polygon);
    roadSurface.addSurface(exposed);
    exposed.dispose();
    polygon.dispose();
  }
  islandSurface.clear();
  for (const trace of urban ? [] : site?.layout.estimatedCrossings ?? []) {
    const crossing = projectSiteCrossing(data.project, trace);
    const outline = footprint([[crossing.ring]]);
    const status = crossingSupport(crossing.area, roadSurface, pedestrianSurface, outline);
    outline.clear();
    auditCrossing?.({ source: 'site_estimate', center: crossing.area.center, status });
    if (status === 'connected') exactCrossings.push(crossing);
  }
  const exitApproaches = new Map<string, {
    start: Point; end: Point; fraction: number; pavement: ReturnType<typeof pavementBounds>;
  }>();
  for (const { roadId, nodes: [, node], endEdge } of urban ? [] : pavementSources) {
    if (!endEdge) continue;
    const road = roads.find(road => road.id === roadId);
    const index = road?.nodeIds.indexOf(node) ?? -1;
    if (!road || index < 0 || index >= road.points.length - 1 || road.bridge) continue;
    const key = `${roadId}:${node}`;
    const [start, next] = [road.points[index], road.points[index + 1]];
    const dx = next.x - start.x, dz = next.z - start.z;
    const length = Math.hypot(dx, dz);
    const [a, b] = endEdge.map(data.project);
    const width = streetWidth(road);
    const measuredWidth = Math.hypot(a.x - b.x, a.z - b.z);
    const uncovered = measuredSegments.get(key)?.[0]?.[0] ?? 1;
    const blendLength = Math.min(Math.max(width, measuredWidth), length * uncovered * 0.8);
    if (blendLength < 0.25 || measuredWidth < 0.5) continue;
    const fraction = blendLength / length;
    const end = pointBetween(start, next, fraction);
    const nx = dz / length, nz = -dx / length;
    const left = { x: end.x + nx * width / 2, z: end.z + nz * width / 2 };
    const right = { x: end.x - nx * width / 2, z: end.z - nz * width / 2 };
    const [first, second] = (a.x - b.x) * nx + (a.z - b.z) * nz > 0 ? [a, b] : [b, a];
    exitApproaches.set(key, { start, end, fraction, pavement: pavementBounds([[first, second, right, left]], 4) });
  }
  function hasSurvey(roadId: number, startNode: number) {
    return surveyedPavements.some(patch => patch.roadId === roadId && patch.coveredNodes.has(startNode));
  }
  function fallbackSpans(road: Street, points: Point[]) {
    if (!surveyedPavements.some(patch => patch.roadId === road.id) && !measuredSegments.size) return [points];
    const start = road.points.indexOf(points[0]);
    if (start < 0) return [points];
    const result: Point[][] = [];
    let line = [points[0]];
    function end() {
      if (line.length > 1) result.push(line);
      line = [];
    }
    for (let i = 0; i < points.length - 1; i++) {
      const node = road.nodeIds[start + i];
      const intervals = hasSurvey(road.id, node) ? [[0, 1]] : measuredSegments.get(`${road.id}:${node}`) ?? [];
      const a = points[i], b = points[i + 1];
      let cursor = 0;
      for (const [from, to] of intervals) {
        if (cursor < from) {
          if (!line.length) line.push(cursor === 0 ? a : pointBetween(a, b, cursor));
          line.push(pointBetween(a, b, from));
        }
        end();
        cursor = to;
      }
      if (cursor < 1) {
        if (!line.length) line.push(cursor === 0 ? a : pointBetween(a, b, cursor));
        line.push(b);
      }
    }
    end();
    return result;
  }
  const tracedDrive = site?.layout.pavedDrive?.map(data.project);
  const crossings: Crosswalk[] = [];
  const crossingsByRoad = new Map<number, Crosswalk[]>();
  const crossingSurveys = new Set<Crosswalk>();
  const sourceOutlines = new Map<Crosswalk, Point[]>();
  const replacedArchive = new Set<string>();
  const cityCrossings: { area: ReturnType<typeof surveyedCrosswalkArea>; ring: Point[]; paintAreas?: Shape[] }[] = [];
  function addCrossing(outline: Point[], center: Point, source: CrossingSource, inventoryMatch = false,
    current?: { id: string; paintAreas: Shape[]; across?: [Point, Point] }) {
    const confirmedOutline = source === 'city_current' || (source === 'city_archive' && inventoryMatch);
    const sourceId = current?.id;
    if (exactCrossings.some(({ ring, boundary }) => inShape(center, [ring])
      || (!confirmedOutline && nearestOnLine(center, [boundary]).distance < 4))) {
      auditCrossing?.({ source, center, status: 'duplicate', sourceId });
      return;
    }
    const radius = Math.min(45, Math.max(4, ...outline.map(point => Math.hypot(point.x - center.x, point.z - center.z))));
    const candidates = urban && confirmedOutline ? []
      : fitCrosswalk(outline, network.nearby(center, radius), source !== 'city_archive' || inventoryMatch);
    let surveyFrame: CrosswalkArea | undefined;
    if (current?.across) {
      const [a, b] = current.across;
      const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
      if (length > 0.01) {
        const direction = { x: -dz / length, z: dx / length };
        surveyFrame = surveyedCrosswalkArea({ center, direction, depth: 0, section: { width: 0 } }, outline);
      }
    }
    if (!surveyFrame && confirmedOutline) {
      const paint = footprint(current?.paintAreas ?? [[outline]]);
      surveyFrame = surveyedLandingFrame(outline, roadSurface, pedestrianSurface, paint)
        ?? surveyedCrosswalkFrame(outline, roadSurface, area =>
          crossingSupport(area, roadSurface, pedestrianSurface, paint) === 'connected');
      paint.clear();
    }
    if (!candidates.length && !surveyFrame) {
      auditCrossing?.({ source, center, status: confirmedOutline ? 'unconfirmed_direction' : 'no_aligned_road', sourceId });
      return;
    }
    if (confirmedOutline) {
      // A confirmed polygon may cover two carriageways. Generate the pattern
      // over its entire surveyed extent with one phase; the actual deck and
      // median boundaries decide where paint can be seen.
      const area = surveyFrame ?? surveyedCrosswalkArea(candidates[0], outline);
      if (cityCrossings.some(crossing => inShape(area.center, [crossing.ring])
        && inShape(crossing.area.center, [outline]))) {
        auditCrossing?.({ source, center: area.center, status: 'duplicate', sourceId });
        return;
      }
      cityCrossings.push({ area, ring: outline, paintAreas: current?.paintAreas });
      auditCrossing?.({ source, center: area.center, direction: area.direction, status: 'surveyed_outline',
        roadId: candidates[0]?.section.road.id, sourceId });
      return true;
    }
    const paint = outline.length ? footprint([[outline]]) : undefined;
    for (const approximation of candidates) {
      const patch = surveyedPavements.find(patch => !patch.siteDriveway && patch.roadId === approximation.section.road.id
        && inShape(approximation.center, [patch.ring]));
      const crossing = fitCrosswalkToMeasuredRoad(approximation, roadSurface);
      const id = crossing.section.road.id;
      const status = crossings.some(existing => sameCrosswalk(existing, crossing))
        || cityCrossings.some(existing => sameCrosswalk(existing.area, crossing)
          || (existing.paintAreas && inShape(crossing.center, [existing.ring]))) ? 'duplicate'
        : crossingSupport(crossing, roadSurface, pedestrianSurface, paint);
      auditCrossing?.({ source, center: crossing.center, status, roadId: id });
      if (status !== 'connected') continue;
      if (outline.length) sourceOutlines.set(crossing, outline);
      if (patch) crossingSurveys.add(crossing);
      crossings.push(crossing);
      const entries = crossingsByRoad.get(id) ?? [];
      entries.push(crossing);
      crossingsByRoad.set(id, entries);
    }
    paint?.clear();
  }
  const outlineCenter = (outline: Point[]) => outline.reduce((sum, point) =>
    ({ x: sum.x + point.x / outline.length, z: sum.z + point.z / outline.length }), { x: 0, z: 0 });
  function surveyedCrossings(confirmed: boolean) {
    for (const [recordIndex, record] of (survey?.crosswalks ?? []).entries()) {
      if (record.inventoryMatch !== confirmed) continue;
      for (const [surfaceIndex, ring] of record.surfaces.entries()) {
        const outline = ring.map(data.project);
        const center = outlineCenter(outline);
        if (replacedArchive.has(`${recordIndex}:${surfaceIndex}`)) {
          auditCrossing?.({ source: 'city_archive', center, status: 'duplicate' });
          continue;
        }
        // Inside a reviewed drive, use the site markings instead of fitting unverified paint to a nearby street.
        if (!confirmed && tracedDrive && inShape(center, [tracedDrive])) continue;
        addCrossing(outline, center, 'city_archive', confirmed);
      }
    }
  }
  for (const record of survey?.currentCrosswalks?.records ?? []) {
    const outline = record.outline.map(data.project);
    const paintAreas = record.paintAreas.map(shape => shape.map(ring => ring.map(data.project)));
    const accepted = addCrossing(outline, outlineCenter(outline), 'city_current', true, {
      id: record.id, paintAreas,
      across: record.across && [data.project(record.across[0]), data.project(record.across[1])],
    });
    if (accepted) for (const [archive, surface] of record.supersedes ?? []) replacedArchive.add(`${archive}:${surface}`);
  }
  surveyedCrossings(true);
  if (!urban) {
    surveyedCrossings(false);
    for (const [a, b] of data.crossingWays) {
      const outline = crossingOutline(a, b);
      if (outline.length) addCrossing(outline, { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, 'osm_way');
    }
    for (const item of data.streetPoints) if (item.kind === 'crossing') addCrossing([], item.position, 'osm_point');
  }
  roadSurface.clear();
  pedestrianSurface.clear();
  const measuredCrossings: typeof cityCrossings = [...exactCrossings, ...cityCrossings];
  const siteCrossings = measuredCrossings.map(crossing => crossing.area);
  const paintCrossings = [...crossings, ...siteCrossings];
  const joined = new Map<number, number>();
  if (!urban && municipalSurface) for (const road of roads) {
    if (road.motor) road.nodeIds.forEach((id, i) => {
      const edges = i > 0 && i < road.nodeIds.length - 1 ? 2 : 1;
      joined.set(id, (joined.get(id) ?? 0) + edges);
    });
  }
  const continuationNormals = new Map<Point, Point>();
  if (!urban && municipalSurface) {
    const approaches = new Map<number, { point: Point; direction: Point }[]>();
    for (const road of roads) {
      if (!road.motor || road.unpaved || paths.has(road.category) || road.points.length < 2) continue;
      const end = road.points.length - 1;
      for (const [index, other] of [[0, 1], [end, end - 1]]) {
        const node = road.nodeIds[index];
        if (joined.get(node) !== 2) continue;
        const point = road.points[index], neighbor = road.points[other];
        const dx = neighbor.x - point.x, dz = neighbor.z - point.z;
        const length = Math.hypot(dx, dz);
        if (length < 0.05) continue;
        const connected = approaches.get(node) ?? [];
        connected.push({ point, direction: { x: dx / length, z: dz / length } });
        approaches.set(node, connected);
      }
    }
    for (const connected of approaches.values()) {
      if (connected.length !== 2) continue;
      const [a, b] = connected;
      if (a.point.x !== b.point.x || a.point.z !== b.point.z) continue;
      const dot = a.direction.x * b.direction.x + a.direction.z * b.direction.z;
      if (dot > -Math.cos(T.MathUtils.degToRad(25))) continue;
      // Mapped ways can split at a tag change along the same road. Use
      // one cross-section there so the two ribbons meet without a round cap.
      const dx = a.direction.x - b.direction.x, dz = a.direction.z - b.direction.z;
      const length = Math.hypot(dx, dz);
      const normal = { x: dz / length, z: -dx / length };
      continuationNormals.set(a.point, normal);
      continuationNormals.set(b.point, normal);
    }
  }
  const continuationNormal = (point: Point) => continuationNormals.get(point);
  function surfaceAt(x: number, z: number, owners?: ReadonlySet<number>) {
    const ground = terrainSurface(data.ground, x, z);
    return elevatedRoads && !owners ? ground : ground + network.raiseBridge({ x, z }, owners);
  }
  const surface = (x: number, z: number) => surfaceAt(x, z);
  function withBridgeGrade(geometry: T.BufferGeometry, owners?: ReadonlySet<number>) {
    if (elevatedRoads && !owners) return geometry;
    const position = geometry.getAttribute('position');
    let raised = false;
    for (let i = 0; i < position.count; i++) {
      const lift = network.raiseBridge({ x: position.getX(i), z: position.getZ(i) }, owners);
      if (!lift) continue;
      position.setY(i, position.getY(i) + lift);
      raised = true;
    }
    if (raised) geometry.computeVertexNormals();
    return geometry;
  }
  function pavementArea(rings: Point[][], lift: number, maxEdge: number, owners?: ReadonlySet<number>) {
    return terrain ? withBridgeGrade(terrain.area(rings, lift), owners)
      : groundPolygon(rings, (x, z) => surfaceAt(x, z, owners), maxEdge, lift);
  }
  function pavementStrip(points: Point[], width: number, lift: number, owners?: ReadonlySet<number>,
    section?: RibbonSection, endNormal?: (point: Point) => Point | undefined) {
    return terrain ? withBridgeGrade(terrain.fit(ribbon(points, width, () => 0, Infinity, 3, section, endNormal), lift), owners)
      : ribbon(points, width, (x, z) => surfaceAt(x, z, owners) + lift, urban ? 1.25 : Infinity, 3, section, endNormal);
  }
  const paintViewport = { value: new T.Vector2(1, 1) };
  const paintProjection = { value: 1 };
  const fallbackExclusions = !urban && (data.pavement || tracedDrive) ? createSurfaceClipper() : undefined;
  const inferredGroundDeck = !urban && municipalSurface ? createSurfaceClipper() : undefined;
  const buildingFootprints = inferredGroundDeck && footprint(data.buildings.flatMap(building => building.shapes));
  const groundCaps: { geometry: T.BufferGeometry; color: string; texture: TourSurface }[] = [];
  if (fallbackExclusions && tracedDrive) {
    const outline = groundPolygon([tracedDrive], () => 0, Infinity, 0);
    fallbackExclusions.addSurface(outline);
    outline.dispose();
  }
  const deferredPaint: { mask: T.BufferGeometry; color: string; width: number }[] = [];
  const layers = new Map<string, {
    color: string; texture?: TourSurface; geometry: T.BufferGeometry[]; castsShadow: boolean; paint: boolean; name?: string;
  }>();
  function add(color: string, geometry: T.BufferGeometry, texture?: TourSurface, castsShadow = false, name?: string) {
    if (!geometry.getAttribute('position')?.count) { geometry.dispose(); return; }
    if (geometry.index) {
      const flat = geometry.toNonIndexed();
      geometry.dispose();
      geometry = flat;
    }
    if (texture && finish) surfaceUV(geometry, texture);
    else geometry.deleteAttribute('uv');
    const paint = !!geometry.getAttribute('paintWidth');
    const key = `${color}:${texture ?? ''}:${castsShadow}:${paint}:${name ?? ''}`;
    const layer = layers.get(key);
    if (layer) layer.geometry.push(geometry);
    else layers.set(key, { color, texture, geometry: [geometry], castsShadow, paint, name });
  }
  function addPaint(color: string, geometry: T.BufferGeometry, width: number, name?: string) {
    const position = geometry.getAttribute('position');
    if (urban && position?.count) {
      geometry.setAttribute('paintWidth', new T.BufferAttribute(new Float32Array(position.count).fill(width), 1));
    } else geometry.deleteAttribute('paintCoordinates');
    add(color, geometry, undefined, false, name);
  }
  function addCrossingPaint(color: string, geometry: T.BufferGeometry, width: number) {
    const visible = crossingPaint?.subtract(geometry, 0.1) ?? geometry;
    if (visible !== geometry) geometry.dispose();
    crossingPaint?.addSurface(visible);
    addPaint(color, visible, width);
  }
  function crossingStrip(points: Point[], width: number, height: number, color: string) {
    if (data.pavement && roadPaint) deferredPaint.push({ mask: paintRibbon(points, width), color, width });
    else {
      const deck = terrain ? withBridgeGrade(terrain.fit(paintRibbon(points, width), height))
        : paintRibbon(points, width, (x, z) => surface(x, z) + height, urban ? 1.25 : Infinity);
      addCrossingPaint(color, deck, width);
    }
  }
  function trimFallback(geometry: T.BufferGeometry, exclusions = fallbackExclusions) {
    if (!exclusions) return geometry;
    const exposed = exclusions.subtract(geometry);
    geometry.dispose();
    return exposed;
  }
  function addGroundRoad(geometry: T.BufferGeometry, color: string, texture?: TourSurface) {
    const open = buildingFootprints ? trimFallback(geometry, buildingFootprints) : geometry;
    const deck = inferredGroundDeck ? trimFallback(open, inferredGroundDeck) : open;
    inferredGroundDeck?.addSurface(deck);
    roadPaint?.addSurface(deck);
    add(color, deck, texture);
  }
  const asphalt = finish ? '#e2ecf8' : '#737878';
  const bridgeFootprint = elevatedRoads && createSurfaceClipper();
  const bridgePaint = new Map<string, ReturnType<typeof createSurfaceClipper>>();
  for (const { sourceId, roadIds, shapes, dividers } of elevatedRoads ?? []) {
    const paintSurface = paintedDeckIds.has(sourceId) ? createSurfaceClipper() : undefined;
    if (paintSurface) bridgePaint.set(sourceId, paintSurface);
    const owners = new Set<number>(roadIds);
    const dividerShapes = dividers.flatMap(divider => divider.shapes);
    const dividerBoundary = dividerShapes.length ? footprint(dividerShapes) : undefined;
    const undividedDeck = dividerBoundary && createSurfaceClipper();
    for (const rings of shapes) {
      const deck = pavementArea(rings, deckLift, 1.45, owners);
      bridgeFootprint?.addSurface(deck);
      fallbackExclusions?.addSurface(deck);
      undividedDeck?.addSurface(deck);
      const carriageway = dividerBoundary ? trimFallback(deck, dividerBoundary) : deck;
      paintSurface?.addSurface(carriageway);
      add(asphalt, carriageway, 'asphalt', false, '고가 차도');
    }
    if (undividedDeck) {
      // A structure outline includes its dividers. Preserve that outline for
      // fallback exclusion while projecting paint only onto the carriageway.
      const grade = (x: number, z: number) => undividedDeck.heightAt({ x, z }) ?? surfaceAt(x, z, owners) + deckLift;
      for (const rings of dividerShapes) {
        const mask = groundPolygon(rings, () => 0, 28, 0);
        add('#a8aaa6', undividedDeck.clipOnce(mask, sidewalkRise), undefined, false, '고가 분리 경계');
        mask.dispose();
        for (const ring of rings) {
          add('#888c88', sidewalkFascia(ring, grade, (x, z) => grade(x, z) + sidewalkRise));
        }
      }
      undividedDeck.clear();
    }
    dividerBoundary?.clear();
  }
  function strip(points: Point[], width: number, height: number, color: string, texture?: TourSurface,
    roadDeck = false, trim = false, owners?: ReadonlySet<number>, roadShoulder = false, name?: string) {
    const measured = roadDeck || roadShoulder ? owners ? bridgeFootprint : municipalSurface : undefined;
    const section: RibbonSection | undefined = measured && ((point, normal, halfWidth) =>
      inferredRoadSection(measured.section(point, normal, halfWidth), halfWidth));
    const endNormal = roadDeck || roadShoulder ? continuationNormal : undefined;
    let geometry = texture ? pavementStrip(points, width, height, owners, section, endNormal)
      : ribbon(points, width, (x, z) => surfaceAt(x, z, owners) + height, urban ? 1.25 : Infinity, 3, section, endNormal);
    if (owners && bridgeFootprint) geometry = trimFallback(geometry, bridgeFootprint);
    else if (trim) geometry = trimFallback(geometry);
    if (roadDeck && !owners) addGroundRoad(geometry, color, texture);
    else {
      const layer = owners && roadDeck ? '고가 차도'
        : owners && (texture === 'pavers' || texture === 'cobble') ? '고가 보행로' : name;
      add(color, geometry, texture, false, layer);
    }
  }
  const priorityRoads = createSurfaceClipper();
  function addSurveyedRoad(ring: Point[]) {
    // Where a junction and a surveyed road overlap, keep the junction's top surface.
    const deck = pavementArea([ring], deckLift, 1.45);
    const surveyed = priorityRoads.subtract(deck);
    deck.dispose();
    const exposed = municipalSurface?.subtract(surveyed) ?? surveyed;
    if (exposed !== surveyed) surveyed.dispose();
    const outline = groundPolygon([ring], () => 0, 24, 0);
    priorityRoads.addSurface(outline);
    fallbackExclusions?.addSurface(outline);
    outline.dispose();
    roadPaint?.addSurface(exposed);
    add(asphalt, exposed, 'asphalt');
  }
  for (const { ring } of junctionPavements) addSurveyedRoad(ring);
  for (const { ring, siteDriveway } of surveyedPavements) {
    if (siteDriveway) continue;
    addSurveyedRoad(ring);
  }
  priorityRoads.clear();
  const municipalTreeHeights = new Map<string, number>();
  if (data.pavement) {
    const reviewed = createSurfaceClipper();
    const priorityAreas = [
      ...(municipalSurface ? [] : [...surveyedPavements, ...junctionPavements, ...surveyedWalks].map(({ ring }) => [ring])),
      ...trafficIslands.map(({ rings }) => rings),
    ];
    for (const rings of priorityAreas) {
      const mask = groundPolygon(rings, () => 0, Infinity, 0);
      reviewed.addSurface(mask);
      mask.dispose();
    }
    for (const { rings } of municipalRoads) {
      const deck = pavementArea(rings, deckLift, 1.45);
      const exposed = reviewed.subtract(deck);
      deck.dispose();
      fallbackExclusions?.addSurface(exposed);
      roadPaint?.addSurface(exposed);
      add(asphalt, exposed, 'asphalt');
    }
    const trees = data.streetPoints.filter(point => point.surveyedTree && !insideBuilding?.(point.position)
      && !priorityAreas.some(rings => inShape(point.position, rings)));
    for (const { rings, bounds } of municipalWalks) {
      const walk = pavementArea(rings, sidewalkLift, 1.45);
      const exposed = reviewed.subtract(walk);
      walk.dispose();
      fallbackExclusions?.addSurface(exposed);
      sidewalkSeams?.addDeck(exposed);
      add('#c8c1b8', exposed, 'pavers');
      const sidewalkTrees = trees.filter(({ position }) => bounds.containsPoint(new T.Vector2(position.x, position.z))
        && inShape(position, rings));
      if (sidewalkTrees.length) {
        const sidewalkSurface = createSurfaceClipper();
        sidewalkSurface.addSurface(exposed);
        for (const { id, position } of sidewalkTrees) {
          const well = sidewalkTreeWell(position, rings, sidewalkSurface);
          if (well) {
            add('#555853', well.frame);
            add('#807463', well.fill, 'forest');
          }
          municipalTreeHeights.set(id, surface(position.x, position.z) + sidewalkLift);
        }
        sidewalkSurface.clear();
      }
      for (const ring of rings) {
        const wall = sidewalkFascia(ring, surface, (x, z) => surface(x, z) + sidewalkLift);
        if (sidewalkSeams) sidewalkSeams.addSide(wall, exposed => add('#aaa59a', exposed));
        else add('#aaa59a', wall);
      }
    }
    for (const { rings, paving, planting, trees } of trafficIslands) {
      const deck = pavementArea(rings, sidewalkLift, 1.45);
      fallbackExclusions?.addSurface(deck);
      add('#c8c1b8', deck, 'pavers');
      for (const ring of rings) add('#aaa59a', sidewalkFascia(ring, surface, (x, z) => surface(x, z) + sidewalkLift));
      for (const path of paving) add('#bba093', pavementArea(path, sidewalkLift + 0.012, 1.45), 'pavers');
      for (const patch of planting) add('#a4ad80', pavementArea(patch, sidewalkLift + 0.018, 1.45), 'grass');
      for (const { id, position } of trees) municipalTreeHeights.set(id, surface(position.x, position.z) + sidewalkLift + 0.018);
    }
    reviewed.clear();
  }
  function zebra(crossing: Crosswalk) {
    const { depth, section: { width, road }, confirmed } = crossing;
    const position = crosswalkFrame(crossing);
    const tone = confirmed ? '#eeeee4' : '#dedbd0';
    const half = depth / 2;
    const surveyedDeck = crossingSurveys.has(crossing);
    const sourceOutline = sourceOutlines.get(crossing);
    const sourcePaint = sourceOutline && footprint([[sourceOutline]]);
    for (const offset of zebraOffsets(width)) {
      const line = [position(-half, offset), position(half, offset)];
      if (sourcePaint && roadPaint) {
        const stripe = paintRibbon(line, 0.44);
        deferredPaint.push({ mask: sourcePaint.clip(stripe, 0), color: tone, width: 0.44 });
        stripe.dispose();
      } else if (surveyedDeck && roadPaint) {
        deferredPaint.push({ mask: paintRibbon(line, 0.44), color: tone, width: 0.44 });
      } else crossingStrip(line, 0.44, deckLift + 0.075, tone);
    }
    sourcePaint?.clear();

    // A graph-derived landing can cut across a surveyed lane at a skewed junction.
    if (municipalSurface || sourceOutline) return;
    road.sidewalks.forEach((present, index) => {
      if (!present) return;
      const side = index === 0 ? 1 : -1;
      const at = (out: number) => side * (width / 2 + out);
      if (surveyedDeck && !surveyedWalks.some(walk => walk.roadId === road.id
        && inShape(position(0, at(1.0)), [walk.ring]))) return;
      const rampDepth = half + 0.14;
      // A modeled landing joins the painted road to the adjacent mapped sidewalk.
      const ramp = ribbon([position(0, at(-0.03)), position(0, at(0.92))], rampDepth * 2, (x, z) => {
        const lateral = (x - crossing.center.x) * crossing.direction.z - (z - crossing.center.z) * crossing.direction.x;
        const lift = T.MathUtils.lerp(deckLift + 0.01, sidewalkLift, T.MathUtils.clamp((lateral * side - width / 2) / 0.85, 0, 1));
        return surface(x, z) + lift;
      }, 0.7);
      const paving = urban ? 'pavers' : 'cobble';
      add('#c6c2b5', ramp, paving);
      strip([position(-rampDepth, at(1.34)), position(rampDepth, at(1.34))], 0.88, sidewalkLift + 0.004, '#d4cec2', paving);
    });
  }
  function surveyedPaint(points: Point[], style: StreetPaint, clipper: ReturnType<typeof createSurfaceClipper>,
    busLane = false, dashOffsetM = 0, elevated = false) {
    const parking = style === 'parking-outline';
    const color = style.startsWith('yellow') ? '#edc24f' : style.startsWith('blue') ? '#648fc0'
      : style === 'pink' ? '#df779e' : parking ? '#a59e92' : '#f2eee3';
    const combined = style.includes('-combined');
    const double = style.includes('-double') || combined;
    const dashed = style.endsWith('-dash') || combined;
    const width = style === 'stop' ? 0.31 : busLane && style === 'blue' ? 0.17 : 0.14;
    const solid = [points];
    // Use the original distance for dash phase across independently clipped
    // spans. Smoothing first would shorten a span and shift its dash ends.
    const painted = dashed ? surveyedDashSegments(points, style, busLane, dashOffsetM) : solid;
    const paint = (segments: Point[][], offset = 0) => {
      for (const segment of segments) {
        const line = parking ? segment : cleanMarking(segment, width / 2);
        if (line.length < 2) continue;
        const outline = paintRibbon(offset ? offsetMarking(line, offset) : line, width);
        const onRoad = clipper.clipOnce(outline, 0.018);
        outline.dispose();
        // The lifts of paint on the same deck differ by less than 0.1m.
        const exposed = elevated ? onRoad : crossingPaint?.subtract(onRoad, 0.1) ?? onRoad;
        if (exposed !== onRoad) onRoad.dispose();
        addPaint(color, exposed, width, elevated ? '고가 노면표시' : parking ? '주차구획 조사선' : undefined);
      }
    };
    if (double) {
      const offset = (busLane ? 0.14 : 0.15) * (style.endsWith('-reversed') ? -1 : 1);
      paint(combined ? solid : painted, -offset);
      paint(painted, offset);
    } else paint(painted);
  }
  for (const road of urban ? [] : roads) {
    if (finish && (road.id === opoEntranceBridgeId || road.id === opoEntranceTurnId)) continue;
    const width = streetWidth(road);
    const roadCrossings = [...(crossingsByRoad.get(road.id) ?? []), ...siteCrossings];
    const isPath = paths.has(road.category);
    const restricted = data.pavement?.paired && !road.motor && !isPath;
    const pedestrianLink = isPath || restricted;
    const isMain = major.has(road.category.replace('_link', ''));
    const within = (p: Point) => Math.max(Math.abs(p.x), Math.abs(p.z)) <= extent + 28;
    let run: Point[] = [];
    const unpaved = road.unpaved || road.category === 'track';
    const color = unpaved ? '#aa9981'
      : isPath ? '#bba994' : isMain ? '#626970' : road.category === 'residential' ? '#737878' : '#858780';
    const texture = unpaved ? 'forest'
      : pedestrianLink && (!restricted || road.surface !== 'asphalt') ? (urban ? 'pavers' : 'cobble') : 'asphalt';
    const restrictedAsphalt = restricted && texture === 'asphalt' ? '차량 통행 제한 포장' : undefined;
    const tint = finish ? (urban && texture === 'asphalt' ? '#e2ecf8' : isMain ? '#dfdedd' : '#fffaf3') : color;
    const pavedMotorRoad = road.motor && !isPath && !unpaved;
    const owners = elevatedRoads ? bridgeOwners.get(road.id) : undefined;
    function interruptedStrip(points: Point[], widthM: number, lift: number, color: string, texture?: TourSurface, shoulder = 0) {
      for (const run of leaveCrosswalkGaps(points, roadCrossings, shoulder)) strip(run, widthM, lift, color, texture, false, true, owners);
    }
    function urbanSidewalks(points: Point[], previous: boolean, next: boolean) {
      const gap = Math.max(3.5, Math.min(width * 0.44, 8));
      for (const [index, sign] of [1, -1].entries()) {
        const edge = width / 2 * sign;
        if (road.sidewalks[index]) {
          const survey = surveyedWalks.find(walk => walk.roadId === road.id && walk.side === sign)?.ends;
          for (const span of fallbackSpans(road, points)) {
            const lane = leaveJunctionGap(span, previous && span[0] === points[0] ? gap : 0,
              next && span.at(-1) === points.at(-1) ? gap : 0);
            if (lane.length < 2) continue;
            let fallback = [lane];
            if (survey) {
              const [a, b] = survey;
              const from = lane[0], to = lane[lane.length - 1];
              const forward = (to.x - from.x) * (b.x - a.x) + (to.z - from.z) * (b.z - a.z) >= 0;
              fallback = [splitLineAt(lane, forward ? a : b).before, splitLineAt(lane, forward ? b : a).after];
            }
            for (const run of fallback) {
              if (run.length < 2) continue;
              interruptedStrip(offsetLine(run, edge + sign * 0.89), 1.78, sidewalkLift, '#d4cec2', 'pavers', 1.9);
              interruptedStrip(offsetLine(run, edge + sign * 0.12), 0.19, sidewalkLift + 0.025, '#a5a4a0', undefined, 0.30);
            }
          }
        }
      }
    }
    const paint = (points: Point[]) => {
      if (points.length < 2) return;
      // An OSM crossing is still part of the walking network, but its pavement is the roadway.
      const surfaces = pedestrianLink && !road.bridge
        ? leaveCrosswalkGaps(points, paintCrossings, 0.04) : fallbackSpans(road, points);
      const approachEnds = new Set<Point>();
      if (pavedMotorRoad && exitApproaches.size) for (const line of surfaces) {
        const node = road.nodeIds[road.points.indexOf(line[0])];
        const approach = exitApproaches.get(`${road.id}:${node}`);
        if (!approach || approach.start !== line[0]) continue;
        // Start with the exact mapped cross-section and reach the inferred width on this segment.
        const deck = trimFallback(pavementArea(approach.pavement.rings, deckLift, 1.45));
        addGroundRoad(deck, tint, texture);
        line[0] = approach.end;
        approachEnds.add(approach.end);
      }
      for (const line of surfaces) {
        if (!finish || pedestrianLink || road.bridge) {
          strip(line, width + (pedestrianLink ? 0.14 : 0.42), deckLift - (urban ? 0.024 : 0.09), pedestrianLink ? '#a29477' : '#a29f91',
            undefined, false, false, owners, pavedMotorRoad);
        }
        strip(line, width, deckLift, tint, texture, pavedMotorRoad,
          !road.bridge && (pavedMotorRoad || !!municipalSurface), owners, false, restrictedAsphalt);
      }
      if (!pedestrianLink) for (const line of surfaces) {
        // The ribbon already joins its internal vertices. Round only its
        // ends in surveyed scenes, so bends cannot pave over adjacent medians.
        for (const point of (municipalSurface || (urban && width > 12) ? [line[0], line[line.length - 1]] : line)) {
          if (approachEnds.has(point) || continuationNormals.has(point)) continue;
          if (municipalSurface) {
            // A survey can end a fallback ribbon at a vertex in the middle
            // of a road. Only network ends and junctions can own a round cap.
            const index = road.points.indexOf(point);
            const junction = (joined.get(road.nodeIds[index]) ?? 0) >= 3;
            if (index < 0 || (!junction && index !== 0 && index !== road.points.length - 1)
              || municipalSurface.heightAt(point) !== undefined) continue;
          }
          let cap: T.BufferGeometry = new T.CircleGeometry(width / 2, 10);
          cap.rotateX(-Math.PI / 2).translate(point.x, 0, point.z);
          if (terrain) {
            cap = withBridgeGrade(terrain.fit(cap, deckLift - 0.015), owners);
          } else if (urban) {
            const positions = cap.getAttribute('position');
            for (let i = 0; i < positions.count; i++) positions.setY(i, surfaceAt(positions.getX(i), positions.getZ(i), owners) + deckLift - 0.015);
          } else cap.translate(0, surface(point.x, point.z) + 0.445, 0);
          const trimmed = owners && bridgeFootprint ? trimFallback(cap, bridgeFootprint)
            : pavedMotorRoad && !road.bridge ? trimFallback(cap) : cap;
          if (pavedMotorRoad && !owners && inferredGroundDeck) groundCaps.push({ geometry: trimmed, color: tint, texture });
          else if (pavedMotorRoad && !owners) addGroundRoad(trimmed, tint, texture);
          else add(tint, trimmed, texture, false, pavedMotorRoad && owners ? '고가 차도' : undefined);
        }
      }
      if (urban && road.motor) {
        let from = road.points.indexOf(points[0]);
        const limit = from + points.length - 1;
        for (let end = from + 1; end <= limit; end++) {
          if (end !== limit && (joined.get(road.nodeIds[end]) ?? 0) < 3) continue;
          const startAtJunction = (joined.get(road.nodeIds[from]) ?? 0) > 2;
          const endAtJunction = (joined.get(road.nodeIds[end]) ?? 0) > 2;
          urbanSidewalks(road.points.slice(from, end + 1), startAtJunction, endAtJunction);
          from = end;
        }
      }
      if (!urban) road.sidewalks.forEach((sidewalk, i) => {
        if (sidewalk) interruptedStrip(offsetLine(points, (width / 2 + 0.85) * (i ? -1 : 1)), 1.7, 0.57, '#c2b8a5', 'cobble', 1.9);
      });
      if (road.bridge) for (const bridgeLine of (owners ? surfaces : [points])) for (const side of [-1, 1]) {
        const edge = offsetLine(bridgeLine, width / 2 * side);
        strip(edge, 0.31, 0.69, '#b9b8ad', undefined, false, false, owners);
        if (!finish) {
          strip(edge, 0.12, 1.12, '#72857f', undefined, false, false, owners);
          continue;
        }
        const paint = '#515e60';
        const beam = new T.BoxGeometry(1, 1, 1);
        const transform = new T.Object3D();
        for (let i = 1; i < edge.length; i++) {
          const a = edge[i - 1], b = edge[i];
          const length = Math.hypot(b.x - a.x, b.z - a.z);
          if (length < 0.05) continue;
          const bays = Math.ceil(length / 1.45);
          const sample = (fraction: number, lift: number) => {
            const x = T.MathUtils.lerp(a.x, b.x, fraction), z = T.MathUtils.lerp(a.z, b.z, fraction);
            return new T.Vector3(x, surfaceAt(x, z, owners) + lift, z);
          };
          for (let bay = 0; bay < bays; bay++) {
            const at = bay / bays, next = (bay + 1) / bays;
            const post = sample(at, 1.08);
            if (owners && bridgeFootprint?.heightAt(post) !== undefined) continue;
            add(paint, beam.clone().scale(0.095, 0.91, 0.095).translate(post.x, post.y, post.z), undefined, true);
            for (const lift of [1.11, 1.53]) {
              const from = sample(at, lift), to = sample(next, lift);
              transform.position.copy(from).lerp(to, 0.5);
              transform.quaternion.setFromUnitVectors(T.Object3D.DEFAULT_UP, to.clone().sub(from).normalize());
              transform.scale.set(0.072, from.distanceTo(to) + 0.035, 0.072);
              transform.updateMatrix();
              add(paint, beam.clone().applyMatrix4(transform.matrix), undefined, true);
            }
          }
          const end = sample(1, 1.08);
          if (!owners || bridgeFootprint?.heightAt(end) === undefined) {
            add(paint, beam.clone().scale(0.095, 0.91, 0.095).translate(end.x, end.y, end.z), undefined, true);
          }
        }
        beam.dispose();
      }
    };
    let roadPoints = road.points;
    if (finish && road.id === opoEntranceDrivewayId && roadPoints.length > 2) {
      const [start, end, ...rest] = roadPoints;
      const fraction = Math.min(1, 9.8 / Math.hypot(end.x - start.x, end.z - start.z));
      roadPoints = [{ x: T.MathUtils.lerp(start.x, end.x, fraction), z: T.MathUtils.lerp(start.z, end.z, fraction) }, end, ...rest];
    }
    for (const point of roadPoints) {
      if (within(point)) run.push(point);
      else { paint(run); run = []; }
    }
    paint(run);
  }
  bridgeFootprint?.clear();
  // At junctions, the continuous road ribbons own the surface before end caps.
  for (const { geometry, color, texture } of groundCaps) addGroundRoad(geometry, color, texture);
  inferredGroundDeck?.clear();
  for (const area of data.parking) {
    const deck = urban ? pavementArea(area, 0.045, 2) : groundPolygon(area, (x, z) => surface(x, z) + 0.11);
    const exposed = municipalSurface?.subtract(deck) ?? deck;
    if (exposed !== deck) deck.dispose();
    add(finish ? '#ddd9cf' : '#90918a', exposed, 'asphalt', false, '주차 포장');
  }
  const busStops: Point[] = [], benches: Point[] = [];
  for (const item of data.streetPoints) {
    if (item.kind === 'bus') busStops.push(item.position);
    if (item.kind === 'bench') benches.push(item.position);
  }
  for (const crossing of crossings) zebra(crossing);
  for (const { rings } of servicePavements) {
    const deck = pavementArea(rings, deckLift, 1.45);
    const exposed = roadPaint?.subtract(deck) ?? deck;
    if (exposed !== deck) deck.dispose();
    add(asphalt, exposed, 'asphalt', false, '부지 안 포장');
  }
  fallbackExclusions?.clear();
  buildingFootprints?.clear();
  function flushLayers() {
    for (const { color, texture, geometry: geometries, castsShadow, paint, name } of layers.values()) {
      const geometry = mergeGeometries(geometries);
      geometries.forEach(item => item.dispose());
      if (!geometry) continue;
      const material = new T.MeshStandardMaterial({ color, roughness: 0.91, side: T.DoubleSide });
      if (paint) {
        material.transparent = true;
        material.depthWrite = false;
        material.polygonOffset = true;
        material.polygonOffsetUnits = -2;
        attachPaintFilter(geometry, material, paintViewport, paintProjection);
      }
      if (texture && finish) finish(material, texture);
      if (urban && texture === 'asphalt') material.color.multiplyScalar(1.42);
      const mesh = new T.Mesh(geometry, material);
      if (name) mesh.name = name;
      mesh.receiveShadow = true;
      mesh.castShadow = castsShadow;
      scene.add(mesh);
    }
    layers.clear();
  }
  flushLayers();

  function addSurveyedPaint(asphaltDecks: T.BufferGeometry[] = []) {
    for (const { deckId, style, points, busLane, dashOffsetM } of elevatedLines) {
      const clipper = bridgePaint.get(deckId);
      if (clipper && points.length >= 2) surveyedPaint(points.map(data.project), style, clipper, busLane, dashOffsetM, true);
    }
    for (const clipper of bridgePaint.values()) clipper.clear();
    bridgePaint.clear();
    if (!roadPaint) { flushLayers(); return; }
    for (const deck of asphaltDecks) roadPaint.addSurface(deck);
    // Let the surveyed stripes own the surface before any estimated paint.
    for (const { area, ring, paintAreas } of measuredCrossings) {
      const clipper = footprint(paintAreas ?? [[ring]], Infinity);
      const at = crosswalkFrame(area);
      const depth = area.depth / 2;
      for (const offset of surveyedZebraOffsets(area.section.width)) {
        const stripe = paintRibbon([at(-depth, offset), at(depth, offset)], surveyedZebraStripeM);
        const section = clipper.clip(stripe, 0);
        // Fit the surveyed paint to the asphalt, including the adjoining site driveway.
        addCrossingPaint('#eeeee4', roadPaint.clipOnce(section, 0.034), surveyedZebraStripeM);
        section.dispose();
        stripe.dispose();
      }
      clipper.clear();
    }
    for (const { mask, color, width } of deferredPaint) {
      addCrossingPaint(color, roadPaint.clipOnce(mask, 0.027), width);
      mask.dispose();
    }
    deferredPaint.length = 0;
    for (const { area, ring } of paintedHumps) {
      const mask = groundPolygon([ring], () => 0, Infinity, 0);
      const onRoad = roadPaint.clipOnce(mask, 0.024);
      const clipper = createSurfaceClipper();
      clipper.addSurface(onRoad);
      crossingPaint?.addSurface(onRoad);
      add('#e7b836', onRoad);
      const at = crosswalkFrame(area);
      const depth = area.depth / 2;
      const slant = depth * 0.22;
      const halfWidth = area.section.width / 2 + slant;
      for (let offset = -halfWidth + 0.35; offset < halfWidth; offset += 0.87) {
        const stripe = paintRibbon([at(-depth - 0.12, offset - slant), at(depth + 0.12, offset + slant)], 0.42);
        addPaint('#f1eee4', clipper.clip(stripe, 0.008), 0.42);
        stripe.dispose();
      }
      clipper.clear();
      mask.dispose();
    }
    for (const { style, points, busLane, dashOffsetM } of surveyedLines) {
      if (points.length >= 2) surveyedPaint(points, style, roadPaint, busLane, dashOffsetM);
    }
    flushLayers();
    crossingPaint?.clear();
    roadPaint.clear();
  }
  const markers = (geometry: T.BufferGeometry, color: string, points: Point[], height: number) => {
    const instances = new T.InstancedMesh(geometry, new T.MeshStandardMaterial({ color, roughness: 0.74 }), points.length);
    const local = new T.Matrix4();
    points.forEach((point, i) => instances.setMatrixAt(i, local.makeTranslation(point.x, surface(point.x, point.z) + height, point.z)));
    instances.receiveShadow = true;
    scene.add(instances);
  };
  markers(new T.CylinderGeometry(0.055, 0.065, 2.7, 8), '#687c79', busStops, 1.38);
  markers(new T.BoxGeometry(0.4, 0.6, 0.14), '#307a75', busStops, 2.57);
  markers(new T.BoxGeometry(1.45, 0.16, 0.48), '#88725a', benches, 0.62);
  markers(new T.BoxGeometry(1.15, 0.48, 0.12), '#53615b', benches, 0.31);
  const streetClearance = (point: Point) => {
    const position = new T.Vector2(point.x, point.z);
    if (data.pavement?.paired) {
      const walk = pedestrianPavements.find(({ rings, bounds }) => bounds.containsPoint(position) && inShape(point, rings));
      if (walk) return Math.max(0.01, nearestOnLine(point, walk.boundaries).distance);
      const lane = municipalRoads.find(({ rings, bounds }) => bounds.containsPoint(position) && inShape(point, rings));
      if (lane) return -nearestOnLine(point, lane.boundaries).distance;
    }
    let minimum = urban ? Infinity : network.nearby(point, 24).reduce((clearance, { segment, distance, t }) => {
      const key = `${segment.road.id}:${segment.aId}`;
      const approach = exitApproaches.get(key);
      return hasSurvey(segment.road.id, segment.aId)
        || (approach && t <= approach.fraction)
        || measuredSegments.get(key)?.some(([from, to]) => t >= from && t <= to)
        ? clearance : Math.min(clearance, distance - segment.width / 2);
    }, Infinity);
    for (const { ring, boundary, bounds } of streetPavements) {
      if (!bounds.containsPoint(position)) continue;
      const distance = nearestOnLine(point, [boundary]).distance;
      minimum = Math.min(minimum, inShape(point, [ring]) ? -distance : distance);
    }
    for (const { rings, boundaries, bounds } of municipalRoads) {
      if (!bounds.containsPoint(position)) continue;
      const distance = nearestOnLine(point, boundaries).distance;
      minimum = Math.min(minimum, inShape(point, rings) ? -distance : distance);
    }
    for (const { pavement: { rings, boundaries, bounds } } of exitApproaches.values()) {
      if (!bounds.containsPoint(position)) continue;
      const distance = nearestOnLine(point, boundaries).distance;
      minimum = Math.min(minimum, inShape(point, rings) ? -distance : distance);
    }
    if (minimum < 0) {
      for (const { ring, boundary, bounds } of surveyedWalks) {
        if (!bounds.containsPoint(position) || !inShape(point, [ring])) continue;
        minimum = Math.max(minimum, nearestOnLine(point, [boundary]).distance);
      }
      for (const { rings, boundaries, bounds } of trafficIslands) {
        if (!bounds.containsPoint(position) || !inShape(point, rings)) continue;
        minimum = Math.max(minimum, nearestOnLine(point, boundaries).distance);
      }
    }
    return minimum;
  };
  const roadClearance = (point: Point) => {
    const street = streetClearance(point);
    if (data.pavement?.paired && sidewalkElevation(point) !== undefined) return street;
    if (!sitePavement?.bounds.containsPoint(new T.Vector2(point.x, point.z))) return street;
    const distance = nearestOnLine(point, [sitePavement.boundary]).distance;
    return Math.min(street, inShape(point, [sitePavement.ring]) ? -distance : distance);
  };
  function drive(point: Point, current: Segment) {
    const next = network.drive(point, current);
    if (!next || !urban) return next;
    if (next.segment.road.bridge) {
      const supported = elevatedRoads?.some(({ roadIds, shapes, dividers }) =>
        roadIds.includes(next.segment.road.id) && shapes.some(shape => inShape(next.point, shape))
        && !dividers.some(divider => divider.shapes.some(shape => inShape(next.point, shape))));
      return supported ? next : undefined;
    }
    if (roadClearance(next.point) > 0) return undefined;
    return next;
  }
  function sidewalkElevation(point: Point) {
    const position = new T.Vector2(point.x, point.z);
    if (pedestrianPavements.some(({ rings, bounds }) => bounds.containsPoint(position) && inShape(point, rings))) {
      return surface(point.x, point.z) + sidewalkLift;
    }
  }
  function serviceElevation(point: Point) {
    const position = new T.Vector2(point.x, point.z);
    if (servicePavements.some(({ rings, bounds }) => bounds.containsPoint(position) && inShape(point, rings))) {
      return surface(point.x, point.z) + deckLift;
    }
  }
  function municipalRoadElevation(point: Point) {
    if (!data.pavement?.paired || sidewalkElevation(point) !== undefined) return undefined;
    const position = new T.Vector2(point.x, point.z);
    if (municipalRoads.some(({ rings, bounds }) => bounds.containsPoint(position) && inShape(point, rings))) {
      return surface(point.x, point.z) + deckLift;
    }
  }
  return { ...network, drive, surface, deckLift, roadClearance, streetClearance, addSurveyedPaint,
    drivingSurface: (point: Point, segment: Segment) => surfaceAt(point.x, point.z, elevatedRoads ? bridgeOwners.get(segment.road.id) : undefined),
    sidewalkElevation, serviceElevation, municipalTreeHeights,
    municipalPaving: municipalSurface && { footprint: municipalSurface, roadElevation: municipalRoadElevation, sidewalkElevation },
    setPaintViewport: (width: number, height: number) => paintViewport.value.set(Math.max(1, width), Math.max(1, height)),
    setPaintProjection: (height: number, fov: number) => {
      paintProjection.value = height / (2 * Math.tan(T.MathUtils.degToRad(fov / 2)));
    } };
}
