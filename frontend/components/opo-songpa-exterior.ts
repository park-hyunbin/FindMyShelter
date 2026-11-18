import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Point } from './opo-data';
import type { TowerExterior } from './data/songpa-architecture';

function materialForCanvas(canvas: HTMLCanvasElement, repeatFloors: boolean) {
  const texture = new T.CanvasTexture(canvas);
  if (repeatFloors) texture.wrapT = T.RepeatWrapping;
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  return new T.MeshStandardMaterial({ map: texture, roughness: 0.82, side: T.DoubleSide });
}

const bayWidth = 128;
const bayHeight = 128;
const bayDesigns = [
  { opening: [0.13, 0.89], glass: '#628b8e', sill: '#8d9c9e', panes: 3 },
  { opening: [0.22, 0.78], glass: '#87a2a0', sill: '#a0a8a1', panes: 2 },
  { opening: [0.31, 0.73], glass: '#729197', sill: '#a8aca5', panes: 2 },
  { opening: [0.12, 0.89], glass: '#719c9d', sill: '#27466d', panes: 3 },
] as const;
const sillLevel = 0.24;
const headLevel = 0.84;

export function songpaExteriorMaterials() {
  const canvas = document.createElement('canvas');
  canvas.width = bayDesigns.length * bayWidth;
  canvas.height = bayHeight;
  const ctx = canvas.getContext('2d')!;
  for (const [index, bay] of bayDesigns.entries()) {
    const start = index * bayWidth;
    const left = start + bay.opening[0] * bayWidth;
    const width = (bay.opening[1] - bay.opening[0]) * bayWidth;
    const top = (1 - headLevel) * bayHeight;
    const bottom = (1 - sillLevel) * bayHeight;
    ctx.fillStyle = index === 2 ? '#d2d4cd' : '#e3e4dc';
    ctx.fillRect(start, 0, bayWidth, bayHeight);
    ctx.fillStyle = '#c4c8c1';
    ctx.fillRect(start + 2, 0, 1, bayHeight);
    ctx.fillRect(start, bayHeight - 2, bayWidth, 1);
    ctx.fillStyle = '#eff0e8';
    ctx.fillRect(start + 3, 0, 2, bayHeight);
    ctx.fillRect(start, bayHeight - 1, bayWidth, 1);
    ctx.fillStyle = '#4f5c5c';
    ctx.fillRect(left - 2, top - 2, width + 4, bottom - top + 5);
    for (let pane = 0; pane < bay.panes; pane++) {
      const span = width / bay.panes;
      const x = left + pane * span;
      const reflection = ctx.createLinearGradient(x, top, x, bottom);
      reflection.addColorStop(0, pane % 2 ? '#9eb5b0' : '#adc5c4');
      reflection.addColorStop(0.17, bay.glass);
      reflection.addColorStop(0.58, pane % 2 ? '#4c666a' : '#647e80');
      reflection.addColorStop(1, '#435a61');
      ctx.fillStyle = reflection;
      ctx.fillRect(x + 2, top + 3, span - 3, bottom - top - 2);
      ctx.fillStyle = '#dbdfd7';
      ctx.fillRect(x, top, 2, bottom - top + 1);
    }
    ctx.fillStyle = '#e9eae3';
    ctx.fillRect(left - 1, top, width + 2, 2);
    ctx.fillRect(left - 1, top + (bottom - top) * 0.56, width + 2, 2);
    ctx.fillRect(left - 1, bottom - 1, width + 2, 3);
    ctx.fillStyle = bay.sill;
    ctx.fillRect(left - 1, bottom + 2, width + 2, bayHeight - bottom - 9);
    ctx.fillStyle = '#edece4';
    ctx.fillRect(left - 1, bottom + 2, width + 2, 2);
  }
  return {
    balconies: materialForCanvas(canvas, true),
    concrete: new T.MeshStandardMaterial({ color: '#d9ddd5', roughness: 0.92, side: T.DoubleSide }),
    plinth: new T.MeshStandardMaterial({ color: '#949b95', roughness: 0.94, side: T.DoubleSide }),
    profiles: new T.MeshStandardMaterial({ color: '#c8d0ca', roughness: 0.66 }),
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
    ctx.fillStyle = '#c7ccc7'; ctx.fillRect(0, (floor + 1) * height - 2, 256, 1.5);
    ctx.fillStyle = '#f0f0e8'; ctx.fillRect(0, (floor + 1) * height - 0.5, 256, 1);
    ctx.fillStyle = '#738286'; ctx.fillRect(119, floor * height + height * 0.56, 18, 5);
  }
  if (number) {
    ctx.textAlign = 'center'; ctx.font = 'bold 43px sans-serif';
    for (const y of [height * 2.55, canvas.height - height * 2.6]) {
      ctx.fillStyle = '#e5e5de'; ctx.fillRect(81, y - 37, 94, 48);
      ctx.fillStyle = '#475056'; ctx.fillText(number, 128, y);
    }
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
  const frames: T.Matrix4[] = [];
  const frame = new T.Object3D();
  const rightHand = points.reduce((area, a, index) => {
    const b = points[(index + 1) % points.length];
    return area + a.x * b.z - b.x * a.z;
  }, 0) > 0;
  function add(geometry: T.BufferGeometry, material: T.Material) {
    const mesh = new T.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = true;
    exterior.add(mesh);
  }
  function wall(a: Point, b: Point, low: number, high: number, material: T.Material,
    u0 = 0, u1 = 1, highV = 1) {
    const left = rightHand ? u1 : u0, right = rightHand ? u0 : u1;
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute([
      b.x, low, b.z, a.x, low, a.z, a.x, high, a.z, b.x, high, b.z,
    ], 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute([right, 0, left, 0, left, highV, right, highV], 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.computeVertexNormals();
    const faces = walls.get(material) ?? [];
    faces.push(geometry);
    walls.set(material, faces);
  }
  for (const [index, a] of points.entries()) {
    const b = points[(index + 1) % points.length];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 0.03) continue;
    const end = record.endFaces.includes(index);
    wall(a, b, bottom, grade, materials.plinth);
    if (end || length < 1.8) {
      wall(a, b, grade, eave, end ? (index === record.numberFace ? numberedEnd : plainEnd) : materials.concrete);
      continue;
    }
    const dx = (b.x - a.x) / length, dz = (b.z - a.z) / length;
    const sign = rightHand ? 1 : -1;
    const nx = dz * sign, nz = -dx * sign;
    const at = (along: number) => ({ x: a.x + dx * along, z: a.z + dz * along });
    const count = Math.max(1, Math.round(length / 3.3));
    const width = length / count;
    frame.rotation.y = -Math.atan2(dz, dx);
    function section(along: number, y: number, span: number, height: number, depth: number) {
      frame.position.set(a.x + dx * along + nx * 0.045, y, a.z + dz * along + nz * 0.045);
      frame.scale.set(span, height, depth);
      frame.updateMatrix();
      frames.push(frame.matrix.clone());
    }
    for (let i = 0; i < count; i++) {
      const style = record.blueSpandrels && count > 1 && i % 3 === 0 ? 3 : (i + index) % 3;
      const from = i * width;
      const start = (style * bayWidth + 0.5) / (bayDesigns.length * bayWidth);
      const end = ((style + 1) * bayWidth - 0.5) / (bayDesigns.length * bayWidth);
      wall(at(from), at(from + width), grade, eave, materials.balconies, start, end, levels);
      const [lo, hi] = bayDesigns[style].opening;
      const left = from + (rightHand ? 1 - hi : lo) * width;
      const right = from + (rightHand ? 1 - lo : hi) * width;
      // Projecting sills and jambs are most noticeable from the pedestrian camera.
      for (let floor = 0; floor < Math.min(levels, 5); floor++) {
        const sill = grade + (floor + sillLevel) * floorHeight;
        const head = grade + (floor + headLevel) * floorHeight;
        section((left + right) / 2, sill, right - left + 0.1, 0.075, 0.16);
        section((left + right) / 2, head, right - left + 0.065, 0.05, 0.11);
        section(left, (sill + head) / 2, 0.049, head - sill, 0.087);
        section(right, (sill + head) / 2, 0.049, head - sill, 0.087);
      }
    }
  }
  for (const [material, faces] of walls) {
    const geometry = mergeGeometries(faces);
    for (const face of faces) face.dispose();
    if (geometry) add(geometry, material);
  }
  if (frames.length) {
    const details = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), materials.profiles, frames.length);
    for (const [index, matrix] of frames.entries()) details.setMatrixAt(index, matrix);
    details.name = '창틀과 창턱';
    details.receiveShadow = true;
    exterior.add(details);
  }
  add(new T.ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, eave, 0), materials.roof);
  const radius = record.roofRadiusM;
  add(new T.CylinderGeometry(radius * 0.94, radius, crownHeight * 0.78, 24)
    .translate(center.x, eave + crownHeight * 0.39, center.z), materials.crown);
  add(new T.CylinderGeometry(radius * 0.86, radius * 0.98, crownHeight * 0.22, 24)
    .translate(center.x, top - crownHeight * 0.11, center.z), materials.trim);
}
