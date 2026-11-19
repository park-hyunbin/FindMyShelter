import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { songpaEntrance } from './data/songpa-entrance';
import type { OpoData } from './opo-data';
import { surfaceUV, type TourMaterials } from './opo-materials';
import { ribbon } from './opo-meshes';
import { axisBetween } from './opo-site-surfaces';

function surfaceMaterial(color: string, roughness = 0.9) {
  return new T.MeshStandardMaterial({ color, roughness, side: T.DoubleSide });
}

export function addSongpaParkingCanopy(data: OpoData, scene: T.Scene, grade: OpoData['ground'], finish: TourMaterials) {
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
  scene.add(roof, structure, walkway, fence);
}
