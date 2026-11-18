import * as T from 'three';
import type { Building, OpoData, Point } from './opo-data';
import { inShape } from './opo-data';

export type StreetFacade = {
  wall: string; roof: string; edge: string; glass: string; lower: string;
  front: [longitude: number, latitude: number]; balconies: boolean; storefront: boolean;
};

export function addStreetExterior(style: StreetFacade, building: Building, data: OpoData, points: Point[], base: number, height: number, scene: T.Scene) {
  if (!building.levels || height <= (style.storefront ? 3.6 : 3.2)) return null;
  const material = (color: string, roughness = 0.88) => new T.MeshStandardMaterial({ color, roughness });
  const wall = material(style.wall), roof = material(style.roof), glass = material(style.glass, 0.38);
  const trim = material(style.edge), baseCladding = material(style.lower);
  const shadow = material('#4e5655');
  const fittings = new Map<T.Material, T.Matrix4[]>();
  const face = data.project(style.front);
  const transform = new T.Object3D();
  const groundFloor = style.storefront ? 3.25 : 2.85;
  const upperFloor = (height - groundFloor - 0.35) / Math.max(1, building.levels - 1);

  for (const [i, a] of points.entries()) {
    const b = points[(i + 1) % points.length];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 2.1) continue;
    const dx = (b.x - a.x) / length, dz = (b.z - a.z) / length;
    const middle = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    const sign = inShape({ x: middle.x - dz * 0.32, z: middle.z + dx * 0.32 }, [points]) ? -1 : 1;
    const nx = -dz * sign, nz = dx * sign;
    const frontage = (face.x - middle.x) * nx + (face.z - middle.z) * nz > 1;
    const bays = Math.max(1, Math.round(length / (style.balconies ? 3.8 : 2.9)));
    const span = length / bays;
    const extension = frontage && style.balconies ? 0.72 : 0.17;
    transform.rotation.y = -Math.atan2(dz, dx);

    function box(at: number, y: number, offset: number, width: number, h: number, depth: number, finish: T.Material) {
      transform.position.set(a.x + dx * at + nx * offset, base + y, a.z + dz * at + nz * offset);
      transform.scale.set(width, h, depth);
      transform.updateMatrix();
      const copies = fittings.get(finish) ?? [];
      copies.push(transform.matrix.clone());
      fittings.set(finish, copies);
    }

    box(length / 2, 1.24, 0.021, length, 2.48, 0.10, baseCladding);
    box(length / 2, height - 0.21, 0.11, length, 0.28, 0.28, trim);
    if (frontage && style.storefront) {
      box(length / 2, groundFloor - 0.36, 0.28, length - 0.18, 0.44, 0.58, shadow);
      box(length / 2, groundFloor - 0.55, 0.62, length - 0.25, 0.14, 0.82, trim);
    }
    for (let bay = 0; bay < bays; bay++) {
      const center = (bay + 0.5) * span;
      if (frontage && style.storefront) {
        box(center, 1.33, 0.09, span * 0.84, 2.32, 0.10, glass);
        box(center, 1.33, 0.145, 0.065, 2.32, 0.04, trim);
      }
      for (let floor = 0; floor < building.levels - 1; floor++) {
        const level = groundFloor + floor * upperFloor;
        const width = span * (style.balconies ? 0.85 : 0.69);
        const glassHeight = upperFloor * (style.balconies ? 0.61 : 0.45);
        box(center, level + upperFloor * 0.56, 0.075, width + 0.1, glassHeight + 0.09, 0.11, trim);
        box(center, level + upperFloor * 0.56, 0.14, width, glassHeight, 0.065, glass);
        box(center, level + upperFloor * 0.56, 0.181, 0.063, glassHeight, 0.045, trim);
        if (frontage && style.balconies) {
          box(center, level + 0.09, extension / 2, width + 0.15, 0.19, extension, trim);
          box(center, level + 0.53, extension, width + 0.08, 0.67, 0.065, glass);
          box(center, level + 0.90, extension, width + 0.16, 0.063, 0.084, trim);
        } else {
          box(center, level + upperFloor * 0.24, extension / 2, width + 0.17, 0.09, extension, trim);
        }
      }
    }
  }

  const cube = new T.BoxGeometry(1, 1, 1);
  for (const [finish, matrices] of fittings) {
    const mesh = new T.InstancedMesh(cube, finish, matrices.length);
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  return [roof, wall];
}
