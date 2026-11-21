import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { extent, inShape, nearestOnLine, splitLineAt, type OpoData, type Point, type Shape, type Street, type StreetPaint } from './opo-data';
import { sidewalkFascia, sidewalkRise, type createSidewalkSeams } from './opo-curb-walk';
import { opoEntranceBridgeId, opoEntranceDrivewayId, opoEntranceTurnId } from './opo-entrance';
import { surfaceUV, type TourMaterials, type TourSurface } from './opo-materials';
import { groundPolygon, ribbon, streetDeckLift, terrainSurface, type createTerrainProjection } from './opo-meshes';
import { crossingOutline, crosswalkFrame, fitCrosswalk, fitCrosswalkDeck, leaveCrosswalkGaps, sameCrosswalk, zebraOffsets, type Crosswalk } from './opo-crosswalks';
import { siteSurfaces } from './data/site-surfaces';
import { projectSiteCrossing, sidewalkTreeWell } from './opo-site-surfaces';
import { createSurfaceClipper } from './opo-surface-clip';

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

  function raiseBridge(point: Point) {
    const nearby = bridges.get(`${Math.floor(point.x / cellSize)},${Math.floor(point.z / cellSize)}`);
    if (!nearby) return 0;
    let height = 0;
    for (const segment of nearby) {
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
  const line = points.filter((point, i) => !i || Math.hypot(point.x - points[i - 1].x, point.z - points[i - 1].z) >= 0.01);
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

function lineChunks(points: Point[], run: number, gap: number): Point[][] {
  const chunks: Point[][] = [];
  let remaining = run, segment: Point[] = [points[0]], paint = true;
  for (let i = 1; i < points.length; i++) {
    const end = points[i];
    let start = points[i - 1], distance = Math.hypot(end.x - start.x, end.z - start.z);
    while (distance > remaining) {
      const t = remaining / distance;
      const split = { x: start.x + (end.x - start.x) * t, z: start.z + (end.z - start.z) * t };
      if (paint) chunks.push([...segment, split]);
      paint = !paint;
      segment = [split];
      distance -= remaining;
      remaining = paint ? run : gap;
      start = split;
    }
    if (paint) segment.push(end);
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

export function addStreets(data: OpoData, scene: T.Scene, finish?: TourMaterials,
  terrain?: ReturnType<typeof createTerrainProjection>, insideBuilding?: (position: Point) => boolean,
  sidewalkSeams?: ReturnType<typeof createSidewalkSeams>) {
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
  const paintedHumps = survey?.paintedHumps?.records.map(hump => projectSiteCrossing(data.project, hump)) ?? [];
  const roadPaint = surveyedLines.length || paintedHumps.length || site?.layout.surveyedCrossings?.length || data.servicePaving.length
    ? createSurfaceClipper() : undefined;
  const crossingPaint = surveyedLines.length ? createSurfaceClipper() : undefined;
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
  const pedestrianPavements = [...municipalWalks, ...trafficIslands];
  const measuredSegments = new Map<string, [number, number][]>((data.pavement?.coveredSegments ?? []).map(([road, node, spans]) => [
    `${road}:${node}`, spans,
  ] as const));
  const exactCrossings = (site?.layout.surveyedCrossings ?? []).map(crossing => projectSiteCrossing(data.project, crossing));
  const exitApproaches = new Map<string, {
    start: Point; end: Point; fraction: number; pavement: ReturnType<typeof pavementBounds>;
  }>();
  for (const { roadId, nodes: [, node], endEdge } of pavementSources) {
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
  const siteCrossings = exactCrossings.map(crossing => crossing.area);
  const crossings: Crosswalk[] = [];
  const crossingsByRoad = new Map<number, Crosswalk[]>();
  const crossingSurveys = new Set<Crosswalk>();
  function addCrossing(outline: Point[], center: Point, confirmed: boolean) {
    if (exactCrossings.some(({ ring, boundary }) => inShape(center, [ring]) || nearestOnLine(center, [boundary]).distance < 4)) return;
    const radius = Math.min(45, Math.max(4, ...outline.map(point => Math.hypot(point.x - center.x, point.z - center.z))));
    for (const approximation of fitCrosswalk(outline, network.nearby(center, radius), confirmed)) {
      const patch = surveyedPavements.find(patch => !patch.siteDriveway && patch.roadId === approximation.section.road.id
        && inShape(approximation.center, [patch.ring]));
      const crossing = patch ? fitCrosswalkDeck(approximation, patch.ring) : approximation;
      if (crossings.some(existing => sameCrosswalk(existing, crossing))) continue;
      if (patch) crossingSurveys.add(crossing);
      crossings.push(crossing);
      const id = crossing.section.road.id;
      const entries = crossingsByRoad.get(id) ?? [];
      entries.push(crossing);
      crossingsByRoad.set(id, entries);
    }
  }
  function surveyedCrossings(confirmed: boolean) {
    for (const record of survey?.crosswalks ?? []) {
      if (record.inventoryMatch !== confirmed) continue;
      for (const ring of record.surfaces) {
        const outline = ring.map(data.project);
        const center = outline.reduce((sum, point) => ({ x: sum.x + point.x / outline.length, z: sum.z + point.z / outline.length }), { x: 0, z: 0 });
        // Inside a reviewed drive, use the site markings instead of fitting unverified paint to a nearby street.
        if (!confirmed && tracedDrive && inShape(center, [tracedDrive])) continue;
        addCrossing(outline, center, confirmed);
      }
    }
  }
  surveyedCrossings(true);
  for (const [a, b] of data.crossingWays) {
    addCrossing(crossingOutline(a, b), { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, true);
  }
  for (const item of data.streetPoints) if (item.kind === 'crossing') addCrossing([], item.position, true);
  surveyedCrossings(false);
  const paintCrossings = [...crossings, ...siteCrossings];
  const joined = new Map<number, number>();
  if (urban) for (const road of roads) {
    if (road.motor) road.nodeIds.forEach((id, i) => {
      const edges = i > 0 && i < road.nodeIds.length - 1 ? 2 : 1;
      joined.set(id, (joined.get(id) ?? 0) + edges);
    });
  }
  const surface = (x: number, z: number) => terrainSurface(data.ground, x, z) + network.raiseBridge({ x, z });
  function withBridgeGrade(geometry: T.BufferGeometry) {
    const position = geometry.getAttribute('position');
    let raised = false;
    for (let i = 0; i < position.count; i++) {
      const lift = network.raiseBridge({ x: position.getX(i), z: position.getZ(i) });
      if (!lift) continue;
      position.setY(i, position.getY(i) + lift);
      raised = true;
    }
    if (raised) geometry.computeVertexNormals();
    return geometry;
  }
  function pavementArea(rings: Point[][], lift: number, maxEdge: number) {
    return terrain ? withBridgeGrade(terrain.area(rings, lift)) : groundPolygon(rings, surface, maxEdge, lift);
  }
  function pavementStrip(points: Point[], width: number, lift: number) {
    return terrain ? withBridgeGrade(terrain.fit(ribbon(points, width, () => 0), lift))
      : ribbon(points, width, (x, z) => surface(x, z) + lift, urban ? 1.25 : Infinity);
  }
  const paintProjection = { value: 1 };
  const fallbackExclusions = (data.pavement || tracedDrive) && createSurfaceClipper();
  if (fallbackExclusions && tracedDrive) {
    const outline = groundPolygon([tracedDrive], () => 0, Infinity, 0);
    fallbackExclusions.addSurface(outline);
    outline.dispose();
  }
  const deferredPaint: { mask: T.BufferGeometry; color: string; width: number }[] = [];
  const layers = new Map<string, {
    color: string; texture?: TourSurface; geometry: T.BufferGeometry[]; castsShadow: boolean; paint: boolean;
  }>();
  function add(color: string, geometry: T.BufferGeometry, texture?: TourSurface, castsShadow = false) {
    if (!geometry.getAttribute('position')?.count) { geometry.dispose(); return; }
    if (geometry.index) {
      const flat = geometry.toNonIndexed();
      geometry.dispose();
      geometry = flat;
    }
    if (texture && finish) surfaceUV(geometry, texture);
    else geometry.deleteAttribute('uv');
    const paint = !!geometry.getAttribute('paintWidth');
    const key = `${color}:${texture ?? ''}:${castsShadow}:${paint}`;
    const layer = layers.get(key);
    if (layer) layer.geometry.push(geometry);
    else layers.set(key, { color, texture, geometry: [geometry], castsShadow, paint });
  }
  function addPaint(color: string, geometry: T.BufferGeometry, width: number) {
    const position = geometry.getAttribute('position');
    if (urban && position?.count) {
      geometry.setAttribute('paintWidth', new T.BufferAttribute(new Float32Array(position.count).fill(width), 1));
    }
    add(color, geometry);
  }
  function addCrossingPaint(color: string, geometry: T.BufferGeometry, width: number) {
    crossingPaint?.addSurface(geometry);
    addPaint(color, geometry, width);
  }
  function crossingStrip(points: Point[], width: number, height: number, color: string) {
    if (data.pavement && roadPaint) deferredPaint.push({ mask: ribbon(points, width, () => 0), color, width });
    else addCrossingPaint(color, pavementStrip(points, width, height), width);
  }
  function trimFallback(geometry: T.BufferGeometry) {
    if (!fallbackExclusions) return geometry;
    const exposed = fallbackExclusions.subtract(geometry);
    geometry.dispose();
    return exposed;
  }
  function strip(points: Point[], width: number, height: number, color: string, texture?: TourSurface,
    roadDeck = false, trim = false) {
    let geometry = texture ? pavementStrip(points, width, height)
      : ribbon(points, width, (x, z) => surface(x, z) + height, urban ? 1.25 : Infinity);
    if (trim) geometry = trimFallback(geometry);
    if (roadDeck) roadPaint?.addSurface(geometry);
    add(color, geometry, texture);
  }
  const asphalt = finish ? '#e2ecf8' : '#737878';
  const priorityRoads = createSurfaceClipper();
  function addSurveyedRoad(ring: Point[]) {
    // Where a junction and a surveyed road overlap, keep the junction's top surface.
    const deck = pavementArea([ring], deckLift, 1.45);
    const exposed = priorityRoads.subtract(deck);
    deck.dispose();
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
      ...[...surveyedPavements, ...junctionPavements, ...surveyedWalks].map(({ ring }) => [ring]),
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
    for (const offset of zebraOffsets(width)) {
      const line = [position(-half, offset), position(half, offset)];
      if (surveyedDeck && roadPaint) {
        const outline = ribbon(line, 0.44, () => 0);
        addCrossingPaint(tone, roadPaint.clip(outline, 0.026), 0.44);
        outline.dispose();
      } else crossingStrip(line, 0.44, deckLift + 0.075, tone);
    }

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
  function surveyedPaint(points: Point[], style: StreetPaint, clipper: ReturnType<typeof createSurfaceClipper>) {
    const color = style.startsWith('yellow') ? '#edc24f' : style.startsWith('blue') ? '#648fc0' : '#f2eee3';
    const double = style === 'yellow-double' || style === 'yellow-combined';
    const width = style === 'stop' ? 0.31 : 0.14;
    const paint = (line: Point[], dashed: boolean) => {
      const segments = dashed ? lineChunks(line, style === 'yellow-dash' ? 2.7 : 4, 4.5) : [line];
      for (const segment of segments) {
        const outline = ribbon(segment, width, () => 0);
        const onRoad = clipper.clip(outline, 0.018);
        outline.dispose();
        // The lifts of paint on the same deck differ by less than 0.1m.
        const exposed = crossingPaint?.subtract(onRoad, 0.1) ?? onRoad;
        if (exposed !== onRoad) onRoad.dispose();
        addPaint(color, exposed, width);
      }
    };
    if (double) {
      paint(offsetMarking(points, -0.15), false);
      paint(offsetMarking(points, 0.15), style === 'yellow-combined');
    } else paint(points, style.endsWith('-dash'));
  }
  for (const road of roads) {
    if (finish && (road.id === opoEntranceBridgeId || road.id === opoEntranceTurnId)) continue;
    const width = streetWidth(road);
    const roadCrossings = [...(crossingsByRoad.get(road.id) ?? []), ...siteCrossings];
    const isPath = paths.has(road.category);
    const isMain = major.has(road.category.replace('_link', ''));
    const within = (p: Point) => Math.max(Math.abs(p.x), Math.abs(p.z)) <= extent + 28;
    let run: Point[] = [];
    const unpaved = road.unpaved || road.category === 'track';
    const color = unpaved ? '#aa9981'
      : isPath ? '#bba994' : isMain ? '#626970' : road.category === 'residential' ? '#737878' : '#858780';
    const texture = unpaved ? 'forest' : isPath ? (urban ? 'pavers' : 'cobble') : 'asphalt';
    const tint = finish ? (urban && texture === 'asphalt' ? '#e2ecf8' : isMain ? '#dfdedd' : '#fffaf3') : color;
    const pavedMotorRoad = road.motor && !isPath && !unpaved;
    function interruptedStrip(points: Point[], widthM: number, lift: number, color: string, texture?: TourSurface, shoulder = 0) {
      for (const run of leaveCrosswalkGaps(points, roadCrossings, shoulder)) strip(run, widthM, lift, color, texture, false, true);
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
      const surfaces = isPath && !road.bridge ? leaveCrosswalkGaps(points, paintCrossings, 0.04) : fallbackSpans(road, points);
      const approachEnds = new Set<Point>();
      if (pavedMotorRoad && exitApproaches.size) for (const line of surfaces) {
        const node = road.nodeIds[road.points.indexOf(line[0])];
        const approach = exitApproaches.get(`${road.id}:${node}`);
        if (!approach || approach.start !== line[0]) continue;
        // Start with the exact mapped cross-section and reach the inferred width on this segment.
        const deck = trimFallback(pavementArea(approach.pavement.rings, deckLift, 1.45));
        roadPaint?.addSurface(deck);
        add(tint, deck, texture);
        line[0] = approach.end;
        approachEnds.add(approach.end);
      }
      for (const line of surfaces) {
        if (!finish || isPath || road.bridge) {
          strip(line, width + (isPath ? 0.14 : 0.42), deckLift - (urban ? 0.024 : 0.09), isPath ? '#a29477' : '#a29f91');
        }
        strip(line, width, deckLift, tint, texture, pavedMotorRoad, pavedMotorRoad && !road.bridge);
      }
      if (!isPath) for (const line of surfaces) {
        for (const point of (urban && width > 12 ? [line[0], line[line.length - 1]] : line)) {
          if (approachEnds.has(point)) continue;
          let cap: T.BufferGeometry = new T.CircleGeometry(width / 2, 10);
          cap.rotateX(-Math.PI / 2).translate(point.x, 0, point.z);
          if (terrain) {
            cap = withBridgeGrade(terrain.fit(cap, deckLift - 0.015));
          } else if (urban) {
            const positions = cap.getAttribute('position');
            for (let i = 0; i < positions.count; i++) positions.setY(i, surface(positions.getX(i), positions.getZ(i)) + deckLift - 0.015);
          } else cap.translate(0, surface(point.x, point.z) + 0.445, 0);
          const trimmed = pavedMotorRoad && !road.bridge ? trimFallback(cap) : cap;
          if (pavedMotorRoad) roadPaint?.addSurface(trimmed);
          add(tint, trimmed, texture);
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
      if (road.bridge) for (const side of [-1, 1]) {
        const edge = offsetLine(points, width / 2 * side);
        strip(edge, 0.31, 0.69, '#b9b8ad');
        if (!finish) {
          strip(edge, 0.12, 1.12, '#72857f');
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
            return new T.Vector3(x, surface(x, z) + lift, z);
          };
          for (let bay = 0; bay < bays; bay++) {
            const at = bay / bays, next = (bay + 1) / bays;
            const post = sample(at, 1.08);
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
          add(paint, beam.clone().scale(0.095, 0.91, 0.095).translate(end.x, end.y, end.z), undefined, true);
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
  for (const area of data.parking) add(finish ? '#ddd9cf' : '#90918a',
    urban ? pavementArea(area, 0.045, 2) : groundPolygon(area, (x, z) => surface(x, z) + 0.11), 'asphalt');
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
    add(asphalt, exposed, 'asphalt');
  }
  fallbackExclusions?.clear();
  function flushLayers() {
    for (const { color, texture, geometry: geometries, castsShadow, paint } of layers.values()) {
      const geometry = mergeGeometries(geometries);
      geometries.forEach(item => item.dispose());
      if (!geometry) continue;
      const material = new T.MeshStandardMaterial({ color, roughness: 0.91, side: T.DoubleSide });
      if (paint) {
        material.transparent = true;
        material.depthWrite = false;
        material.polygonOffset = true;
        material.polygonOffsetUnits = -2;
        material.onBeforeCompile = shader => {
          shader.uniforms.paintProjection = paintProjection;
          shader.vertexShader = 'attribute float paintWidth; varying float vPaintWidth;\n'
            + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaintWidth = paintWidth;');
          shader.fragmentShader = 'uniform float paintProjection; varying float vPaintWidth;\n'
            + shader.fragmentShader.replace('#include <alphatest_fragment>', `
              float paintPixels = paintProjection * vPaintWidth / max(0.01, vViewPosition.z);
              diffuseColor.a *= smoothstep(0.23, 0.95, paintPixels);
              #include <alphatest_fragment>`);
        };
      }
      if (texture && finish) finish(material, texture);
      if (urban && texture === 'asphalt') material.color.multiplyScalar(1.42);
      const mesh = new T.Mesh(geometry, material);
      mesh.receiveShadow = true;
      mesh.castShadow = castsShadow;
      scene.add(mesh);
    }
    layers.clear();
  }
  flushLayers();

  function addSurveyedPaint(asphaltDecks: T.BufferGeometry[] = []) {
    if (!roadPaint) { flushLayers(); return; }
    for (const deck of asphaltDecks) roadPaint.addSurface(deck);
    for (const { mask, color, width } of deferredPaint) {
      addCrossingPaint(color, roadPaint.clip(mask, 0.027), width);
      mask.dispose();
    }
    deferredPaint.length = 0;
    for (const { area, ring } of exactCrossings) {
      const mask = groundPolygon([ring], () => 0, Infinity, 0);
      const clipper = createSurfaceClipper();
      clipper.addSurface(mask);
      const at = crosswalkFrame(area);
      const depth = area.depth / 2;
      for (const offset of zebraOffsets(area.section.width)) {
        const stripe = ribbon([at(-depth, offset), at(depth, offset)], 0.44, () => 0);
        const section = clipper.clip(stripe, 0);
        // Fit the surveyed paint to the asphalt, including the adjoining site driveway.
        addCrossingPaint('#eeeee4', roadPaint.clip(section, 0.034), 0.44);
        section.dispose();
        stripe.dispose();
      }
      clipper.clear();
      mask.dispose();
    }
    for (const { area, ring } of paintedHumps) {
      const mask = groundPolygon([ring], () => 0, Infinity, 0);
      const onRoad = roadPaint.clip(mask, 0.024);
      const clipper = createSurfaceClipper();
      clipper.addSurface(onRoad);
      crossingPaint?.addSurface(onRoad);
      add('#e7b836', onRoad);
      const at = crosswalkFrame(area);
      const depth = area.depth / 2;
      const slant = depth * 0.22;
      const halfWidth = area.section.width / 2 + slant;
      for (let offset = -halfWidth + 0.35; offset < halfWidth; offset += 0.87) {
        const stripe = ribbon([at(-depth - 0.12, offset - slant), at(depth + 0.12, offset + slant)], 0.42, () => 0);
        addPaint('#f1eee4', clipper.clip(stripe, 0.008), 0.42);
        stripe.dispose();
      }
      clipper.clear();
      mask.dispose();
    }
    for (const { style, points } of surveyedLines) {
      // Smooth the rendered paint within its width, keeping the original samples for road-width estimates.
      const line = cleanMarking(points, style === 'stop' ? 0.04 : 0.14);
      if (line.length >= 2) surveyedPaint(line, style, roadPaint);
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
    let minimum = network.nearby(point, 24).reduce((clearance, { segment, distance, t }) => {
      const key = `${segment.road.id}:${segment.aId}`;
      const approach = exitApproaches.get(key);
      return hasSurvey(segment.road.id, segment.aId)
        || (approach && t <= approach.fraction)
        || measuredSegments.get(key)?.some(([from, to]) => t >= from && t <= to)
        ? clearance : Math.min(clearance, distance - segment.width / 2);
    }, Infinity);
    const position = new T.Vector2(point.x, point.z);
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
    if (!sitePavement?.bounds.containsPoint(new T.Vector2(point.x, point.z))) return street;
    const distance = nearestOnLine(point, [sitePavement.boundary]).distance;
    return Math.min(street, inShape(point, [sitePavement.ring]) ? -distance : distance);
  };
  function drive(point: Point, current: Segment) {
    const next = network.drive(point, current);
    if (!next || (urban && roadClearance(next.point) > 0)) return undefined;
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
  return { ...network, drive, surface, deckLift, roadClearance, streetClearance, addSurveyedPaint,
    sidewalkElevation, serviceElevation, municipalTreeHeights,
    setPaintProjection: (height: number, fov: number) => {
      paintProjection.value = height / (2 * Math.tan(T.MathUtils.degToRad(fov / 2)));
    } };
}
