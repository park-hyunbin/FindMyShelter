import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { OpoData, Point } from './opo-data';
import { curbWalk } from './opo-curb-walk';
import { crosswalkFrame, zebraOffsets, type CrosswalkArea } from './opo-crosswalks';
import { surfaceUV, type TourMaterials, type TourSurface } from './opo-materials';
import { groundPolygon, ribbon, streetDeckLift } from './opo-meshes';
import { createRoadPaintClipper } from './opo-road-paint';

type Coordinate = [longitude: number, latitude: number];
type GateOffset = [across: number, along: number];
type SiteCrossing = { start: Coordinate; end: Coordinate; depth: number };

export type GateLayout = {
  axis: [Coordinate, Coordinate];
  width: number;
  crossing: [start: number, end: number];
  sidewalks: { width: number; points: [GateOffset, GateOffset][] };
};

export type SiteSurfaceLayout = {
  drive?: { width: number; points: Coordinate[] };
  paths: { width: number; points: Coordinate[] }[];
  pavedDrive?: Coordinate[];
  roadsideWalks?: { curb: Coordinate[]; outward: -1 | 1; width: number; beside?: 'driveway'; finish?: 'planted' }[];
  crossings: SiteCrossing[];
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

export function siteCrosswalkArea(project: OpoData['project'], { start, end, depth }: SiteCrossing): CrosswalkArea {
  const { at, length, direction } = axisBetween(project(start), project(end));
  return { center: at(0, length / 2), depth, direction: { x: direction.z, z: -direction.x }, section: { width: length } };
}

export function addSiteSurfaces(
  data: OpoData, scene: T.Scene, grade: OpoData['ground'], finish: TourMaterials,
  layout: SiteSurfaceLayout, roadClearance: (point: Point) => number, gate?: GateLayout,
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

  function curve(points: Coordinate[]) {
    const line = new T.CatmullRomCurve3(points.map(data.project).map(({ x, z }) => new T.Vector3(x, 0, z)));
    return line.getSpacedPoints(Math.ceil(line.getLength() / 1.2));
  }

  function zebra(crossing: CrosswalkArea, clipper: ReturnType<typeof createRoadPaintClipper>) {
    const at = crosswalkFrame(crossing);
    const halfDepth = crossing.depth / 2;
    const stripes = zebraOffsets(crossing.section.width).map(across =>
      ribbon([at(-halfDepth, across), at(halfDepth, across)], 0.44, () => 0));
    if (!stripes.length) return;
    const flat = mergeGeometries(stripes);
    const fitted = clipper.clip(flat, 0.028);
    flat.dispose();
    if (fitted.getAttribute('position').count) add(fitted, paint, undefined, false);
    else fitted.dispose();
    stripes.forEach(stripe => stripe.dispose());
  }

  const drivewayCenterline: Point[] | undefined = layout.drive && curve(layout.drive.points);
  if (layout.pavedDrive) {
    add(groundPolygon([layout.pavedDrive.map(data.project)], drivewayGrade, 0.65, 0), asphalt, 'asphalt');
  } else if (layout.drive && drivewayCenterline) {
    add(ribbon(drivewayCenterline, layout.drive.width, drivewayGrade, 0.8, 1), asphalt, 'asphalt');
  }
  for (const { width, points } of layout.paths) {
    const line = curve(points);
    add(ribbon(line, width + 0.26, (x, z) => grade(x, z) + 0.20), edging);
    add(ribbon(line, width, (x, z) => grade(x, z) + 0.24), paving, 'pavers');
  }
  const streetGrade = (x: number, z: number) => grade(x, z) + streetDeckLift;
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
    for (const line of gate.sidewalks.points) {
      add(ribbon(line.map(([across, along]) => at(across, along)), gate.sidewalks.width,
        (x, z) => grade(x, z) + streetDeckLift + 0.09, 0.8, 1), sidewalk, 'pavers');
    }
  }
  if (crossings.length) {
    const clipper = createRoadPaintClipper();
    asphaltDecks.forEach(clipper.addSurface);
    for (const crossing of crossings) zebra(crossing, clipper);
    clipper.clear();
  }
  return { elevation, drivewayGrade, drivewayCenterline, asphaltDecks };
}
