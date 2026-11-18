import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { inShape, type OpoData, type Point } from './opo-data';
import { curbWalk } from './opo-curb-walk';
import { crosswalkFrame, zebraOffsets, type CrosswalkArea } from './opo-crosswalks';
import { surfaceUV, type TourMaterials, type TourSurface } from './opo-materials';
import { groundPolygon, ribbon, streetDeckLift } from './opo-meshes';
import { createRoadPaintClipper } from './opo-road-paint';
import { makeCar } from './opo-vehicle';
import { buildingEntry, type BuildingEntryLayout } from './opo-building-entry';
import { addShrubPlanting, type ShrubPlacement } from './opo-vegetation';

type Coordinate = [longitude: number, latitude: number];
type SiteCrossing = { start: Coordinate; end: Coordinate; depth: number };
type ParkingRow = {
  aisle: [Coordinate, Coordinate];
  depth: number;
  side: -1 | 1;
  spaces: number;
  orientation: 'parallel' | 'perpendicular';
  displayCars?: { space: number; color: string }[];
};

export type GateLayout = {
  axis: [Coordinate, Coordinate];
  width: number;
  crossing: [start: number, end: number];
  sidewalks: { extension: number; rampWidth: number };
  guards?: { inset: number; span: [start: number, end: number] };
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
  buildingEntries?: BuildingEntryLayout[];
  pavedDrive?: Coordinate[];
  roadsideWalks?: { curb: Coordinate[]; outward: -1 | 1; width: number; beside?: 'driveway'; finish?: 'planted' }[];
  surveyedWalks?: SurveyedWalk[];
  surveyedRoads?: SurveyedRoad[];
  crossings: SiteCrossing[];
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

export function gateCrosswalkArea(project: OpoData['project'], gate: GateLayout): CrosswalkArea {
  const { at, direction } = axisBetween(project(gate.axis[0]), project(gate.axis[1]));
  const [start, end] = gate.crossing;
  return { center: at(0, (start + end) / 2), depth: end - start, direction, section: { width: gate.width } };
}

export function gateGuardRuns(gate: GateLayout) {
  if (!gate.guards) return [];
  const [start, end] = gate.guards.span;
  const [openingStart, openingEnd] = gate.crossing;
  const approaches: [number, number][] = [[start, Math.min(end, openingStart - 0.1)], [Math.max(start, openingEnd + 0.1), end]];
  return approaches.filter(([a, b]) => b - a >= 0.3);
}

export function siteCrosswalkArea(project: OpoData['project'], { start, end, depth }: SiteCrossing): CrosswalkArea {
  const { at, length, direction } = axisBetween(project(start), project(end));
  return { center: at(0, length / 2), depth, direction: { x: direction.z, z: -direction.x }, section: { width: length } };
}

export function addSiteSurfaces(
  data: OpoData, scene: T.Scene, grade: OpoData['ground'], finish: TourMaterials,
  layout: SiteSurfaceLayout, roadClearance: (point: Point) => number, gate?: GateLayout, insideBuilding?: (point: Point) => boolean,
) {
  const asphalt = material('#e2ecf8', 'asphalt');
  asphalt.color.multiplyScalar(1.42);
  const paving = material('#c8c1b8', 'pavers');
  const edging = material('#aaa59a');
  const plantedEdge = material('#b4a685', 'forest');
  const paint = material('#eeeae0');
  const frame = gate && axisBetween(data.project(gate.axis[0]), data.project(gate.axis[1]));
  const gateCrossing = gate && gateCrosswalkArea(data.project, gate);
  const crossings = layout.crossings.map(crossing => siteCrosswalkArea(data.project, crossing));
  if (gateCrossing) crossings.push(gateCrossing);
  const roadBlendWidth = 2.5;
  const drivewayGrade = (x: number, z: number) => {
    const crossingClearance = gateCrossing
      ? Math.hypot(x - gateCrossing.center.x, z - gateCrossing.center.z) - (gateCrossing.section.width / 2 + 0.8)
      : Infinity;
    const clearance = Math.min(roadClearance({ x, z }), crossingClearance);
    const blend = T.MathUtils.smoothstep(clearance, 0, roadBlendWidth);
    // Hold the whole crossing at street-deck grade before transitioning to the courtyard.
    return grade(x, z) + T.MathUtils.lerp(streetDeckLift + 0.02, 0.15, blend);
  };
  const decks: { mesh: T.Mesh<T.BufferGeometry>; bounds: T.Box3 }[] = [];
  const asphaltDecks: T.BufferGeometry[] = [];
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
      if (texture === 'asphalt') asphaltDecks.push(geometry);
      geometry.computeBoundingBox();
      if (geometry.boundingBox && !geometry.boundingBox.isEmpty()) decks.push({ mesh, bounds: geometry.boundingBox });
    }
  }

  function elevation({ x, z }: Point) {
    let top: number | undefined;
    for (const { mesh, bounds } of decks) {
      if (x < bounds.min.x || x > bounds.max.x || z < bounds.min.z || z > bounds.max.z) continue;
      ray.ray.origin.set(x, bounds.max.y + 1, z);
      mesh.raycast(ray, hits);
      for (const hit of hits) top = Math.max(top ?? hit.point.y, hit.point.y);
      hits.length = 0;
    }
    return top;
  }

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

  function zebra(crossing: CrosswalkArea, clipper: ReturnType<typeof createRoadPaintClipper>) {
    const at = crosswalkFrame(crossing);
    const halfDepth = crossing.depth / 2;
    paintOnDrive(zebraOffsets(crossing.section.width).map(across =>
      [at(-halfDepth, across), at(halfDepth, across)]), 0.44, 0.028, clipper);
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
    add(groundPolygon([outline.map(data.project)], streetGrade, 0.8, 0.13), paving, 'pavers');
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
  if (gate && frame && gateCrossing) {
    const { at } = frame;
    const sidewalk = material('#c7c6be', 'pavers');
    const { extension, rampWidth } = gate.sidewalks;
    const along = (gate.crossing[0] + gate.crossing[1]) / 2;
    const { center, direction, depth } = gateCrossing;
    const edge = gate.width / 2;
    for (const side of [-1, 1]) {
      const points = [edge, edge + rampWidth, edge + extension].map(across => at(side * across, along));
      add(ribbon(points, depth, (x, z) => {
        const across = (x - center.x) * direction.z - (z - center.z) * direction.x;
        const lift = T.MathUtils.lerp(0.015, 0.12, T.MathUtils.smoothstep(Math.abs(across) - edge, 0, rampWidth));
        return drivewayGrade(x, z) + lift;
      }, 0.25), sidewalk, 'pavers');
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
  if (crossings.length || layout.parkingRows?.length) {
    const clipper = createRoadPaintClipper();
    asphaltDecks.forEach(clipper.addSurface);
    for (const crossing of crossings) zebra(crossing, clipper);
    for (const row of layout.parkingRows ?? []) parking(row, clipper);
    clipper.clear();
  }
  const parked = (point: Point) => parkedCars.some(({ center, direction: { x, z } }) => {
    const dx = point.x - center.x, dz = point.z - center.z;
    return Math.abs(x * dx + z * dz) < 2.24 && Math.abs(z * dx - x * dz) < 1.05;
  });
  return { elevation, drivewayGrade, drivewayCenterline, asphaltDecks, parked };
}
  const pathLift = 0.24;
