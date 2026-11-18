import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { OpoData, Point } from './opo-data';
import { zebraOffsets, type CrosswalkArea } from './opo-crosswalks';
import { surfaceUV, type TourMaterials, type TourSurface } from './opo-materials';
import { groundPolygon, ribbon, streetDeckLift } from './opo-meshes';

type Coordinate = [longitude: number, latitude: number];
type GateOffset = [across: number, along: number];

export type GateLayout = {
  axis: [Coordinate, Coordinate];
  width: number;
  roadOverhang: [before: number, after: number];
  crossing: [start: number, end: number];
  sidewalks: { width: number; points: [GateOffset, GateOffset][] };
};

export type SiteSurfaceLayout = {
  drive?: { width: number; points: Coordinate[] };
  paths: { width: number; points: Coordinate[] }[];
  plaza?: Coordinate[];
  crossings: { start: Coordinate; end: Coordinate; depth: number }[];
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

export function addSiteSurfaces(
  data: OpoData, scene: T.Scene, grade: OpoData['ground'], finish: TourMaterials,
  layout: SiteSurfaceLayout, gate?: GateLayout,
) {
  const asphalt = material('#e2ecf8', 'asphalt');
  asphalt.color.multiplyScalar(1.42);
  const paving = material('#c8c1b8', 'pavers');
  const edging = material('#aaa59a');
  const paint = material('#eeeae0');
  const plaza = material('#c2bcaf', 'pavers');
  const frame = gate && axisBetween(data.project(gate.axis[0]), data.project(gate.axis[1]));
  const join = gate && frame?.at(0, (gate.crossing[0] + gate.crossing[1]) / 2);
  const innerDeckLift = 0.15;
  const drivewayGrade = (x: number, z: number) => {
    const blend = gate && join
      ? T.MathUtils.smoothstep(Math.hypot(x - join.x, z - join.z), gate.width * 0.6, gate.width * 1.35)
      : 1;
    return grade(x, z) + T.MathUtils.lerp(streetDeckLift + 0.02, innerDeckLift, blend);
  };
  const decks: { mesh: T.Mesh<T.BufferGeometry>; bounds: T.Box3 }[] = [];
  const ray = new T.Raycaster(undefined, new T.Vector3(0, -1, 0));
  const hits: T.Intersection[] = [];

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

  function curve(points: Coordinate[]) {
    const line = new T.CatmullRomCurve3(points.map(data.project).map(({ x, z }) => new T.Vector3(x, 0, z)));
    return line.getSpacedPoints(Math.ceil(line.getLength() / 1.2));
  }

  function zebra(at: ReturnType<typeof axisBetween>['at'], width: number, start: number, end: number) {
    const markingsGrade = (x: number, z: number) => (elevation({ x, z }) ?? grade(x, z)) + 0.028;
    const stripes = zebraOffsets(width).map(across =>
      ribbon([at(across, start), at(across, end)], 0.44, markingsGrade, 0.11, 0.11));
    if (!stripes.length) return;
    add(mergeGeometries(stripes), paint, undefined, false);
    stripes.forEach(stripe => stripe.dispose());
  }

  const drivewayCenterline: Point[] | undefined = layout.drive && curve(layout.drive.points);
  if (layout.drive && drivewayCenterline) add(ribbon(drivewayCenterline, layout.drive.width,
    (x, z) => drivewayGrade(x, z) + 0.026, 0.8, 1), asphalt, 'asphalt');
  for (const { width, points } of layout.paths) {
    const line = curve(points);
    add(ribbon(line, width + 0.26, (x, z) => grade(x, z) + 0.20), edging);
    add(ribbon(line, width, (x, z) => grade(x, z) + 0.24), paving, 'pavers');
  }

  if (layout.playground) {
    const { outline, surface } = layout.playground;
    const playRing = outline.map(data.project);
    const playFloor = material(surface === 'rubber' ? '#d7dfe2' : '#a69984', surface);
    add(groundPolygon([playRing], grade, 3, 0.25), playFloor, surface);
    add(ribbon([...playRing, playRing[0]], 0.23, (x, z) => grade(x, z) + 0.28), edging);
  }
  if (layout.plaza) add(groundPolygon([layout.plaza.map(data.project)], drivewayGrade, 1.2, 0), plaza, 'pavers');
  if (gate && frame) {
    const { at, length } = frame;
    const [before, after] = gate.roadOverhang;
    add(ribbon([at(0, -before), at(0, length + after)], gate.width, drivewayGrade, 0.8, 1), asphalt, 'asphalt');
    const sidewalk = material('#c7c6be', 'pavers');
    for (const line of gate.sidewalks.points) {
      add(ribbon(line.map(([across, along]) => at(across, along)), gate.sidewalks.width,
        (x, z) => grade(x, z) + streetDeckLift + 0.09, 0.8, 1), sidewalk, 'pavers');
    }
    zebra(at, gate.width, ...gate.crossing);
  }
  for (const { start, end, depth } of layout.crossings) {
    const { at, length } = axisBetween(data.project(start), data.project(end));
    zebra((across, along) => at(along, across + length / 2), length, -depth / 2, depth / 2);
  }
  return { elevation, drivewayGrade, drivewayCenterline };
}
