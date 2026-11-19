import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { inShape, nearestOnLine, type OpoData, type Point } from './opo-data';
import { curbWalk, sidewalkFascia } from './opo-curb-walk';
import type { CrosswalkArea } from './opo-crosswalks';
import { surfaceUV, type TourMaterials, type TourSurface } from './opo-materials';
import { groundPolygon, ribbon, streetDeckLift } from './opo-meshes';
import { createRoadPaintClipper } from './opo-road-paint';
import { makeCar } from './opo-vehicle';
import { buildingEntry, type BuildingEntryLayout } from './opo-building-entry';
import { addShrubPlanting, type ShrubPlacement } from './opo-vegetation';

type Coordinate = [longitude: number, latitude: number];
type SiteCrossing = { start: Coordinate; end: Coordinate; outline: Coordinate[] };
type ParkingRow = {
  aisle: [Coordinate, Coordinate];
  depth: number;
  side: -1 | 1;
  spaces: number;
  orientation: 'parallel' | 'perpendicular';
  displayCars?: { space: number; color: string }[];
};

export type SurveyedWalk = {
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
  plantingBeds?: { outline: Coordinate[]; hedge: Coordinate[]; width: number; height: number }[];
  plantedGround?: Coordinate[][];
  ironFences?: Coordinate[][];
  buildingEntries?: BuildingEntryLayout[];
  pavedDrive?: Coordinate[];
  drivewayFinishes?: { outline: Coordinate[]; color: string }[];
  drivewayRoad?: Omit<SurveyedRoad, 'outline'>;
  drivewayJoin?: Coordinate[];
  roadsideWalks?: { curb: Coordinate[]; outward: -1 | 1; width: number; beside?: 'driveway'; finish?: 'planted' }[];
  surveyedWalks?: SurveyedWalk[];
  surveyedRoads?: SurveyedRoad[];
  surveyedJunctions?: Coordinate[][];
  surveyedCrossings?: SiteCrossing[];
  parkingRows?: ParkingRow[];
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

function ironFence(lines: Point[][], grade: OpoData['ground']) {
  const pieces: T.BufferGeometry[] = [];
  const height = 1.06;
  const railAxis = new T.Vector3(0, 0, 1);
  const span = new T.Vector3();
  const angle = new T.Quaternion();
  const rotation = new T.Matrix4();
  for (const line of lines) {
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
        const post = j % pickets === 0;
        const width = post ? 0.074 : 0.027;
        pieces.push(new T.BoxGeometry(width, height, width).translate(x, grade(x, z) + height / 2, z));
      }
      span.subVectors(b, a);
      const beamLength = span.length();
      rotation.makeRotationFromQuaternion(angle.setFromUnitVectors(railAxis, span.normalize()));
      for (const lift of [0.23, 0.98]) {
        pieces.push(new T.BoxGeometry(0.048, 0.046, beamLength).applyMatrix4(rotation)
          .translate((a.x + b.x) / 2, (a.y + b.y) / 2 + lift, (a.z + b.z) / 2));
      }
    }
    const last = points.at(-1);
    if (last) pieces.push(new T.BoxGeometry(0.074, height, 0.074).translate(last.x, last.y + height / 2, last.z));
  }
  if (!pieces.length) return;
  const geometry = mergeGeometries(pieces);
  pieces.forEach(piece => piece.dispose());
  return geometry;
}

export function addSiteSurfaces(
  data: OpoData, scene: T.Scene, grade: OpoData['ground'], finish: TourMaterials,
  layout: SiteSurfaceLayout, roadClearance: (point: Point) => number, insideBuilding?: (point: Point) => boolean,
) {
  const asphalt = material('#e2ecf8', 'asphalt');
  asphalt.color.multiplyScalar(1.42);
  const paving = material('#c8c1b8', 'pavers');
  const edging = material('#aaa59a');
  const plantedEdge = material('#b4a685', 'forest');
  const paint = material('#eeeae0');
  const crossings = (layout.surveyedCrossings ?? []).map(crossing => projectSiteCrossing(data.project, crossing).area);
  const roadBlendWidth = 2.5;
  const drivewayGrade = (x: number, z: number) => {
    const blend = T.MathUtils.smoothstep(roadClearance({ x, z }), 0, roadBlendWidth);
    return grade(x, z) + T.MathUtils.lerp(streetDeckLift, 0.15, blend);
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
    clipper: ReturnType<typeof createRoadPaintClipper>) {
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
    clipper: ReturnType<typeof createRoadPaintClipper>) {
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

  const drivewayCenterline: Point[] | undefined = layout.drive && curve(layout.drive.points);
  if (layout.pavedDrive) {
    add(groundPolygon([layout.pavedDrive.map(data.project)], drivewayGrade, 0.65, 0), asphalt, 'asphalt');
    if (layout.drivewayJoin) {
      // Keep the sub-centimetre gap between independently tessellated pavement edges covered.
      const join = layout.drivewayJoin.map(data.project);
      add(ribbon(join, 0.16, (x, z) => grade(x, z) + streetDeckLift - 0.012, 0.08, 0.65), asphalt, 'asphalt');
    }
  } else if (layout.drive && drivewayCenterline) {
    add(ribbon(drivewayCenterline, layout.drive.width, drivewayGrade, 0.8, 1), asphalt, 'asphalt');
  }
  for (const { width, points } of layout.paths) {
    const line = curve(points);
    add(ribbon(line, width + 0.26, (x, z) => grade(x, z) + pathLift - 0.04), edging);
    add(ribbon(line, width, (x, z) => grade(x, z) + pathLift), paving, 'pavers');
  }
  for (const entry of layout.buildingEntries ?? []) {
    const facade = buildingEntry(data, entry, grade, pathLift);
    if (!facade) continue;
    add(facade.connector, paving, 'pavers');
    for (const deck of facade.stepDecks) add(deck, edging);
    scene.add(facade.exterior);
  }
  const streetGrade = (x: number, z: number) => grade(x, z) + streetDeckLift;
  for (const { outline } of layout.surveyedWalks ?? []) {
    const ring = outline.map(data.project);
    const walkGrade = (x: number, z: number) => streetGrade(x, z) + 0.13;
    add(groundPolygon([ring], walkGrade, 0.8, 0), paving, 'pavers');
    add(sidewalkFascia(ring, grade, walkGrade), edging, undefined, false);
  }
  for (const { curb, outward, width, beside, finish: edgeFinish } of layout.roadsideWalks ?? []) {
    const edge = curb.map(data.project);
    const { top, curb: curbGeometry, skirt } = curbWalk(edge, width, outward, grade,
      beside === 'driveway' ? drivewayGrade : streetGrade, crossings);
    const planted = edgeFinish === 'planted';
    add(top, planted ? plantedEdge : paving, planted ? 'forest' : 'pavers');
    add(curbGeometry, edging);
    add(skirt, plantedEdge, 'forest');
  }

  if (layout.playground) {
    const { outline, surface } = layout.playground;
    const playRing = outline.map(data.project);
    const playFloor = material(surface === 'rubber' ? '#d7dfe2' : '#a69984', surface);
    add(groundPolygon([playRing], grade, 3, 0.25), playFloor, surface);
    add(ribbon([...playRing, playRing[0]], 0.23, (x, z) => grade(x, z) + 0.28), edging);
  }
  const fenceLines = (layout.ironFences ?? []).map(line => line.map(data.project));
  const fenceGeometry = ironFence(fenceLines, (x, z) => elevation({ x, z }) ?? grade(x, z));
  if (fenceGeometry) {
    const fence = new T.Mesh(fenceGeometry, material('#536053'));
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
    const bedLift = 0.25;
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
    const clipper = createRoadPaintClipper();
    asphaltDecks.forEach(clipper.addSurface);
    for (const { outline, color } of layout.drivewayFinishes ?? []) {
      const ring = outline.map(data.project);
      const mask = groundPolygon([ring], () => 0, Infinity, 0);
      const patch = clipper.clip(mask, 0.006);
      mask.dispose();
      if (!patch.getAttribute('position').count) { patch.dispose(); continue; }
      const tint = material(color, 'asphalt');
      tint.color.multiplyScalar(1.42);
      tint.vertexColors = tint.transparent = true;
      tint.depthWrite = false;
      featherEdge(patch, ring, 1.2);
      add(patch, tint, 'asphalt', false);
    }
    for (const row of layout.parkingRows ?? []) parking(row, clipper);
    clipper.clear();
  }
  const parked = (point: Point) => parkedCars.some(({ center, direction: { x, z } }) => {
    const dx = point.x - center.x, dz = point.z - center.z;
    return Math.abs(x * dx + z * dz) < 2.24 && Math.abs(z * dx - x * dz) < 1.05;
  });
  const fenced = (point: Point) => fenceLines.length > 0 && nearestOnLine(point, fenceLines).distance < 0.19;
  return { elevation, drivewayElevation, drivewayCenterline, asphaltDecks, parked, fenced };
}
  const pathLift = 0.24;
