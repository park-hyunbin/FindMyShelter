import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { OpoData, Point } from './opo-data';

type XYZ = [number, number, number];
export type LandscapePoint = Point & { mapped?: boolean; form?: 'broadleaf' | 'pine'; species?: string; sidewalkHeight?: number };
export type ShrubPlacement = Point & { y: number; scale: XYZ };

// Horizontal proportions for the shared canopy mesh. These are display profiles.
const speciesCrownScale = new Map([
  ['벚나무류', 1.13], ['양버즘나무', 1.18], ['은행나무', 0.77], ['느티나무', 1.20],
]);

function sampler(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function leafMaterial() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d')!;
  const random = sampler(1693);
  // Draw layers of small leaves, with open space between the groups of stems.
  const clusters = [[0, 0], [-0.48, 0.14], [0.44, 0.1], [0.19, -0.46], [-0.25, -0.37], [-0.17, 0.5], [0.3, 0.44]];
  for (const [x, y] of clusters) for (let leaf = 0; leaf < 55; leaf++) {
    const turn = random() * Math.PI * 2;
    const spread = Math.sqrt(random()) * 58;
    const left = 128 + x * 108 + Math.cos(turn) * spread;
    const top = 128 + y * 108 + Math.sin(turn) * spread * 0.78;
    const amount = Math.round(172 + 69 * random());
    context.fillStyle = `rgb(${amount},${amount},${amount})`;
    context.beginPath();
    context.ellipse(left, top, 3.8 + random() * 6, 2.1 + random() * 3.4, turn + 0.4, 0, Math.PI * 2);
    context.fill();
  }
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  return new T.MeshStandardMaterial({ map: texture, alphaTest: 0.36, roughness: 0.95, side: T.DoubleSide });
}

function sprays(clusters: [center: XYZ, width: number, height: number][]) {
  const quads: T.BufferGeometry[] = [];
  const random = sampler(37783);
  for (const [[x, y, z], width, height] of clusters) {
    const yaw = random() * Math.PI * 2;
    for (let plane = 0; plane < 4; plane++) {
      const tilt = plane === 3 ? -1.28 : (plane % 2 ? -0.3 : 0.28);
      quads.push(new T.PlaneGeometry(width, height)
        .rotateX(tilt).rotateY(yaw + plane * Math.PI / 3)
        .translate(x, y + (plane - 1.5) * 0.009, z));
    }
  }
  const geometry = mergeGeometries(quads)!;
  quads.forEach(quad => quad.dispose());
  return geometry;
}

function woodSegment(start: XYZ, end: XYZ, base: number, tip: number) {
  const from = new T.Vector3(...start), to = new T.Vector3(...end);
  const axis = to.clone().sub(from);
  const length = axis.length();
  const orientation = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), axis.normalize());
  const midpoint = from.add(to).multiplyScalar(0.5);
  return new T.CylinderGeometry(tip, base, length + 0.012, 7, 1, true)
    .applyQuaternion(orientation).translate(midpoint.x, midpoint.y, midpoint.z);
}

function treeGeometry(pine: boolean) {
  const stem: XYZ[] = pine
    ? [[0, -0.04, 0], [-0.019, 0.29, 0.009], [0.025, 0.53, 0.015], [0.063, 0.76, 0.032], [0.047, 0.97, 0.014]]
    : [[0, -0.04, 0], [0.011, 0.22, -0.008], [-0.019, 0.45, 0.009], [0.017, 0.71, -0.018], [0.033, 0.88, 0.016]];
  const wood = stem.slice(1).map((to, index) => woodSegment(stem[index], to, 0.029 - index * 0.006, 0.023 - index * 0.006));
  const leaves: [XYZ, number, number][] = [];
  const random = sampler(pine ? 9489 : 7850);
  for (let branch = 0; branch < 11; branch++) {
    const angle = branch * 2.39996 + random() * 0.3;
    const tier = Math.floor(branch / 4);
    const start = stem[tier + 1];
    const radius = (0.23 - tier * 0.041) * (0.76 + random() * 0.36);
    const y = (pine ? 0.55 : 0.62) + tier * 0.13 + random() * 0.045;
    const end: XYZ = [start[0] + Math.cos(angle) * radius, y, start[2] + Math.sin(angle) * radius];
    const bend: XYZ = [T.MathUtils.lerp(start[0], end[0], 0.59), y - (pine ? 0.046 : 0.09), T.MathUtils.lerp(start[2], end[2], 0.59)];
    wood.push(woodSegment(start, bend, 0.014 - tier * 0.003, 0.008 - tier * 0.0015));
    wood.push(woodSegment(bend, end, 0.008 - tier * 0.0015, 0.002));
    leaves.push([end, (pine ? 0.44 : 0.49) - tier * 0.058, pine ? 0.16 : 0.30]);
    if (branch % 2 === 0) leaves.push([[bend[0], bend[1] + 0.045, bend[2]], 0.28, pine ? 0.12 : 0.23]);
  }
  leaves.push([stem[4], pine ? 0.27 : 0.36, pine ? 0.19 : 0.29]);
  return { wood: mergeGeometriesAndDispose(wood), leaves: sprays(leaves) };
}

function mergeGeometriesAndDispose(parts: T.BufferGeometry[]) {
  const geometry = mergeGeometries(parts)!;
  parts.forEach(part => part.dispose());
  return geometry;
}

export function addLandscapeTrees(group: T.Group, trees: LandscapePoint[], surface: OpoData['ground'], finished: boolean, forest: boolean) {
  if (!trees.length) return;
  const groups = { broadleaf: [] as LandscapePoint[], pine: [] as LandscapePoint[], distant: [] as LandscapePoint[] };
  for (const tree of trees) {
    const random = sampler(Math.imul(Math.round(tree.x * 100), 73428767) ^ Math.round(tree.z * 100));
    const detailed = finished && (tree.mapped || Math.hypot(tree.x, tree.z) <= 430);
    const type = detailed ? (tree.form ?? (random() < 0.28 ? 'pine' : 'broadleaf')) : 'distant';
    groups[type].push(tree);
  }
  const bark = new T.MeshStandardMaterial({ color: '#756453', roughness: 0.97 });
  const leaves = groups.pine.length || groups.broadleaf.length ? leafMaterial() : null;
  const transform = new T.Object3D(), tint = new T.Color();
  for (const type of ['broadleaf', 'pine', 'distant'] as const) {
    const points = groups[type];
    if (!points.length) continue;
    const distant = type === 'distant';
    const geometry = distant ? {
      wood: new T.CylinderGeometry(0.010, 0.029, 0.60, 6).translate(0, 0.28, 0),
      leaves: new T.SphereGeometry(1, 8, 5).scale(0.31, 0.38, 0.28).translate(0, 0.69, 0),
    } : treeGeometry(type === 'pine');
    const trunks = new T.InstancedMesh(geometry.wood, bark, points.length);
    const foliage = new T.InstancedMesh(geometry.leaves,
      distant ? new T.MeshStandardMaterial({ roughness: 0.98 }) : leaves!, points.length);
    foliage.name = `주변 수목 · ${type}`;
    trunks.castShadow = foliage.castShadow = !distant;
    trunks.receiveShadow = foliage.receiveShadow = true;
    points.forEach(({ x, z, species, sidewalkHeight }, index) => {
      const random = sampler(Math.imul(Math.round(x * 100), 73856093) ^ Math.imul(Math.round(z * 100), 19349663));
      const size = random();
      const height = sidewalkHeight !== undefined ? 6.2 + size * 4.2 : forest ? 6.3 + size * 6.5 : 4.1 + size * 5.2;
      transform.position.set(x, sidewalkHeight ?? surface(x, z), z);
      const width = height * (speciesCrownScale.get(species ?? '') ?? 1);
      transform.scale.set(width * (0.86 + random() * 0.29), height, width * (0.86 + random() * 0.29));
      transform.rotation.y = random() * Math.PI * 2;
      transform.updateMatrix();
      trunks.setMatrixAt(index, transform.matrix);
      foliage.setMatrixAt(index, transform.matrix);
      foliage.setColorAt(index, tint.setHSL(type === 'pine' ? 0.225 + random() * 0.05 : 0.18 + random() * 0.067,
        0.25 + random() * 0.12, 0.34 + random() * 0.15, T.SRGBColorSpace));
    });
    group.add(trunks, foliage);
  }
}

function shrubModel() {
  const leaves = sprays([
    [[-0.19, 0.12, 0.1], 1.48, 0.8], [[0.25, 0.12, -0.18], 1.43, 0.83],
    [[0.22, -0.11, 0.16], 1.58, 0.72], [[-0.20, -0.15, -0.18], 1.44, 0.78], [[0, 0.34, 0], 1.35, 0.62],
  ]);
  return { leaves, material: leafMaterial() };
}

export function addShrubPlanting(group: T.Object3D, plants: ShrubPlacement[], name: string) {
  if (!plants.length) return;
  const shrub = shrubModel();
  const shrubs = new T.InstancedMesh(shrub.leaves, shrub.material, plants.length);
  const colors = ['#63754a', '#71835b', '#849264', '#697b53'].map(color => new T.Color(color));
  const transform = new T.Object3D();
  plants.forEach(({ x, y, z, scale }, i) => {
    transform.position.set(x, y, z);
    transform.scale.set(...scale);
    transform.rotation.y = i * 1.9;
    transform.updateMatrix();
    shrubs.setMatrixAt(i, transform.matrix);
    shrubs.setColorAt(i, colors[i % colors.length]);
  });
  shrubs.name = name;
  shrubs.castShadow = shrubs.receiveShadow = true;
  group.add(shrubs);
}
