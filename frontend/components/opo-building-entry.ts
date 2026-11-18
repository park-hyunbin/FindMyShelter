import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { inShape, nearestOnLine, type OpoData, type Point } from './opo-data';
import { ribbon } from './opo-meshes';

export type BuildingEntryLayout = {
  buildingId: string;
  wall: [longitude: number, latitude: number];
  path: [longitude: number, latitude: number];
  width: number;
};

export function buildingEntry(data: OpoData, layout: BuildingEntryLayout, ground: OpoData['ground'], pathLift: number) {
  const building = data.buildings.find(item => item.id === layout.buildingId);
  const shape = building?.shapes[0];
  if (!building || !shape) return;
  const reference = data.project(layout.wall);
  const join = data.project(layout.path);
  const edge = shape[0].map((a, i, ring) => {
    const b = ring[(i + 1) % ring.length];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const hit = nearestOnLine(reference, [[a, b]]);
    return { a, b, length, ...hit };
  }).filter(({ a, b, point, length }) =>
    length >= layout.width + 0.4 && Math.min(Math.hypot(a.x - point.x, a.z - point.z),
      Math.hypot(b.x - point.x, b.z - point.z)) >= layout.width / 2 + 0.2)
    .sort((a, b) => a.distance - b.distance)[0];
  if (!edge || edge.distance > 1.75) return;

  const { a, b, length, point } = edge;
  const right = { x: (b.z - a.z) / length, z: (a.x - b.x) / length };
  const offset = (distance: number): Point => ({ x: point.x + right.x * distance, z: point.z + right.z * distance });
  const side = inShape(offset(0.15), shape) ? -1 : 1;
  const heading = Math.atan2(right.x * side, right.z * side);
  const vestibuleDepth = 1.02;
  const landingDepth = 1.81;
  const tread = 0.31;
  const rise = 0.16;
  const outer = landingDepth + 2 * tread;
  const foot = offset(side * outer);
  if ((join.x - foot.x) * right.x * side + (join.z - foot.z) * right.z * side < 0.25) return;

  const base = ground(foot.x, foot.z) + pathLift;
  const connector = ribbon([join, offset(side * (outer - 0.075))], layout.width,
    (x, z) => ground(x, z) + pathLift + 0.001, 0.65, 0.65);
  const stepDecks: T.BufferGeometry[] = [];
  function step(low: number, high: number, top: number) {
    stepDecks.push(new T.BoxGeometry(layout.width, top + 0.38, high - low)
      .translate(0, (top - 0.38) / 2, (high + low) / 2).rotateY(heading).translate(point.x, base, point.z));
  }
  step(0, landingDepth, rise * 2);
  step(landingDepth, landingDepth + tread, rise);
  step(landingDepth + tread, outer, 0.002);

  const exterior = new T.Group();
  exterior.position.set(point.x, base, point.z);
  exterior.rotation.y = heading;
  exterior.name = `${building.dong ?? building.label} 현관 외관`;
  const stone = new T.MeshStandardMaterial({ color: '#b8bdb5', roughness: 0.85 });
  const frame = new T.MeshStandardMaterial({ color: '#56625f', roughness: 0.71 });
  const glass = new T.MeshStandardMaterial({ color: '#476d65', roughness: 0.32, metalness: 0.14 });
  const metal = new T.MeshStandardMaterial({ color: '#b5beb7', roughness: 0.35, metalness: 0.48 });
  const soffit = new T.MeshStandardMaterial({ color: '#cecabe', roughness: 0.91 });
  const half = layout.width / 2;
  const leaf = layout.width * 0.257;
  const sidelight = half - leaf - 0.16;
  const doorBase = 2 * rise;
  const doorTop = doorBase + 2.28;
  const ceiling = doorTop + 0.23;

  function mesh(geometry: T.BufferGeometry, material: T.Material, x: number, y: number, z: number) {
    const part = new T.Mesh(geometry, material);
    part.position.set(x, y, z);
    part.castShadow = part.receiveShadow = true;
    exterior.add(part);
    return part;
  }
  function box(material: T.Material, width: number, height: number, depth: number, x: number, y: number, z: number) {
    mesh(new T.BoxGeometry(width, height, depth), material, x, y, z);
  }
  mesh(new RoundedBoxGeometry(layout.width + 0.27, 0.26, vestibuleDepth + 0.54, 2, 0.115),
    soffit, 0, ceiling, (vestibuleDepth + 0.26) / 2);
  box(stone, layout.width - 0.06, 0.20, vestibuleDepth, 0, doorTop + 0.075, vestibuleDepth / 2);
  for (const sign of [-1, 1]) {
    const sideX = sign * (half - 0.15);
    box(stone, 0.22, 0.40, vestibuleDepth, sideX, doorBase + 0.20, vestibuleDepth / 2);
    box(stone, 0.22, doorTop - doorBase, 0.21, sideX, (doorTop + doorBase) / 2, vestibuleDepth - 0.105);
    box(glass, 0.061, 1.65, 0.80, sideX, doorBase + 1.225, 0.40);
    box(frame, 0.071, 1.65, 0.053, sideX, doorBase + 1.225, 0.48);
    box(glass, leaf - 0.046, 1.93, 0.045, sign * leaf / 2, doorBase + 1.11, vestibuleDepth + 0.016);
    box(glass, sidelight, 1.64, 0.045, sign * (leaf + sidelight / 2),
      doorBase + 1.19, vestibuleDepth + 0.016);
    box(metal, 0.039, 0.28, 0.07, sign * 0.11, doorBase + 1.03, vestibuleDepth + 0.063);
    box(frame, 0.052, 2.07, 0.047, sign * leaf, doorBase + 1.08, vestibuleDepth + 0.051);

    const x = sign * (half - 0.13);
    const rail = [
      new T.Vector3(x, doorBase + 0.76, vestibuleDepth + 0.20),
      new T.Vector3(x, doorBase + 0.76, landingDepth - 0.07),
      new T.Vector3(x, 0.76, outer - 0.065),
    ];
    for (const [index, end] of rail.slice(1).entries()) {
      const start = rail[index];
      const direction = end.clone().sub(start);
      const mid = start.clone().lerp(end, 0.5);
      const bar = mesh(new T.CylinderGeometry(0.023, 0.023, direction.length(), 10), metal, mid.x, mid.y, mid.z);
      bar.quaternion.setFromUnitVectors(T.Object3D.DEFAULT_UP, direction.normalize());
    }
    for (const [index, point] of rail.entries()) {
      const floor = index === rail.length - 1 ? 0 : doorBase;
      box(metal, 0.046, point.y - floor, 0.046, x, (point.y + floor) / 2, point.z);
    }
  }
  box(stone, layout.width - 0.46, 0.20, 0.12, 0, doorBase + 0.09, vestibuleDepth);
  box(frame, 0.054, 2.00, 0.048, 0, doorBase + 1.12, vestibuleDepth + 0.053);
  box(frame, 2 * leaf + 0.045, 0.062, 0.048, 0, doorBase + 2.07, vestibuleDepth + 0.053);
  return { connector, stepDecks, exterior };
}
