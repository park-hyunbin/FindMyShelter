import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { extent, type OpoData, type Point, type Street } from './opo-data';
import { groundPolygon, ribbon, terrainSurface } from './opo-meshes';

const major = new Set(['trunk', 'primary', 'secondary', 'tertiary']);
const paths = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway']);
const streetWidths: Record<string, number> = {
  trunk: 13, primary: 10, secondary: 8, tertiary: 6.4, residential: 5.3,
  unclassified: 4.8, service: 3.8, track: 3, pedestrian: 3, steps: 1.5, cycleway: 2.3,
};

export function streetWidth(road: Street) {
  const base = road.category.replace('_link', '');
  const width = road.width ?? (road.lanes ? road.lanes * (major.has(base) ? 3.1 : 2.8) + 0.5 : streetWidths[base] ?? 1.7);
  return T.MathUtils.clamp(width, 1.2, 26);
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

  function nearest(point: Point, radius = 34) {
    const x = Math.floor(point.x / cellSize), z = Math.floor(point.z / cellSize);
    const range = Math.ceil(radius / cellSize);
    const candidates = new Set<Segment>();
    for (let dx = -range; dx <= range; dx++) for (let dz = -range; dz <= range; dz++) {
      for (const segment of cells.get(`${x + dx},${z + dz}`) ?? []) candidates.add(segment);
    }
    let best: RoadPosition | undefined;
    for (const segment of candidates) {
      const hit = segmentLocation(point, segment);
      if (hit.distance <= radius && (!best || hit.distance < best.distance)) best = hit;
    }
    return best;
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
  return { nearest, drive, raiseBridge, route };
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

export function addStreets(data: OpoData, scene: T.Scene) {
  const network = createStreetNetwork(data.streets);
  const grade = (x: number, z: number) => data.ground(x, z) + network.raiseBridge({ x, z });
  const surface = (x: number, z: number) => terrainSurface(data.ground, x, z) + network.raiseBridge({ x, z });
  const layers = new Map<string, T.BufferGeometry[]>();
  function add(color: string, geometry: T.BufferGeometry) {
    if (!geometry.getAttribute('position')?.count) { geometry.dispose(); return; }
    if (geometry.index) {
      const flat = geometry.toNonIndexed();
      geometry.dispose();
      geometry = flat;
    }
    geometry.deleteAttribute('uv');
    const list = layers.get(color);
    if (list) list.push(geometry);
    else layers.set(color, [geometry]);
  }
  function strip(points: Point[], width: number, height: number, color: string) {
    add(color, ribbon(points, width, (x, z) => surface(x, z) + height));
  }
  for (const road of data.streets) {
    const width = streetWidth(road);
    const isPath = paths.has(road.category);
    const isMain = major.has(road.category.replace('_link', ''));
    const within = (p: Point) => Math.max(Math.abs(p.x), Math.abs(p.z)) <= extent + 28;
    let run: Point[] = [];
    const color = road.unpaved || road.category === 'track' ? '#aa9981'
      : isPath ? '#bba994' : isMain ? '#626970' : road.category === 'residential' ? '#737878' : '#858780';
    const paint = (points: Point[]) => {
      if (points.length < 2) return;
      strip(points, width + (isPath ? 0.14 : 0.42), 0.38, isPath ? '#a29477' : '#a29f91');
      strip(points, width, 0.47, color);
      if (!isPath) {
        for (const point of points) {
          const cap = new T.CircleGeometry(width / 2, 10);
          cap.rotateX(-Math.PI / 2).translate(point.x, surface(point.x, point.z) + 0.445, point.z);
          add(color, cap);
        }
      }
      if (!isPath && road.lanes && road.lanes >= 2 && road.markings && !road.unpaved) {
        for (const chunk of lineChunks(points, 3.4, 4.8)) strip(chunk, 0.11, 0.52, road.oneWay ? '#e6e4d9' : '#dfb85e');
      }
      road.sidewalks.forEach((sidewalk, i) => {
        if (sidewalk) strip(offsetLine(points, (width / 2 + 0.85) * (i ? -1 : 1)), 1.7, 0.57, '#c2b8a5');
      });
      if (road.bridge) for (const side of [-1, 1]) {
        strip(offsetLine(points, width / 2 * side), 0.27, 0.64, '#c8c1ad');
        strip(offsetLine(points, width / 2 * side), 0.12, 1.12, '#72857f');
      }
    };
    for (const point of road.points) {
      if (within(point)) run.push(point);
      else { paint(run); run = []; }
    }
    paint(run);
  }
  for (const area of data.parking) add('#90918a', groundPolygon(area, (x, z) => surface(x, z) + 0.11));
  const busStops: Point[] = [], benches: Point[] = [];
  for (const item of data.streetPoints) {
    if (item.kind === 'bus') busStops.push(item.position);
    if (item.kind === 'bench') benches.push(item.position);
    if (item.kind !== 'crossing') continue;
    const road = network.nearest(item.position, 8);
    if (!road) continue;
    const { a, b, width, length } = road.segment;
    const dx = (b.x - a.x) / length, dz = (b.z - a.z) / length;
    for (let offset = -width / 2 + 0.45; offset <= width / 2 - 0.35; offset += 0.78) {
      const x = road.point.x + dz * offset, z = road.point.z - dx * offset;
      strip([{ x: x - dx * 1.08, z: z - dz * 1.08 }, { x: x + dx * 1.08, z: z + dz * 1.08 }], 0.4, 0.545, '#ede8d8');
    }
  }
  for (const [color, geometries] of layers) {
    const geometry = mergeGeometries(geometries);
    geometries.forEach(item => item.dispose());
    if (!geometry) continue;
    const mesh = new T.Mesh(geometry, new T.MeshStandardMaterial({ color, roughness: 0.91, side: T.DoubleSide }));
    mesh.receiveShadow = true;
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
  return { ...network, grade, surface };
}
