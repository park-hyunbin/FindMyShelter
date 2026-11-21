import * as T from 'three';
import type { OpoData, Point } from './opo-data';

export function addPedestrianSignals(scene: T.Scene, fixtures: { position: Point; toward: Point }[], ground: OpoData['ground']) {
  if (!fixtures.length) return;
  const n = fixtures.length;
  const steel = new T.MeshStandardMaterial({ color: '#848d8f', roughness: 0.63 });
  const frame = new T.MeshStandardMaterial({ color: '#b7a45a', roughness: 0.76 });
  const black = new T.MeshStandardMaterial({ color: '#212524', roughness: 0.78 });
  const lens = new T.MeshStandardMaterial({ color: '#404846', roughness: 0.35 });
  const boxes = new T.BoxGeometry(1, 1, 1);
  const cylinders = new T.CylinderGeometry(1, 1, 1, 10);
  const bases = new T.InstancedMesh(cylinders, steel, n);
  const poles = new T.InstancedMesh(cylinders, steel, n);
  const mounts = new T.InstancedMesh(boxes, steel, n);
  const backplates = new T.InstancedMesh(boxes, frame, n);
  const housings = new T.InstancedMesh(boxes, black, n);
  const visors = new T.InstancedMesh(boxes, black, n * 2);
  const lenses = new T.InstancedMesh(boxes, lens, n * 2);
  const transform = new T.Object3D();
  fixtures.forEach(({ position: { x, z }, toward }, i) => {
    const y = ground(x, z);
    const yaw = Math.atan2(toward.x - x, toward.z - z);
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    function place(mesh: T.InstancedMesh, index: number, lift: number, setback: number,
      width: number, height: number, depth: number) {
      transform.position.set(x + dx * setback, y + lift, z + dz * setback);
      transform.rotation.y = yaw;
      transform.scale.set(width, height, depth);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    }
    place(bases, i, 0.09, 0, 0.105, 0.18, 0.105);
    place(poles, i, 1.41, 0, 0.069, 2.82, 0.069);
    place(mounts, i, 2.59, 0.085, 0.12, 0.10, 0.19);
    place(backplates, i, 2.59, 0.153, 0.35, 0.63, 0.049);
    place(housings, i, 2.59, 0.216, 0.28, 0.54, 0.124);
    for (const [row, lift] of [2.46, 2.72].entries()) {
      place(visors, i * 2 + row, lift + 0.092, 0.324, 0.235, 0.036, 0.134);
      place(lenses, i * 2 + row, lift, 0.281, 0.164, 0.16, 0.012);
    }
  });
  const models = new T.Group();
  models.name = '서울시 좌표 기반 보행등';
  poles.castShadow = true;
  housings.castShadow = true;
  models.add(bases, poles, mounts, backplates, housings, visors, lenses);
  scene.add(models);
}
