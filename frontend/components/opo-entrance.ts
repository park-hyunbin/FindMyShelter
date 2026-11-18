import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { OpoData, Point } from './opo-data';
import { ribbon } from './opo-meshes';
import { graniteTileM, surfaceUV, type TourMaterials } from './opo-materials';

export const opoEntranceBridgeId = 835665646;
export const opoEntranceTurnId = 835658906;
export const opoEntranceDrivewayId = 835665645;
export const entranceRoadView = 'https://map.kakao.com/link/roadview/37.351201,127.165458';
export const entranceRoadViewDate = '2025년 12월';
const crossing = [127.1654576, 37.3512126];

function tileGraniteFaces(geometry: T.BufferGeometry) {
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < positions.count; i++) {
    const x = Math.abs(normals.getX(i)), y = Math.abs(normals.getY(i)), z = Math.abs(normals.getZ(i));
    const horizontal = y >= Math.max(x, z);
    const u = !horizontal && x > z ? positions.getZ(i) : positions.getX(i);
    const v = horizontal ? -positions.getZ(i) : positions.getY(i);
    uv.setXY(i, u / graniteTileM, v / graniteTileM);
  }
  return geometry;
}

function gateLettering(y: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 92;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.font = 'bold 50px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e9ddc0';
  ctx.fillText('LOTTE CASTLE', 256, 49);
  ctx.fillStyle = '#655c4e';
  ctx.fillText('LOTTE CASTLE', 255, 47);
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 4;
  const sign = new T.Mesh(new T.PlaneGeometry(4.65, 0.84),
    new T.MeshStandardMaterial({ map, transparent: true, depthWrite: false, roughness: 0.9 }));
  sign.position.set(0, y, -0.646);
  sign.rotation.y = Math.PI;
  return sign;
}

export function addOpoEntrance(data: OpoData, scene: T.Scene, surface: OpoData['ground'], finish: TourMaterials) {
  const bridge = data.streets.find(road => road.id === opoEntranceBridgeId);
  if (!bridge || bridge.points.length < 2) return;
  const mouth = data.project(crossing);
  const end = bridge.points.at(-1)!;
  const length = Math.hypot(end.x - mouth.x, end.z - mouth.z);
  if (length < 3) return;
  const dx = (end.x - mouth.x) / length, dz = (end.z - mouth.z) / length;
  const at = (x: number, station: number): Point => ({
    x: mouth.x + dz * x + dx * station,
    z: mouth.z - dx * x + dz * station,
  });
  const station = length + 6.4;
  const gate = at(0, station);
  const longitudinal = (point: Point) => (point.x - mouth.x) * dx + (point.z - mouth.z) * dz;
  const lateral = (point: Point) => (point.x - mouth.x) * dz - (point.z - mouth.z) * dx;
  const farEnd = at(0, station + 5.1);
  const fromY = surface(mouth.x, mouth.z), toY = surface(farEnd.x, farEnd.z);
  function deckSurface(s: number) {
    return T.MathUtils.lerp(fromY, toY, T.MathUtils.clamp(s / (station + 5.1), 0, 1));
  }
  function paved(point: Point) {
    const s = longitudinal(point), x = lateral(point);
    return s > 0 && s < station + 5.1 && x > -3.52 && x < 5.06;
  }
  const group = new T.Group();
  group.name = '오포 롯데캐슬 정문 · 로드뷰 기반 근사';
  scene.add(group);
  const frame = new T.Group();
  const baseline = deckSurface(station) + 0.50;
  frame.position.set(gate.x, baseline, gate.z);
  frame.rotation.y = Math.atan2(dx, dz);
  group.add(frame);
  const material = (color: string) => new T.MeshStandardMaterial({ color, roughness: 0.9, side: T.DoubleSide });
  const stone = finish(material('#c9bfad'), 'granite');
  const light = finish(material('#ded6c5'), 'granite');
  const plinth = finish(material('#a8a08c'), 'granite');
  const stoneMaterials = new Set<T.Material>([stone, light, plinth]);
  const joint = material('#9b917f'), inset = material('#aaa291'), glass = material('#3c4b4d');
  glass.roughness = 0.32;
  const rail = material('#d8dad1'), edge = material('#8d8b7e'), asphalt = finish(material('#faf4ec'), 'asphalt');
  const pavers = finish(material('#e1d9cc'), 'cobble');
  const white = material('#f4efe3'), yellow = material('#e6b343');
  const unitBox = new T.BoxGeometry(1, 1, 1);
  const boxes = new Map<T.Material, T.Object3D[]>();

  function box(x: number, y: number, z: number, width: number, height: number, depth: number, mat: T.Material) {
    const transform = new T.Object3D();
    transform.position.set(x, y + height / 2, z);
    transform.scale.set(width, height, depth);
    const batch = boxes.get(mat);
    if (batch) batch.push(transform);
    else boxes.set(mat, [transform]);
    return transform;
  }
  function relief(shape: T.Shape, depth: number, z: number, mat: T.Material, bevel = 0.035) {
    const geometry = new T.ExtrudeGeometry(shape, {
      depth, curveSegments: 18, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1,
    });
    geometry.translate(0, 0, z);
    if (stoneMaterials.has(mat)) tileGraniteFaces(geometry);
    const mesh = new T.Mesh(geometry, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    frame.add(mesh);
  }

  // The square piers with smaller pilasters and the shallow arch are visible from Suresil-gil.
  for (const x of [-4.45, 4.45]) {
    const point = at(x, station);
    const foot = surface(point.x, point.z) - baseline - 0.05;
    box(x, foot, 0, 1.42, 0.69 - foot, 1.62, plinth);
    box(x, 0.65, 0, 1.19, 4.01, 1.42, stone);
    for (const offset of [-0.39, 0.39]) {
      box(x + offset, 0.66, -0.73, 0.23, 3.68, 0.24, light);
      box(x + offset, 0.64, -0.75, 0.36, 0.23, 0.3, plinth);
      box(x + offset, 4.14, -0.75, 0.37, 0.25, 0.3, light);
    }
    for (const y of [1.27, 2.03, 2.79, 3.55]) box(x, y, -0.717, 1.14, 0.018, 0.015, joint);
    box(x, 4.46, 0, 1.41, 0.22, 1.65, plinth);
    box(x, 4.68, 0, 1.61, 0.22, 1.82, light);
  }
  const arch = new T.Shape();
  arch.moveTo(-4.51, 3.39);
  arch.bezierCurveTo(-3.85, 4.62, 3.85, 4.62, 4.51, 3.39);
  arch.lineTo(4.51, 5.12);
  arch.lineTo(-4.51, 5.12);
  arch.closePath();
  relief(arch, 1.29, -0.645, stone);
  const moulding = new T.Shape();
  moulding.moveTo(-4.51, 3.38);
  moulding.bezierCurveTo(-3.85, 4.62, 3.85, 4.62, 4.51, 3.38);
  moulding.lineTo(4.51, 3.56);
  moulding.bezierCurveTo(3.85, 4.79, -3.85, 4.79, -4.51, 3.56);
  moulding.closePath();
  relief(moulding, 0.09, -0.742, light, 0.015);
  box(0, 4.91, 0, 10.33, 0.15, 1.55, plinth);
  box(0, 5.06, 0, 10.56, 0.17, 1.68, light);
  box(0, 5.23, 0, 10.72, 0.12, 1.77, stone);
  for (let x = -4.95; x <= 4.95; x += 0.23) box(x, 4.98, -0.8, 0.095, 0.105, 0.1, light);

  const pediment = new T.Shape();
  pediment.moveTo(-3.46, 5.35);
  pediment.bezierCurveTo(-2.3, 5.64, -1.95, 6.54, 0, 6.54);
  pediment.bezierCurveTo(1.95, 6.54, 2.3, 5.64, 3.46, 5.35);
  pediment.closePath();
  relief(pediment, 1.19, -0.61, light);
  const sign = gateLettering(5.76);
  if (sign) frame.add(sign);

  // The low stone wing is to the driver's right when entering the complex.
  const wingPoint = at(-7.2, station + 0.8);
  const wingFoot = surface(wingPoint.x, wingPoint.z) - baseline - 0.1;
  box(-7.25, wingFoot, 0.62, 4.39, 2.87 - wingFoot, 2.64, stone);
  box(-7.25, 2.85, 0.62, 4.61, 0.16, 2.83, plinth);
  box(-7.25, 3.01, 0.62, 4.68, 0.12, 2.9, light);
  for (const x of [-8.53, -7.17, -5.79]) box(x, 0.31, -0.73, 0.22, 2.34, 0.16, light);
  for (const x of [-7.85, -6.48]) {
    function windowShape(width: number, low: number, base: number, crown: number) {
      const shape = new T.Shape();
      shape.moveTo(x - width, low);
      shape.lineTo(x - width, base);
      shape.quadraticCurveTo(x, crown, x + width, base);
      shape.lineTo(x + width, low);
      shape.closePath();
      return shape;
    }
    relief(windowShape(0.52, 0.63, 1.62, 2.75), 0.07, -0.78, inset);
    relief(windowShape(0.4, 0.74, 1.61, 2.5), 0.025, -0.83, glass, 0.01);
    box(x, 1.57, -0.852, 0.85, 0.075, 0.07, light);
    box(x, 0.66, -0.79, 1.11, 0.09, 0.19, light);
  }

  function lane(x: number, start: number, end: number, width: number, height: number, mat: T.Material, surfaceName?: 'asphalt' | 'cobble') {
    const line = [at(x, start)];
    for (let s = Math.ceil(start * 2) / 2; s < end; s += 0.5) {
      if (s - start > 0.04) line.push(at(x, s));
    }
    line.push(at(x, end));
    const geometry = ribbon(line, width, (x, z) => deckSurface(longitudinal({ x, z })) + height);
    if (surfaceName) surfaceUV(geometry, surfaceName);
    const mesh = new T.Mesh(geometry, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  lane(0, 0.1, station + 5.1, 6.6, 0.50, asphalt, 'asphalt');
  lane(4.12, 0.82, station + 2.6, 1.7, 0.64, pavers, 'cobble');
  lane(3.29, 0.78, station + 2.6, 0.20, 0.61, edge);
  lane(0, 4.65, station - 0.9, 0.12, 0.535, yellow);
  for (let x = -2.78; x <= 2.9; x += 0.72) lane(x, 0.82, 3.34, 0.41, 0.54, white);
  lane(1.66, 4.28, 4.52, 2.6, 0.54, white);

  function guardrail(x: number) {
    const start = 2.75, finish = length + 3.3, bays = Math.ceil((finish - start) / 1.62);
    const localStart = start - station, spacing = (finish - start) / bays;
    function y(s: number) {
      return deckSurface(s + station) - baseline;
    }
    for (let i = 0; i <= bays; i++) {
      const s = localStart + i * spacing;
      box(x, y(s) + 0.62, s, 0.095, 0.88, 0.10, rail);
      if (i === bays) break;
      const far = s + spacing;
      const elevation = y(far) - y(s);
      const middle = (y(s) + y(far)) / 2;
      box(x, middle + 0.16, (s + far) / 2, 0.28, 0.52, spacing + 0.02, edge).rotation.x = -Math.atan2(elevation, spacing);
      for (const h of [0.9, 1.35]) {
        box(x, middle + h, (s + far) / 2, 0.09, 0.095, Math.hypot(spacing, elevation) + 0.02, rail)
          .rotation.x = -Math.atan2(elevation, spacing);
      }
    }
  }
  for (const x of [-3.43, 5]) guardrail(x);
  const stem = material('#81705a'), leaves = material('#526b40');
  const crown = new T.IcosahedronGeometry(1, 2);
  for (const [x, z, height] of [[-10.9, 2.1, 2.6], [-9.7, 4.2, 2.2], [6.5, 4.6, 1.0], [5.8, 2.8, 0.88]]) {
    const position = at(x, station + z);
    const base = surface(position.x, position.z) - baseline;
    box(x, base, z, 0.16, height * 0.42, 0.16, stem);
    const shrub = new T.Mesh(crown, leaves);
    shrub.position.set(x, base + height * 0.72, z);
    shrub.scale.set(height * 0.63, height * 0.36, height * 0.51);
    shrub.castShadow = shrub.receiveShadow = true;
    frame.add(shrub);
  }

  for (const [mat, batch] of boxes) {
    let mesh: T.Mesh;
    if (stoneMaterials.has(mat)) {
      const slabs = batch.map(transform => {
        transform.updateMatrix();
        return tileGraniteFaces(unitBox.clone().applyMatrix4(transform.matrix));
      });
      const geometry = mergeGeometries(slabs)!;
      slabs.forEach(slab => slab.dispose());
      mesh = new T.Mesh(geometry, mat);
    } else {
      const instances = new T.InstancedMesh(unitBox, mat, batch.length);
      batch.forEach((transform, index) => {
        transform.updateMatrix();
        instances.setMatrixAt(index, transform.matrix);
      });
      mesh = instances;
    }
    mesh.castShadow = mesh.receiveShadow = true;
    frame.add(mesh);
  }

  return {
    gate,
    paved,
    elevation(point: Point) {
      if (paved(point)) return deckSurface(longitudinal(point)) + (lateral(point) > 3.29 ? 0.64 : 0.5);
    },
    occupied(point: Point) {
      const x = lateral(point), z = longitudinal(point) - station;
      return (Math.abs(Math.abs(x) - 4.45) < 0.71 && Math.abs(z) < 0.83)
        || (Math.abs(x + 7.25) < 2.2 && Math.abs(z - 0.62) < 1.33);
    },
  };
}
