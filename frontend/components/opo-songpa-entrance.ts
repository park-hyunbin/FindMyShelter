import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { songpaEntrance } from './data/songpa-entrance';
import type { OpoData, Point } from './opo-data';
import { surfaceUV, type TourMaterials } from './opo-materials';
import { ribbon } from './opo-meshes';
import { zebraOffsets } from './opo-crosswalks';

function axisBetween(start: Point, end: Point) {
  const length = Math.hypot(end.x - start.x, end.z - start.z);
  const dx = (end.x - start.x) / length;
  const dz = (end.z - start.z) / length;
  return {
    length,
    heading: Math.atan2(dx, dz),
    at: (across: number, along: number) => ({ x: start.x + dz * across + dx * along, z: start.z - dx * across + dz * along }),
  };
}

function surfaceMaterial(color: string, roughness = 0.9) {
  return new T.MeshStandardMaterial({ color, roughness, side: T.DoubleSide });
}

function addMainCrossing(data: OpoData, group: T.Group, grade: OpoData['ground'], finish: TourMaterials) {
  const [start, end] = songpaEntrance.main.axis.map(data.project);
  const { at, heading, length } = axisBetween(start, end);
  const asphalt = finish(surfaceMaterial('#e2ecf8'), 'asphalt');
  asphalt.color.multiplyScalar(1.42);
  const pavers = finish(surfaceMaterial('#898986'), 'cobble');
  const paint = surfaceMaterial('#eeeae0');
  const gray = surfaceMaterial('#747d7b');
  const yellow = surfaceMaterial('#ebbf4c');
  const black = surfaceMaterial('#343936');
  const red = surfaceMaterial('#bd413b');
  const grate = surfaceMaterial('#d9ded6');

  const strip = (points: Point[], width: number, lift: number) => ribbon(points, width, (x, z) => grade(x, z) + lift);
  const apron = strip([at(0, -2.4), at(0, length + 2.2)], 9.4, 0.49);
  surfaceUV(apron, 'asphalt');
  const crossing = mergeGeometries(zebraOffsets(9.4).map(across => strip([at(across, 0.15), at(across, 2.05)], 0.44, 0.52)));
  const sidewalks = [
    [at(-7.2, 0.9), at(-4.7, 0.9)],
    [at(4.7, 0.9), at(7.2, 0.9)],
    [at(-13, -7), at(12, -7)],
  ];
  const walkway = mergeGeometries(sidewalks.map(points => {
    const geometry = strip(points, 1.65, 0.56);
    surfaceUV(geometry, 'cobble');
    return geometry;
  }));
  for (const mesh of [new T.Mesh(apron, asphalt), new T.Mesh(crossing, paint), new T.Mesh(walkway, pavers)]) {
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  function box(across: number, along: number, bottom: number, size: [number, number, number], material: T.Material) {
    const { x, z } = at(across, along);
    const mesh = new T.Mesh(new T.BoxGeometry(...size), material);
    mesh.rotation.y = heading;
    mesh.position.set(x, grade(x, z) + 0.49 + bottom + size[1] / 2, z);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }

  for (const side of [-1, 1]) {
    box(side * 5.3, 1.05, 0.08, [0.54, 0.026, 0.85], yellow);
    box(side * 4.25, 4.5, 0, [0.49, 0.99, 0.46], gray);
    for (const along of [0.0, 1.8, 3.6]) box(side * 5.02, along, 0, [0.08, 0.87, 0.08], grate);
    for (const height of [0.32, 0.79]) box(side * 5.02, 1.8, height, [0.07, 0.055, 3.6], grate);
  }
  for (let index = 0; index < 8; index++) {
    box(0, 3.1 + index * 0.49, 0, [0.82, 0.17, 0.49], index % 2 === 0 ? yellow : black);
  }
  box(0, 4.33, 0.17, [0.46, 0.79, 0.52], gray);
  for (let index = 0; index < 10; index++) {
    box(0.19, 4.33, 0.93 + index * 0.225, [0.1, 0.225, 0.085], index % 2 === 0 ? red : paint);
  }
}

function addParkingCanopy(data: OpoData, group: T.Group, grade: OpoData['ground'], finish: TourMaterials) {
  const [start, end] = songpaEntrance.garage.axis.map(data.project);
  const { at, length } = axisBetween(start, end);
  const arcSteps = 16;
  const bays = 10;
  const halfWidth = 3.2;
  const panels: number[] = [];
  const indices: number[] = [];
  const ribs: T.BufferGeometry[] = [];
  const profile = (along: number) => Array.from({ length: arcSteps + 1 }, (_, step) => {
    const angle = step * Math.PI / arcSteps;
    const { x, z } = at(Math.cos(angle) * halfWidth, along);
    return new T.Vector3(x, grade(x, z) + 0.74 + Math.sin(angle) * 2.55, z);
  });

  for (let bay = 0; bay <= bays; bay++) {
    const points = profile(bay * length / bays);
    for (const point of points) panels.push(point.x, point.y, point.z);
    ribs.push(new T.TubeGeometry(new T.CatmullRomCurve3(points), arcSteps, 0.055, 5));
    if (bay === 0) continue;
    for (let step = 0; step < arcSteps; step++) {
      const a = (bay - 1) * (arcSteps + 1) + step;
      const b = a + arcSteps + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const shell = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(panels, 3));
  shell.setIndex(indices);
  shell.computeVertexNormals();
  const roof = new T.Mesh(shell, surfaceMaterial('#428579', 0.5));
  const structure = new T.Mesh(mergeGeometries(ribs), surfaceMaterial('#c3d0c9', 0.51));
  roof.castShadow = roof.receiveShadow = true;
  structure.receiveShadow = true;

  const terrace = ribbon([at(5.9, -2), at(5.9, length + 1.4)], 1.75, (x, z) => grade(x, z) + 0.56);
  surfaceUV(terrace, 'cobble');
  const walkway = new T.Mesh(terrace, finish(surfaceMaterial('#a6a29b'), 'cobble'));
  walkway.receiveShadow = true;

  const fenceAt = (along: number, height: number) => {
    const { x, z } = at(4.65, along);
    return new T.Vector3(x, grade(x, z) + height, z);
  };
  const posts = Array.from({ length: bays + 1 }, (_, index) => {
    const point = fenceAt(index * length / bays, 0.93);
    return new T.BoxGeometry(0.075, 0.96, 0.075).translate(point.x, point.y, point.z);
  });
  const rails = [0.72, 1.32].map(height => new T.TubeGeometry(new T.CatmullRomCurve3(
    Array.from({ length: bays + 1 }, (_, index) => fenceAt(index * length / bays, height)),
  ), bays * 3, 0.035, 6));
  const fence = new T.Mesh(mergeGeometries([...posts, ...rails]), surfaceMaterial('#e1e1d7'));
  fence.castShadow = fence.receiveShadow = true;
  group.add(roof, structure, walkway, fence);
}

export function addSongpaEntrance(data: OpoData, scene: T.Scene, grade: OpoData['ground'], finish: TourMaterials) {
  const group = new T.Group();
  addMainCrossing(data, group, grade, finish);
  addParkingCanopy(data, group, grade, finish);
  scene.add(group);
}
