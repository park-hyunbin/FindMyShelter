import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { inShape, nearestOnLine, type OpoData, type Point } from './opo-data';
import { curbWalk, sidewalkFascia, sidewalkRise } from './opo-curb-walk';
import type { CrosswalkArea } from './opo-crosswalks';
import { surfaceUV, type TourMaterials, type TourSurface } from './opo-materials';
import { groundPolygon, ribbon, streetDeckLift, type createTerrainProjection } from './opo-meshes';
import { createSurfaceClipper } from './opo-surface-clip';
import { makeCar } from './opo-vehicle';
import { buildingEntry, type BuildingEntryLayout } from './opo-building-entry';
import { addShrubPlanting, type ShrubPlacement } from './opo-vegetation';

type Coordinate = [longitude: number, latitude: number];
type SiteCrossing = { start: Coordinate; end: Coordinate; outline: Coordinate[] };
type IronFence = {
  points: Coordinate[];
  color?: string;
  height?: number;
  plinth?: { width: number; height: number; color: string };
};
type ParkingRow = {
  aisle: [Coordinate, Coordinate];
  depth: number;
  side: -1 | 1;
  spaces: number;
  orientation: 'parallel' | 'perpendicular';
  displayCars?: { space: number; color: string }[];
};

export type VehicleGateLayout = {
  axis: [Coordinate, Coordinate];
  width: number;
  arms: { atM: number; side: -1 | 1; lengthM: number; raised: boolean }[];
};

export type SurveyedWalk = {
  id?: string;
  roadId: number;
  side: -1 | 1;
  outline: Coordinate[];
  centerline?: Coordinate[];
};

type SurveyedRoad = {
  roadId: number;
  nodes: [from: number, to: number];
  outline: Coordinate[];
  axis: { nodeId: number; coordinate: Coordinate }[];
};

export type SiteSurfaceLayout = {
  drive?: { width: number; points: Coordinate[] };
  paths: { width: number; points: Coordinate[] }[];
  walkAreas?: Coordinate[][];
  plantingBeds?: { outline: Coordinate[]; hedge: Coordinate[]; width: number; height: number }[];
  plantedGround?: Coordinate[][];
  ironFences?: IronFence[];
  buildingEntries?: BuildingEntryLayout[];
  pavedDrive?: Coordinate[];
  drivewayFinishes?: { outline: Coordinate[]; color: string; surface?: 'asphalt' | 'pavers' }[];
  drivewayRoad?: Omit<SurveyedRoad, 'outline'>;
  roadsideWalks?: {
    id?: string; curb: Coordinate[]; outward: -1 | 1; width: number;
    beside?: 'driveway'; finish?: 'planted'; flushEndM?: number; joinsWalk?: string;
  }[];
  surveyedWalks?: SurveyedWalk[];
  surveyedRoads?: SurveyedRoad[];
  surveyedJunctions?: Coordinate[][];
  surveyedCrossings?: SiteCrossing[];
  parkingRows?: ParkingRow[];
  vehicleGates?: VehicleGateLayout[];
  playground?: { outline: Coordinate[]; surface: 'granular' | 'rubber' };
};

export function axisBetween(start: Point, end: Point) {
  const length = Math.hypot(end.x - start.x, end.z - start.z);
  const dx = (end.x - start.x) / length;
  const dz = (end.z - start.z) / length;
  return {
    length,
    direction: { x: dx, z: dz },
    heading: Math.atan2(dx, dz),
    at: (across: number, along: number): Point => ({ x: start.x + dz * across + dx * along, z: start.z - dx * across + dz * along }),
  };
}

export function projectSiteCrossing(project: OpoData['project'], { start, end, outline }: SiteCrossing) {
  const { at, length, direction } = axisBetween(project(start), project(end));
  const ring = outline.map(project);
  const center = at(0, length / 2);
  const alongRoad = { x: direction.z, z: -direction.x };
  const depth = 2 * Math.max(...ring.map(point => Math.abs((point.x - center.x) * alongRoad.x + (point.z - center.z) * alongRoad.z)));
  const area: CrosswalkArea = { center, depth, direction: alongRoad, section: { width: length } };
  return { area, ring, boundary: [...ring, ring[0]] };
}

export function sidewalkTreeWell(position: Point, rings: Point[][], surface: ReturnType<typeof createSurfaceClipper>) {
  let nearest: [Point, Point] | undefined;
  let distance = Infinity;
  for (const ring of rings) for (const [index, a] of ring.entries()) {
    const b = ring[(index + 1) % ring.length];
    const candidate = nearestOnLine(position, [[a, b]]).distance;
    if (candidate < distance) {
      nearest = [a, b];
      distance = candidate;
    }
  }
  const half = Math.min(0.49, distance - 0.025);
  if (!nearest || half < 0.17) return undefined;
  const direction = axisBetween(...nearest).direction;
  function onSidewalk(radius: number, lift: number) {
    const square = [[-radius, -radius], [radius, -radius], [radius, radius], [-radius, radius]].map(([u, v]) => ({
      x: position.x + direction.x * u + direction.z * v,
      z: position.z + direction.z * u - direction.x * v,
    }));
    const outline = groundPolygon([square], () => 0, Infinity, 0);
    const result = surface.clip(outline, lift);
    outline.dispose();
    return result;
  }
  return { frame: onSidewalk(half, 0.013), fill: onSidewalk(half - 0.07, 0.016) };
}

function ironFence(line: Point[], grade: OpoData['ground'], height: number) {
  const pieces: T.BufferGeometry[] = [];
  const railAxis = new T.Vector3(0, 0, 1);
  const span = new T.Vector3();
  const angle = new T.Quaternion();
  const rotation = new T.Matrix4();
  const points = line.map(({ x, z }) => new T.Vector3(x, grade(x, z), z));
  for (const [i, a] of points.slice(0, -1).entries()) {
    const b = points[i + 1];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 0.005) continue;
    const panels = Math.ceil(length / 2.4);
    const pickets = Math.ceil(length / panels / 0.24);
    for (let j = 0; j < panels * pickets; j++) {
      const t = j / (panels * pickets);
      const x = T.MathUtils.lerp(a.x, b.x, t), z = T.MathUtils.lerp(a.z, b.z, t);
      const width = j % pickets === 0 ? 0.074 : 0.027;
      pieces.push(new T.BoxGeometry(width, height, width).translate(x, grade(x, z) + height / 2, z));
    }
    span.subVectors(b, a);
    const beamLength = span.length();
    rotation.makeRotationFromQuaternion(angle.setFromUnitVectors(railAxis, span.normalize()));
    for (const lift of [height * (0.23 / 1.06), height - 0.08]) {
      pieces.push(new T.BoxGeometry(0.048, 0.046, beamLength).applyMatrix4(rotation)
        .translate((a.x + b.x) / 2, (a.y + b.y) / 2 + lift, (a.z + b.z) / 2));
    }
  }
  const last = points.at(-1);
  if (last) pieces.push(new T.BoxGeometry(0.074, height, 0.074).translate(last.x, last.y + height / 2, last.z));
  if (!pieces.length) return;
  const geometry = mergeGeometries(pieces);
  pieces.forEach(piece => piece.dispose());
  return geometry;
}

function ribbonBoundary(top: T.BufferGeometry) {
  const vertices = top.getAttribute('position');
  const edges = Array.from({ length: vertices.count / 2 }, (_, i) => i * 2);
  return [...edges, ...edges.slice().reverse().map(i => i + 1)]
    .map(i => ({ x: vertices.getX(i), z: vertices.getZ(i) }));
}

function fencePlinth(line: Point[], ground: OpoData['ground'], width: number, height: number) {
  const top = ribbon(line, width, (x, z) => ground(x, z) + height, Infinity, 0.6);
  if (!top.getAttribute('position')) return top;
  const sides = sidewalkFascia(ribbonBoundary(top), ground, (x, z) => ground(x, z) + height);
  const cap = top.toNonIndexed();
  cap.deleteAttribute('uv');
  const joined = mergeGeometries([cap, sides]);
  top.dispose();
  cap.dispose();
  sides.dispose();
  if (joined) {
    const position = joined.getAttribute('position');
    const normal = joined.getAttribute('normal');
    const uv = new T.Float32BufferAttribute(new Float32Array(position.count * 2), 2);
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), z = position.getZ(i);
      if (Math.abs(normal.getY(i)) > 0.8) uv.setXY(i, x / 1.6, z / 1.6);
      else uv.setXY(i, (z * normal.getX(i) - x * normal.getZ(i)) / 1.6, position.getY(i));
    }
    joined.setAttribute('uv', uv);
  }
  return joined;
}

export function addSiteSurfaces(
  data: OpoData, scene: T.Scene, grade: OpoData['ground'], finish: TourMaterials,
  layout: SiteSurfaceLayout, roadClearance: (point: Point) => number, insideBuilding?: (point: Point) => boolean,
  terrain?: ReturnType<typeof createTerrainProjection>,
) {
  const asphalt = material('#e2ecf8', 'asphalt');
  asphalt.color.multiplyScalar(1.42);
  asphalt.roughness = 0.91;
  const paving = material('#c8c1b8', 'pavers');
  const edging = material('#aaa59a');
  const plantedEdge = material('#b4a685', 'forest');
  const paint = material('#eeeae0');
  const crossings = (layout.surveyedCrossings ?? []).map(crossing => projectSiteCrossing(data.project, crossing).area);
  const deckLift = streetDeckLift(data.region);
  const streetGrade = (x: number, z: number) => grade(x, z) + deckLift;
  const pathRise = 0.12;
  const pathGrade = (x: number, z: number) => grade(x, z) + pathRise;
  const roadBlendWidth = 2.5;
  const drivewayGrade = (x: number, z: number) => {
    const blend = T.MathUtils.smoothstep(roadClearance({ x, z }), 0, roadBlendWidth);
    return grade(x, z) + T.MathUtils.lerp(deckLift, 0.15, blend);
  };
  const decks: { mesh: T.Mesh<T.BufferGeometry>; bounds: T.Box3 }[] = [];
  const drivewayDecks: typeof decks = [];
  const ray = new T.Raycaster(undefined, new T.Vector3(0, -1, 0));
  const hits: T.Intersection[] = [];
  const parkedCars: { center: Point; direction: Point }[] = [];

  function material(color: string, texture?: TourSurface) {
    const base = new T.MeshStandardMaterial({ color, roughness: 0.93, side: T.DoubleSide });
    return texture ? finish(base, texture) : base;
  }

  function add(geometry: T.BufferGeometry, value: T.Material, texture?: TourSurface, walkable = true) {
    if (texture) surfaceUV(geometry, texture);
    const mesh = new T.Mesh(geometry, value);
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (walkable) {
      geometry.computeBoundingBox();
      if (geometry.boundingBox && !geometry.boundingBox.isEmpty()) {
        const deck = { mesh, bounds: geometry.boundingBox };
        decks.push(deck);
        if (texture === 'asphalt') drivewayDecks.push(deck);
      }
    }
  }

  function featherEdge(geometry: T.BufferGeometry, ring: Point[], width: number) {
    const boundary = [[...ring, ring[0]]];
    const vertices = geometry.getAttribute('position');
    const colors = new Float32Array(vertices.count * 4).fill(1);
    for (let i = 0; i < vertices.count; i++) {
      const point = { x: vertices.getX(i), z: vertices.getZ(i) };
      colors[i * 4 + 3] = T.MathUtils.smoothstep(nearestOnLine(point, boundary).distance, 0.03, width);
    }
    geometry.setAttribute('color', new T.BufferAttribute(colors, 4));
  }

  function surfaceHeight({ x, z }: Point, surfaces: typeof decks) {
    let top: number | undefined;
    for (const { mesh, bounds } of surfaces) {
      if (x < bounds.min.x || x > bounds.max.x || z < bounds.min.z || z > bounds.max.z) continue;
      ray.ray.origin.set(x, bounds.max.y + 1, z);
      mesh.raycast(ray, hits);
      for (const hit of hits) top = Math.max(top ?? hit.point.y, hit.point.y);
      hits.length = 0;
    }
    return top;
  }
  const elevation = (point: Point) => surfaceHeight(point, decks);
  const drivewayElevation = (point: Point) => surfaceHeight(point, drivewayDecks);

  function curve(points: Coordinate[], spacing = 1.2) {
    const line = new T.CatmullRomCurve3(points.map(data.project).map(({ x, z }) => new T.Vector3(x, 0, z)));
    return line.getSpacedPoints(Math.ceil(line.getLength() / spacing));
  }

  function paintOnDrive(lines: [Point, Point][], width: number, lift: number,
    clipper: ReturnType<typeof createSurfaceClipper>) {
    if (!lines.length) return;
    const strips = lines.map(line => ribbon(line, width, () => 0));
    const flat = mergeGeometries(strips);
    strips.forEach(strip => strip.dispose());
    const fitted = clipper.clip(flat, lift);
    flat.dispose();
    if (fitted.getAttribute('position').count) add(fitted, paint, undefined, false);
    else fitted.dispose();
  }

  function parking({ aisle, depth, side, spaces, orientation, displayCars }: ParkingRow,
    clipper: ReturnType<typeof createSurfaceClipper>) {
    const axis = axisBetween(data.project(aisle[0]), data.project(aisle[1]));
    const pitch = axis.length / spaces;
    const back = depth * side;
    const outlines: [Point, Point][] = Array.from({ length: spaces + 1 }, (_, index) =>
      [axis.at(0, index * pitch), axis.at(back, index * pitch)]);
    outlines.push([axis.at(back, 0), axis.at(back, axis.length)]);
    const parallel = orientation === 'parallel';
    if (parallel) outlines.push([axis.at(0, 0), axis.at(0, axis.length)]);
    paintOnDrive(outlines, 0.115, 0.026, clipper);

    const heading = parallel ? axis.heading : axis.heading + side * Math.PI / 2;
    const direction = { x: Math.sin(heading), z: Math.cos(heading) };
    for (const { space, color } of displayCars ?? []) {
      const center = axis.at(back / 2, (space + 0.5) * pitch);
      const y = elevation(center);
      if (y === undefined) continue;
      const car = makeCar(color, false);
      car.scale.z = 1.13;
      car.rotation.y = heading;
      car.position.set(center.x, y, center.z);
      scene.add(car);
      parkedCars.push({ center, direction });
    }
  }

  function vehicleGate({ axis: [start, end], width, arms }: VehicleGateLayout) {
    const axis = axisBetween(data.project(start), data.project(end));
    const divisions = Math.ceil(axis.length / 0.40);
    if (divisions < 2) return;
    const bay = axis.length / divisions;
    const beds = Array.from({ length: divisions }, (_, i) => axis.at(0, (i + 0.5) * bay));
    const floors = beds.map(drivewayElevation);
    if (floors.some(y => y === undefined)) return;

    const group = new T.Group();
    group.name = '차량 차단기';
    const curb = [material('#edbb41'), material('#343637')];
    const cabinet = material('#818b8c');
    const armColors = [material('#e6675e'), material('#f2ece4')];
    function box(point: Point, centerY: number, size: [number, number, number], mat: T.Material) {
      const mesh = new T.Mesh(new T.BoxGeometry(...size), mat);
      mesh.position.set(point.x, centerY, point.z);
      mesh.rotation.y = axis.heading;
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
    const rise = 0.16;
    beds.forEach((point, i) => box(point, floors[i]! + rise / 2 - 0.015, [width, rise + 0.03, bay], curb[i % 2]));
    for (const { atM, side, lengthM, raised } of arms) {
      const point = axis.at(0, atM);
      const floor = drivewayElevation(point);
      if (floor === undefined) continue;
      const base = floor + rise;
      box(point, base + 0.43, [0.27, 0.86, 0.38], cabinet);
      const sections = Math.ceil(lengthM / 0.53);
      const length = lengthM / sections;
      for (let i = 0; i < sections; i++) {
        const center = (i + 0.5) * length;
        const arm = raised ? point : axis.at(side * (width * 0.30 + center), atM);
        const y = base + 0.81 + (raised ? center : 0);
        box(arm, y, raised ? [0.082, length, 0.055] : [length, 0.082, 0.055], armColors[i % 2]);
      }
    }
    scene.add(group);
  }

  const drivewayCenterline: Point[] | undefined = layout.drive && curve(layout.drive.points);
  if (layout.pavedDrive) {
    const outline = [layout.pavedDrive.map(data.project)];
    const mask = groundPolygon(outline, terrain ? () => 0 : drivewayGrade, 0.65, 0);
    const deck = terrain ? terrain.fit(mask, 0) : mask;
    // Split at the same terrain triangle edges as the street before applying the approach grade.
    if (terrain) {
      const points = deck.getAttribute('position');
      for (let i = 0; i < points.count; i++) {
        points.setY(i, drivewayGrade(points.getX(i), points.getZ(i)));
      }
      deck.computeVertexNormals();
    }
    add(deck, asphalt, 'asphalt');
  } else if (layout.drive && drivewayCenterline) {
    add(ribbon(drivewayCenterline, layout.drive.width, drivewayGrade, 0.8, 1), asphalt, 'asphalt');
  }
  const walkAreas = (layout.walkAreas ?? []).map(outline => outline.map(data.project));
  const walkMask = walkAreas.length ? createSurfaceClipper() : undefined;
  for (const ring of walkAreas) {
    const top = groundPolygon([ring], pathGrade, 0.8, 0);
    walkMask?.addSurface(top);
    add(top, paving, 'pavers');
    add(sidewalkFascia(ring, grade, pathGrade), edging, undefined, false);
  }
  function outsideWalkAreas(geometry: T.BufferGeometry) {
    if (!walkMask) return geometry;
    const visible = walkMask.subtract(geometry);
    geometry.dispose();
    return visible;
  }
  for (const { width, points } of layout.paths) {
    const line = curve(points);
    const borderGrade = (x: number, z: number) => pathGrade(x, z) - 0.018;
    const border = ribbon(line, width + 0.18, borderGrade, Infinity, 0.6);
    if (!border.getAttribute('position')) continue;
    add(sidewalkFascia(ribbonBoundary(border), grade, borderGrade), edging, undefined, false);
    add(outsideWalkAreas(border), edging);
    add(outsideWalkAreas(ribbon(line, width, pathGrade, Infinity, 0.6)), paving, 'pavers');
  }
  walkMask?.clear();
  for (const entry of layout.buildingEntries ?? []) {
    const facade = buildingEntry(data, entry, grade, pathRise);
    if (!facade) continue;
    add(facade.connector, paving, 'pavers');
    for (const deck of facade.stepDecks) add(deck, edging);
    scene.add(facade.exterior);
  }
  const sidewalkCenterlines = new Map<string, Point[]>();
  const sidewalkTreeHeights = new Map<string, number>();
  const surveyedWalks = new Map<string, { outline: Point[]; surface: T.BufferGeometry }>();
  const walkGrade = (x: number, z: number) => streetGrade(x, z) + sidewalkRise;
  const surveyedTrees = data.streetPoints.filter(point => point.surveyedTree);
  const treeWellFrames: T.BufferGeometry[] = [];
  const treeWellGround: T.BufferGeometry[] = [];
  for (const { id, outline, centerline } of layout.surveyedWalks ?? []) {
    const ring = outline.map(data.project);
    const walkingSurface = groundPolygon([ring], walkGrade, 0.8, 0);
    add(walkingSurface, paving, 'pavers');
    add(sidewalkFascia(ring, grade, walkGrade), edging, undefined, false);
    if (id && centerline?.length) sidewalkCenterlines.set(id, centerline.map(data.project));
    if (id) surveyedWalks.set(id, { outline: ring, surface: walkingSurface });
    const wells = surveyedTrees.filter(({ id, position }) =>
      !sidewalkTreeHeights.has(id) && inShape(position, [ring]) && roadClearance(position) > 0.15
      && !insideBuilding?.(position) && drivewayElevation(position) === undefined);
    if (!wells.length) continue;

    const clipper = createSurfaceClipper();
    clipper.addSurface(walkingSurface);
    for (const { id, position } of wells) {
      const height = elevation(position);
      if (height === undefined) continue;
      sidewalkTreeHeights.set(id, height);
      const well = sidewalkTreeWell(position, [ring], clipper);
      if (well) {
        treeWellFrames.push(well.frame);
        treeWellGround.push(well.fill);
      }
    }
    clipper.clear();
  }
  if (treeWellFrames.length) {
    const frame = mergeGeometries(treeWellFrames);
    const fill = mergeGeometries(treeWellGround);
    [...treeWellFrames, ...treeWellGround].forEach(item => item.dispose());
    if (frame) add(frame, material('#555853'), undefined, false);
    if (fill) add(fill, material('#807463', 'forest'), 'forest', false);
  }
  for (const { id, curb, outward, width, beside, finish: edgeFinish, flushEndM, joinsWalk } of layout.roadsideWalks ?? []) {
    const edge = curb.map(data.project);
    const survey = joinsWalk ? surveyedWalks.get(joinsWalk) : undefined;
    const { top, curb: curbGeometry, curbFace, fascia, centerline } = curbWalk(edge, width, outward, grade,
      beside === 'driveway' ? drivewayGrade : streetGrade, crossings, flushEndM,
      survey && { outline: survey.outline, grade: walkGrade });
    const overlap = survey && createSurfaceClipper();
    if (survey) overlap?.addSurface(survey.surface);
    function outsideSurvey(geometry: T.BufferGeometry) {
      if (!overlap) return geometry;
      const exposed = overlap.subtract(geometry);
      geometry.dispose();
      return exposed;
    }
    const planted = edgeFinish === 'planted';
    add(outsideSurvey(top), planted ? plantedEdge : paving, planted ? 'forest' : 'pavers');
    add(outsideSurvey(curbGeometry), edging);
    add(curbFace, edging, undefined, false);
    add(fascia, edging, undefined, false);
    overlap?.clear();
    if (id && !planted) sidewalkCenterlines.set(id, centerline);
  }

  if (layout.playground) {
    const { outline, surface } = layout.playground;
    const playRing = outline.map(data.project);
    const playFloor = material(surface === 'rubber' ? '#d7dfe2' : '#a69984', surface);
    add(groundPolygon([playRing], grade, 3, 0.25), playFloor, surface);
    add(ribbon([...playRing, playRing[0]], 0.23, (x, z) => grade(x, z) + 0.28), edging);
  }
  const fenceLines: Point[][] = [];
  for (const { points, color = '#536053', height = 1.06, plinth } of layout.ironFences ?? []) {
    const line = points.map(data.project);
    fenceLines.push(line);
    // A supporting wall rests on the terrain. Adjacent paving can cover its bottom edge.
    const foot = plinth ? grade : (x: number, z: number) => elevation({ x, z }) ?? grade(x, z);
    if (plinth) {
      const base = fencePlinth(line, foot, plinth.width, plinth.height);
      if (base?.getAttribute('position')?.count) add(base, material(plinth.color, 'pavers'), undefined, false);
    }
    const geometry = ironFence(line, (x, z) => foot(x, z) + (plinth?.height ?? 0), height);
    if (!geometry) continue;
    const fence = new T.Mesh(geometry, material(color));
    fence.name = '철책';
    fence.castShadow = fence.receiveShadow = true;
    scene.add(fence);
  }
  if (layout.plantedGround?.length) {
    const groundCover = material('#c0bd9f', 'forest');
    groundCover.vertexColors = true;
    groundCover.transparent = true;
    groundCover.depthWrite = false;
    for (const outline of layout.plantedGround) {
      const ring = outline.map(data.project);
      const ground = groundPolygon([ring], grade, 0.7, 0.04);
      featherEdge(ground, ring, 0.65);
      add(ground, groundCover, 'forest', false);
    }
  }
  if (layout.plantingBeds?.length) {
    const soil = material('#9b8f73', 'forest');
    // The traced soil stays below the render deck even where foliage obscures a paving edge.
    const bedLift = 0.05;
    const shrubs: ShrubPlacement[] = [];
    for (const { outline, hedge, width, height } of layout.plantingBeds) {
      const ring = outline.map(data.project);
      add(groundPolygon([ring], grade, 1.5, bedLift), soil, 'forest', false);
      for (const { x, z } of curve(hedge, width * 0.54)) {
        const point = { x, z };
        if (!inShape(point, [ring]) || roadClearance(point) < width / 2
          || elevation(point) !== undefined || insideBuilding?.(point)) continue;
        shrubs.push({ x, z, y: grade(x, z) + bedLift + height * 0.40, scale: [width * 0.49, height * 0.8, width * 0.53] });
      }
    }
    addShrubPlanting(scene, shrubs, '정문 주변 관목');
  }
  const asphaltDecks = drivewayDecks.map(({ mesh }) => mesh.geometry);
  if (layout.parkingRows?.length || layout.drivewayFinishes?.length) {
    const clipper = createSurfaceClipper();
    asphaltDecks.forEach(clipper.addSurface);
    for (const { outline, color, surface = 'asphalt' } of layout.drivewayFinishes ?? []) {
      const ring = outline.map(data.project);
      const mask = groundPolygon([ring], () => 0, Infinity, 0);
      const patch = clipper.clip(mask, surface === 'asphalt' ? 0.006 : 0.010);
      mask.dispose();
      if (!patch.getAttribute('position').count) { patch.dispose(); continue; }
      const tint = material(color, surface);
      if (surface === 'asphalt') {
        tint.color.multiplyScalar(1.42);
        tint.vertexColors = tint.transparent = true;
        tint.depthWrite = false;
        featherEdge(patch, ring, 1.2);
      }
      add(patch, tint, surface, false);
    }
    for (const row of layout.parkingRows ?? []) parking(row, clipper);
    clipper.clear();
  }
  for (const gate of layout.vehicleGates ?? []) vehicleGate(gate);
  const parked = (point: Point) => parkedCars.some(({ center, direction: { x, z } }) => {
    const dx = point.x - center.x, dz = point.z - center.z;
    return Math.abs(x * dx + z * dz) < 2.24 && Math.abs(z * dx - x * dz) < 1.05;
  });
  const fenced = (point: Point) => fenceLines.length > 0 && nearestOnLine(point, fenceLines).distance < 0.19;
  return { elevation, drivewayElevation, drivewayCenterline, sidewalkCenterlines, sidewalkTreeHeights, asphaltDecks, parked, fenced };
}
