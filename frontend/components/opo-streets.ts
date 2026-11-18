import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { extent, type OpoData, type Point, type Street, type StreetPaint } from './opo-data';
import { opoEntranceBridgeId, opoEntranceDrivewayId, opoEntranceTurnId } from './opo-entrance';
import { surfaceUV, type TourMaterials, type TourSurface } from './opo-materials';
import { groundPolygon, ribbon, terrainSurface } from './opo-meshes';
import { crossingOutline, crosswalkFrame, fitCrosswalk, leaveCrosswalkGaps, sameCrosswalk, zebraOffsets, type Crosswalk } from './opo-crosswalks';
import { siteSurfaces } from './data/site-surfaces';
import { gateCrosswalkArea } from './opo-site-surfaces';

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
type RoadPosition = { segment: Segment; point: Point; distance: number };
const cellSize = 36;

function segmentLocation(position: Point, segment: Segment): RoadPosition {
  const { a, b, length } = segment;
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = T.MathUtils.clamp(((position.x - a.x) * dx + (position.z - a.z) * dz) / length ** 2, 0, 1);
  const point = { x: a.x + t * dx, z: a.z + t * dz };
  return { segment, point, distance: Math.hypot(position.x - point.x, position.z - point.z) };
}

export function createStreetNetwork(roads: Street[]) {
  const cells = new Map<string, Segment[]>();
  const junctions = new Map<number, Segment[]>();
  const bridges: Segment[] = [];
  const append = <K>(index: Map<K, Segment[]>, key: K, segment: Segment) => {
    const entries = index.get(key);
    if (entries) entries.push(segment);
    else index.set(key, [segment]);
  };
  for (const road of roads) {
    const width = streetWidth(road);
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i];
      const length = Math.hypot(a.x - b.x, a.z - b.z);
      if (length < 0.05) continue;
      const segment = { road, a, b, aId: road.nodeIds[i - 1], bId: road.nodeIds[i], length, width };
      if (road.bridge) bridges.push(segment);
      if (!road.motor) continue;
      append(junctions, segment.aId, segment);
      append(junctions, segment.bId, segment);
      const lowX = Math.floor((Math.min(a.x, b.x) - width) / cellSize);
      const highX = Math.floor((Math.max(a.x, b.x) + width) / cellSize);
      const lowZ = Math.floor((Math.min(a.z, b.z) - width) / cellSize);
      const highZ = Math.floor((Math.max(a.z, b.z) + width) / cellSize);
      for (let x = lowX; x <= highX; x++) for (let z = lowZ; z <= highZ; z++) append(cells, `${x},${z}`, segment);
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
    let height = 0;
    for (const segment of bridges) {
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

export function addStreets(data: OpoData, scene: T.Scene, finish?: TourMaterials) {
  const songpa = data.region === 'songpa';
  const centerlines = createStreetNetwork(data.streets);
  const survey = data.roadMarkings;
  const surveyedLines = survey?.lanes.map(lane => ({ ...lane, points: lane.points.map(data.project) })) ?? [];
  const surveyedWays = new Set<number>();
  const edgeOffsets = new Map<number, number[]>();
  for (const { points, edge } of surveyedLines) for (const [index, a] of points.slice(0, -1).entries()) {
    const b = points[index + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    const samples = Math.max(1, Math.ceil(length / 7));
    for (let i = 0; i < samples; i++) {
      const t = (i + 0.5) / samples;
      const hit = centerlines.nearest({ x: a.x + dx * t, z: a.z + dz * t }, 22);
      if (!hit) continue;
      const { segment, distance } = hit;
      if (distance <= segment.width / 2 + 1.4) surveyedWays.add(segment.road.id);
      if (!edge || segment.road.width || length < 1 || distance < segment.width / 2 - 0.3 || distance > segment.width / 2 + 1.65) continue;
      const alignment = Math.abs(dx * (segment.b.x - segment.a.x) + dz * (segment.b.z - segment.a.z)) / (length * segment.length);
      if (alignment < 0.9) continue;
      const offsets = edgeOffsets.get(segment.road.id) ?? [];
      offsets.push(distance);
      edgeOffsets.set(segment.road.id, offsets);
    }
  }
  const roads = data.streets.map(road => {
    const offsets = edgeOffsets.get(road.id);
    if (!offsets || offsets.length < 3) return road;
    const robustEdge = offsets.sort((a, b) => a - b)[Math.floor((offsets.length - 1) * 0.75)];
    return { ...road, width: Math.max(streetWidth(road), 2 * (robustEdge + 0.18)) };
  });
  const network = edgeOffsets.size ? createStreetNetwork(roads) : centerlines;
  const crossings: Crosswalk[] = [];
  const crossingsByRoad = new Map<number, Crosswalk[]>();
  function addCrossing(outline: Point[], center: Point, confirmed: boolean) {
    const radius = Math.min(45, Math.max(4, ...outline.map(point => Math.hypot(point.x - center.x, point.z - center.z))));
    for (const crossing of fitCrosswalk(outline, network.nearby(center, radius), confirmed)) {
      if (crossings.some(existing => sameCrosswalk(existing, crossing))) continue;
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
  const gate = siteSurfaces[data.region]?.gate;
  const paintCrossings = gate ? [...crossings, gateCrosswalkArea(data.project, gate)] : crossings;
  const joined = new Map<number, number>();
  if (songpa) for (const road of roads) {
    if (road.motor) road.nodeIds.forEach((id, i) => {
      const edges = i > 0 && i < road.nodeIds.length - 1 ? 2 : 1;
      joined.set(id, (joined.get(id) ?? 0) + edges);
    });
  }
  const surface = (x: number, z: number) => terrainSurface(data.ground, x, z) + network.raiseBridge({ x, z });
  const layers = new Map<string, { color: string; texture?: TourSurface; geometry: T.BufferGeometry[]; castsShadow: boolean }>();
  function add(color: string, geometry: T.BufferGeometry, texture?: TourSurface, castsShadow = false) {
    if (!geometry.getAttribute('position')?.count) { geometry.dispose(); return; }
    if (geometry.index) {
      const flat = geometry.toNonIndexed();
      geometry.dispose();
      geometry = flat;
    }
    if (texture && finish) surfaceUV(geometry, texture);
    else geometry.deleteAttribute('uv');
    const key = `${color}:${texture ?? ''}:${castsShadow}`;
    const layer = layers.get(key);
    if (layer) layer.geometry.push(geometry);
    else layers.set(key, { color, texture, geometry: [geometry], castsShadow });
  }
  function strip(points: Point[], width: number, height: number, color: string, texture?: TourSurface) {
    add(color, ribbon(points, width, (x, z) => surface(x, z) + height, songpa ? 1.25 : Infinity), texture);
  }
  function zebra(crossing: Crosswalk) {
    const { depth, section: { width, road }, confirmed } = crossing;
    const position = crosswalkFrame(crossing);
    const tone = confirmed ? '#eeeee4' : '#dedbd0';
    const half = depth / 2;
    for (const offset of zebraOffsets(width)) strip([position(-half, offset), position(half, offset)], 0.44, 0.545, tone);

    road.sidewalks.forEach((present, index) => {
      if (!present) return;
      const side = index === 0 ? 1 : -1;
      const at = (out: number) => side * (width / 2 + out);
      const rampDepth = half + 0.14;
      const sidewalkLift = songpa ? 0.61 : 0.57;
      // A modeled landing joins the painted road to the adjacent mapped sidewalk.
      const ramp = ribbon([position(0, at(-0.03)), position(0, at(0.92))], rampDepth * 2, (x, z) => {
        const lateral = (x - crossing.center.x) * crossing.direction.z - (z - crossing.center.z) * crossing.direction.x;
        const lift = T.MathUtils.lerp(0.48, sidewalkLift, T.MathUtils.clamp((lateral * side - width / 2) / 0.85, 0, 1));
        return surface(x, z) + lift;
      }, 0.7);
      const paving = songpa ? 'pavers' : 'cobble';
      add('#c6c2b5', ramp, paving);
      strip([position(-rampDepth, at(1.34)), position(rampDepth, at(1.34))], 0.88, sidewalkLift + 0.004, '#d4cec2', paving);
    });
  }
  function surveyedPaint(points: Point[], style: StreetPaint) {
    const color = style.startsWith('yellow') ? '#edc24f' : style.startsWith('blue') ? '#648fc0' : '#f2eee3';
    const double = style === 'yellow-double' || style === 'yellow-combined';
    const paint = (line: Point[], dashed: boolean) => {
      const segments = dashed ? lineChunks(line, style === 'yellow-dash' ? 2.7 : 4, 4.5) : [line];
      for (const segment of segments) for (const piece of leaveCrosswalkGaps(segment, paintCrossings)) {
        strip(piece, style === 'stop' ? 0.31 : 0.14, 0.55, color);
      }
    };
    if (double) {
      paint(offsetLine(points, -0.15), false);
      paint(offsetLine(points, 0.15), style === 'yellow-combined');
    } else paint(points, style.endsWith('-dash'));
  }
  for (const road of roads) {
    if (finish && (road.id === opoEntranceBridgeId || road.id === opoEntranceTurnId)) continue;
    const width = streetWidth(road);
    const roadCrossings = crossingsByRoad.get(road.id) ?? [];
    const isPath = paths.has(road.category);
    const isMain = major.has(road.category.replace('_link', ''));
    const within = (p: Point) => Math.max(Math.abs(p.x), Math.abs(p.z)) <= extent + 28;
    let run: Point[] = [];
    const unpaved = road.unpaved || road.category === 'track';
    const color = unpaved ? '#aa9981'
      : isPath ? '#bba994' : isMain ? '#626970' : road.category === 'residential' ? '#737878' : '#858780';
    const texture = unpaved ? 'forest' : isPath ? (songpa ? 'pavers' : 'cobble') : 'asphalt';
    const tint = finish ? (songpa && texture === 'asphalt' ? '#e2ecf8' : isMain ? '#dfdedd' : '#fffaf3') : color;
    function interruptedStrip(points: Point[], widthM: number, lift: number, color: string, texture?: TourSurface, shoulder = 0) {
      for (const run of leaveCrosswalkGaps(points, roadCrossings, shoulder)) strip(run, widthM, lift, color, texture);
    }
    function songpaPaint(points: Point[], previous: boolean, next: boolean) {
      const gap = Math.max(3.5, Math.min(width * 0.44, 8));
      const laneLine = leaveJunctionGap(points, previous ? gap : 0, next ? gap : 0);
      if (laneLine.length < 2) return;
      const count = Math.floor(road.lanes ?? 0);
      const arterial = isMain && count >= 2;
      const approximatePaint = road.markings && !unpaved && !surveyedWays.has(road.id);
      if (approximatePaint && count >= 2) {
        const opposite = road.backwardLanes ?? Math.ceil(count / 2);
        const spacing = (width - (arterial ? 0.88 : 0.46)) / count;
        for (let lane = 1; lane < count; lane++) {
          const offset = spacing * (count / 2 - lane);
          const axis = offsetLine(laneLine, offset);
          if (!road.oneWay && lane === opposite) {
            for (const delta of (count >= 4 ? [-0.14, 0.14] : [0])) {
              interruptedStrip(offsetLine(laneLine, offset + delta), 0.13, 0.523, '#e9bd51');
            }
          } else {
            for (const dash of lineChunks(axis, arterial ? 4.5 : 2.7, arterial ? 6.5 : 4.4)) interruptedStrip(dash, 0.14, 0.525, '#ebe9e0');
          }
        }
      }
      for (const [index, sign] of [1, -1].entries()) {
        const edge = width / 2 * sign;
        if (arterial && approximatePaint) interruptedStrip(offsetLine(laneLine, edge - sign * 0.32), 0.15, 0.519, '#eeeae2');
        if (road.sidewalks[index]) {
          interruptedStrip(offsetLine(laneLine, edge + sign * 0.89), 1.78, 0.61, '#d4cec2', 'pavers', 1.9);
          interruptedStrip(offsetLine(laneLine, edge + sign * 0.12), 0.19, 0.635, '#a5a4a0', undefined, 0.30);
        }
      }
    }
    const paint = (points: Point[]) => {
      if (points.length < 2) return;
      // An OSM crossing is still part of the walking network, but its pavement is the roadway.
      const surfaces = isPath && !road.bridge ? leaveCrosswalkGaps(points, paintCrossings, 0.04) : [points];
      for (const line of surfaces) {
        if (!finish || isPath || road.bridge) {
          strip(line, width + (isPath ? 0.14 : 0.42), 0.38, isPath ? '#a29477' : '#a29f91');
        }
        strip(line, width, 0.47, tint, texture);
      }
      if (!isPath) {
        for (const point of (songpa && width > 12 ? [points[0], points[points.length - 1]] : points)) {
          const cap = new T.CircleGeometry(width / 2, 10);
          cap.rotateX(-Math.PI / 2).translate(point.x, 0, point.z);
          if (songpa) {
            const positions = cap.getAttribute('position');
            for (let i = 0; i < positions.count; i++) positions.setY(i, surface(positions.getX(i), positions.getZ(i)) + 0.355);
          } else cap.translate(0, surface(point.x, point.z) + 0.445, 0);
          add(tint, cap, texture);
        }
      }
      if (songpa && road.motor) {
        let from = road.points.indexOf(points[0]);
        const limit = from + points.length - 1;
        for (let end = from + 1; end <= limit; end++) {
          if (end !== limit && (joined.get(road.nodeIds[end]) ?? 0) < 3) continue;
          const startAtJunction = (joined.get(road.nodeIds[from]) ?? 0) > 2;
          const endAtJunction = (joined.get(road.nodeIds[end]) ?? 0) > 2;
          songpaPaint(road.points.slice(from, end + 1), startAtJunction, endAtJunction);
          from = end;
        }
      } else if (!isPath && road.lanes && road.lanes >= 2 && road.markings && !road.unpaved) {
        for (const chunk of lineChunks(points, 3.4, 4.8)) strip(chunk, 0.11, 0.52, road.oneWay ? '#e6e4d9' : '#dfb85e');
      }
      if (!songpa) road.sidewalks.forEach((sidewalk, i) => {
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
    groundPolygon(area, (x, z) => surface(x, z) + 0.11), 'asphalt');
  const busStops: Point[] = [], benches: Point[] = [];
  for (const item of data.streetPoints) {
    if (item.kind === 'bus') busStops.push(item.position);
    if (item.kind === 'bench') benches.push(item.position);
  }
  for (const { style, points } of surveyedLines) surveyedPaint(points, style);
  for (const crossing of crossings) zebra(crossing);
  for (const { color, texture, geometry: geometries, castsShadow } of layers.values()) {
    const geometry = mergeGeometries(geometries);
    geometries.forEach(item => item.dispose());
    if (!geometry) continue;
    const material = new T.MeshStandardMaterial({ color, roughness: 0.91, side: T.DoubleSide });
    if (texture && finish) finish(material, texture);
    if (songpa && texture === 'asphalt') material.color.multiplyScalar(1.42);
    const mesh = new T.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = castsShadow;
    scene.add(mesh);
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
  return { ...network, surface };
}
