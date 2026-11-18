import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Point } from './opo-data';
import type { TowerExterior } from './data/songpa-architecture';

function materialForCanvas(canvas: HTMLCanvasElement, repeat: boolean) {
  const texture = new T.CanvasTexture(canvas);
  if (repeat) texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  return new T.MeshStandardMaterial({ map: texture, roughness: 0.82, side: T.DoubleSide });
}

export function songpaExteriorMaterials() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#e3e5df'; ctx.fillRect(0, 0, 128, 96);
  ctx.fillStyle = '#acaeaa'; ctx.fillRect(0, 90, 128, 2);
  ctx.fillStyle = '#565c58'; ctx.fillRect(14, 14, 100, 64);
  ctx.fillStyle = '#7b9da0'; ctx.fillRect(18, 18, 92, 55);
  ctx.fillStyle = '#b7cacc'; ctx.fillRect(18, 18, 92, 7);
  ctx.fillStyle = '#436970'; ctx.fillRect(18, 51, 92, 22);
  ctx.fillStyle = '#e9eae4';
  for (const x of [18, 46, 79, 107]) ctx.fillRect(x, 17, 3, 58);
  ctx.fillRect(16, 47, 96, 3);
  ctx.fillRect(10, 76, 108, 4);
  return {
    balconies: materialForCanvas(canvas, true),
    concrete: new T.MeshStandardMaterial({ color: '#e3e4dc', roughness: 0.9, side: T.DoubleSide }),
    roof: new T.MeshStandardMaterial({ color: '#c5c9c1', roughness: 0.96 }),
    crown: new T.MeshStandardMaterial({ color: '#87969e', roughness: 0.62, metalness: 0.23 }),
    trim: new T.MeshStandardMaterial({ color: '#dae0e0', roughness: 0.76 }),
  };
}

function endWallMaterial(number: string, levels: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#e5e5de'; ctx.fillRect(0, 0, 256, 1024);
  ctx.fillStyle = '#c7d2d7'; ctx.fillRect(0, 0, 29, 1024); ctx.fillRect(227, 0, 29, 1024);
  const height = 1024 / levels;
  for (let floor = 0; floor < levels; floor++) {
    ctx.fillStyle = '#ced0c9'; ctx.fillRect(0, (floor + 1) * height - 2, 256, 2);
    ctx.fillStyle = '#738286'; ctx.fillRect(119, floor * height + height * 0.56, 18, 5);
  }
  if (number) {
    ctx.fillStyle = '#e5e5de'; ctx.fillRect(83, height * 1.1, 90, height * 1.8);
    ctx.fillStyle = '#475056'; ctx.textAlign = 'center'; ctx.font = 'bold 48px sans-serif';
    ctx.fillText(number, 128, height * 2.55);
  }
  return materialForCanvas(canvas, false);
}

export function addSongpaTowerExterior(scene: T.Scene, building: {
  label: string; number: string; levels: number; points: Point[]; shape: T.Shape;
  center: Point; grade: number; skirt: number; top: number;
}, record: TowerExterior, materials: ReturnType<typeof songpaExteriorMaterials>) {
  const { points, shape, center, grade, skirt, top, levels } = building;
  const crownHeight = record.roofRadiusM > 4 ? 2.55 : 1.9;
  const eave = top - crownHeight;
  const bottom = grade - skirt;
  const floorHeight = (eave - grade) / levels;
  const exterior = new T.Group();
  exterior.name = `${building.label} 외관`;
  scene.add(exterior);
  const plainEnd = endWallMaterial('', levels);
  const numberedEnd = endWallMaterial(building.number, levels);
  const walls = new Map<T.Material, T.BufferGeometry[]>();
  function add(geometry: T.BufferGeometry, material: T.Material) {
    const mesh = new T.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = true;
    exterior.add(mesh);
  }
  for (const [index, a] of points.entries()) {
    const b = points[(index + 1) % points.length];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const end = record.endFaces.includes(index);
    const material = end ? (index === record.numberFace ? numberedEnd : plainEnd)
      : length < 1.8 ? materials.concrete : materials.balconies;
    const panels = end ? 1 : Math.max(1, Math.round(length / 3.3));
    const baseV = end ? 0 : -skirt / floorHeight;
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute([
      b.x, bottom, b.z, a.x, bottom, a.z, a.x, eave, a.z, b.x, eave, b.z,
    ], 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute([0, baseV, panels, baseV, panels, end ? 1 : levels, 0, end ? 1 : levels], 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.computeVertexNormals();
    const faces = walls.get(material) ?? [];
    faces.push(geometry);
    walls.set(material, faces);
  }
  for (const [material, faces] of walls) {
    const geometry = mergeGeometries(faces);
    for (const face of faces) face.dispose();
    if (geometry) add(geometry, material);
  }
  add(new T.ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, eave, 0), materials.roof);
  const radius = record.roofRadiusM;
  add(new T.CylinderGeometry(radius * 0.94, radius, crownHeight * 0.78, 24)
    .translate(center.x, eave + crownHeight * 0.39, center.z), materials.crown);
  add(new T.CylinderGeometry(radius * 0.86, radius * 0.98, crownHeight * 0.22, 24)
    .translate(center.x, top - crownHeight * 0.11, center.z), materials.trim);
}
