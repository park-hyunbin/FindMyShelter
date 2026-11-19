import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { songpaEntrance, songpaGateLayout } from './data/songpa-entrance';
import type { OpoData, Point } from './opo-data';
import { surfaceUV, type TourMaterials } from './opo-materials';
import { ribbon } from './opo-meshes';
import { axisBetween, gateGuardRuns } from './opo-site-surfaces';

function surfaceMaterial(color: string, roughness = 0.9) {
  return new T.MeshStandardMaterial({ color, roughness, side: T.DoubleSide });
}

function addGateFixtures(data: OpoData, group: T.Group, grade: OpoData['ground'],
  elevation: (point: Point) => number | undefined, hasLanding: (point: Point) => boolean) {
  const gate = songpaGateLayout;
  const [start, end] = gate.axis.map(data.project);
  const { at, heading } = axisBetween(start, end);
  const paint = surfaceMaterial('#eeeae0');
  const gray = surfaceMaterial('#747d7b');
  const yellow = surfaceMaterial('#ebbf4c');
  const black = surfaceMaterial('#343936');
  const red = surfaceMaterial('#bd413b');
  const grate = surfaceMaterial('#d9ded6');

  function box(across: number, along: number, bottom: number, size: [number, number, number], material: T.Material, onWalk = false) {
    const { x, z } = at(across, along);
    const mesh = new T.Mesh(new T.BoxGeometry(...size), material);
    mesh.rotation.y = heading;
    const base = (onWalk ? elevation({ x, z }) : undefined) ?? grade(x, z);
    mesh.position.set(x, base + bottom + size[1] / 2, z);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }

  for (const side of [-1, 1]) {
    box(side * 4.25, 4.5, 0, [0.49, 0.99, 0.46], gray);
    const crossingCenter = (gate.crossing[0] + gate.crossing[1]) / 2;
    const tactileOffset = side * (gate.width / 2 + 0.66);
    if (!hasLanding(at(tactileOffset, crossingCenter))) continue;
    box(tactileOffset, crossingCenter, 0.015, [0.54, 0.026, 0.85], yellow, true);
    const guard = side * (gate.width / 2 + gate.guards.inset);
    for (const [from, to] of gateGuardRuns(gate)) {
      for (const along of [from, to]) box(guard, along, 0, [0.08, 0.87, 0.08], grate, true);
      for (const height of [0.32, 0.79]) box(guard, (from + to) / 2, height, [0.07, 0.055, to - from], grate, true);
    }
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

export function addSongpaEntrance(data: OpoData, scene: T.Scene, grade: OpoData['ground'],
  gateGrade: OpoData['ground'], elevation: (point: Point) => number | undefined,
  hasLanding: (point: Point) => boolean, finish: TourMaterials) {
  const group = new T.Group();
  addGateFixtures(data, group, gateGrade, elevation, hasLanding);
  addParkingCanopy(data, group, grade, finish);
  scene.add(group);
}
