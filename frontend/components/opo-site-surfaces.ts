import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { inShape, nearestOnLine, type OpoData, type Point } from './opo-data';
import { zebraOffsets, type CrosswalkArea } from './opo-crosswalks';
import { surfaceUV, type TourMaterials, type TourSurface } from './opo-materials';
import { groundPolygon, ribbon } from './opo-meshes';

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
  playground?: Coordinate[];
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

export function siteSurfaceContains(project: OpoData['project'], layout: SiteSurfaceLayout, gate?: GateLayout) {
  const areas = [layout.plaza, layout.playground].flatMap(ring => ring ? [[ring.map(project)]] : []);
  const lines = [...layout.paths, ...(layout.drive ? [layout.drive] : [])]
    .map(({ width, points }) => ({ width, points: points.map(project) }));
  if (gate) {
    const { at, length } = axisBetween(project(gate.axis[0]), project(gate.axis[1]));
    const [before, after] = gate.roadOverhang;
    lines.push({ width: gate.width, points: [at(0, -before), at(0, length + after)] });
    for (const line of gate.sidewalks.points) {
      lines.push({ width: gate.sidewalks.width, points: line.map(([across, along]) => at(across, along)) });
    }
  }
  return (point: Point) => areas.some(shape => inShape(point, shape))
    || lines.some(({ points, width }) => nearestOnLine(point, [points]).distance <= width / 2 + 0.15);
}

export function addSiteSurfaces(
  data: OpoData, scene: T.Scene, grade: OpoData['ground'], finish: TourMaterials,
  layout: SiteSurfaceLayout, gate?: GateLayout,
) {
  const asphalt = material('#d5d2ca', 'asphalt');
  const paving = material('#c8c1b8', 'pavers');
  const edging = material('#aaa59a');
  const paint = material('#eeeae0');
  const plaza = material('#c2bcaf', 'pavers');

  function material(color: string, texture?: TourSurface) {
    const base = new T.MeshStandardMaterial({ color, roughness: 0.93, side: T.DoubleSide });
    return texture ? finish(base, texture) : base;
  }

  function add(geometry: T.BufferGeometry, value: T.Material, texture?: TourSurface) {
    if (texture) surfaceUV(geometry, texture);
    const mesh = new T.Mesh(geometry, value);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  function strip(points: Point[], width: number, lift: number) {
    return ribbon(points, width, (x, z) => grade(x, z) + lift);
  }

  function curve(points: Coordinate[]) {
    const line = new T.CatmullRomCurve3(points.map(data.project).map(({ x, z }) => new T.Vector3(x, 0, z)));
    return line.getSpacedPoints(Math.ceil(line.getLength() / 1.2));
  }

  function zebra(at: ReturnType<typeof axisBetween>['at'], width: number, start: number, end: number, lift: number) {
    const stripes = zebraOffsets(width).map(across => strip([at(across, start), at(across, end)], 0.44, lift));
    if (!stripes.length) return;
    add(mergeGeometries(stripes), paint);
    stripes.forEach(stripe => stripe.dispose());
  }

  if (layout.drive) add(strip(curve(layout.drive.points), layout.drive.width, 0.19), asphalt, 'asphalt');
  for (const { width, points } of layout.paths) {
    const line = curve(points);
    add(strip(line, width + 0.26, 0.20), edging);
    add(strip(line, width, 0.24), paving, 'pavers');
  }

  if (layout.playground) {
    const playRing = layout.playground.map(data.project);
    const playFloor = material('#a69984', 'granular');
    add(groundPolygon([playRing], grade, 3, 0.25), playFloor, 'granular');
    add(strip([...playRing, playRing[0]], 0.23, 0.28), edging);
  }
  if (layout.plaza) add(groundPolygon([layout.plaza.map(data.project)], grade, 3, 0.12), plaza, 'pavers');
  for (const { start, end, depth } of layout.crossings) {
    const { at, length } = axisBetween(data.project(start), data.project(end));
    zebra((across, along) => at(along, across + length / 2), length, -depth / 2, depth / 2, 0.15);
  }

  if (gate) {
    const { at, length } = axisBetween(data.project(gate.axis[0]), data.project(gate.axis[1]));
    const gateAsphalt = material('#e2ecf8', 'asphalt');
    gateAsphalt.color.multiplyScalar(1.42);
    const [before, after] = gate.roadOverhang;
    add(strip([at(0, -before), at(0, length + after)], gate.width, 0.49), gateAsphalt, 'asphalt');
    zebra(at, gate.width, ...gate.crossing, 0.52);
    const sidewalk = material('#c7c6be', 'pavers');
    for (const line of gate.sidewalks.points) {
      add(strip(line.map(([across, along]) => at(across, along)), gate.sidewalks.width, 0.56), sidewalk, 'pavers');
    }
  }
}
