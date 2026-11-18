import * as T from 'three';
import { groundPolygon, ribbon } from './opo-meshes';
import { surfaceUV, type TourMaterials } from './opo-materials';
import type { OpoData, Point } from './opo-data';
import { addCourtyardGarden } from './opo-garden';

// Field photos establish the appearance. The aerial image locates the spaces
// relative to the 101 and 104 footprints. Coordinates below are in site metres.
const plaza = { x: 4, z: 28 };
export const courtyardOpening = { ...plaza, rx: 5.7, rz: 5.17 };
export const courtyard = {
  id: 'courtyard',
  name: '101·104동 중정',
  position: { x: 8, z: 44 },
  lookAt: plaza,
  sources: [
    { name: '중정과 정원 전경 · KB부동산', url: 'https://file.kbland.kr/image/kbstar/land/img/revw/userseq/1713585/20220524/YjA2YzBjZjI4NWVhYTc4MzMx.jpg' },
    { name: '석재 물길과 데크 · 호갱노노', url: 'https://image.hogangnono.com/image/nowatermark/original/review/20251122000157_W9s7AOe8GjWVAfO1il?q=100&s=720x180&t=outside' },
    { name: '목재 계단 · 호갱노노', url: 'https://image.hogangnono.com/image/nowatermark/original/review/20210120104737_fGmJgIZYSKMe0FlVLa?q=100&s=720x180&t=outside' },
    { name: '원형 계단과 놀이터 · 호갱노노', url: 'https://image.hogangnono.com/image/nowatermark/original/review/20210106122927_cdZ5wu3CSEpZjsoEt7?q=100&s=720x180&t=outside' },
    { name: '항공영상 출처', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer' },
  ],
};
export const courtyardGarden = {
  id: 'courtyard-garden',
  name: '중정 남쪽 정원',
  position: { x: 7.3, z: 58.2 },
  lookAt: { x: -6.5, z: 65.4 },
};
const points = (coordinates: number[][]): Point[] => coordinates.map(([x, z]) => ({ x, z }));
const circle = (center: Point, rx: number, rz: number, step: number, count: number) => ({
  x: center.x + Math.cos(step / count * Math.PI * 2) * rx,
  z: center.z + Math.sin(step / count * Math.PI * 2) * rz,
});

export function inCourtyardRing(point: Point) {
  return Math.hypot((point.x - plaza.x) / 6.7, (point.z - plaza.z) / 6.15) < 1;
}

export function addCourtyard(scene: T.Scene, surface: OpoData['ground'], finish: TourMaterials, ripples: T.Texture | null) {
  const group = new T.Group();
  group.name = '101·104동 중정 · 사진 기반 근사';
  scene.add(group);
  const material = (color: string) => new T.MeshStandardMaterial({ color, roughness: 0.9, side: T.DoubleSide });
  const brick = material('#9d7460'), stone = finish(material('#d1c7b4'), 'cobble'), blue = material('#67979c');
  const edge = material('#5c6057'), deck = material('#875e4b');
  const wall = finish(material('#aaa28d'), 'stonewall');
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 96;
  const paint = canvas.getContext('2d');
  if (paint) {
    paint.fillStyle = '#b4a599';
    paint.fillRect(0, 0, 96, 96);
    for (let row = 0; row < 8; row++) for (let col = -1; col < 8; col++) {
      paint.fillStyle = ['#f1dbca', '#e6d1c1', '#f5e6d9', '#dec9bd'][(row * 7 + (col + 1) * 5) % 4];
      paint.fillRect(col * 16 + (row % 2) * 8 + 0.6, row * 12 + 0.55, 15.3, 11.3);
    }
    brick.map = new T.CanvasTexture(canvas);
    brick.map.wrapS = brick.map.wrapT = T.RepeatWrapping;
    brick.map.colorSpace = T.SRGBColorSpace;
    brick.map.anisotropy = 4;
  }
  const add = (geometry: T.BufferGeometry, finish: T.Material) => {
    const mesh = new T.Mesh(geometry, finish);
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const paved = (geometry: T.BufferGeometry, finish: T.Material) => {
    if (finish === stone) surfaceUV(geometry, 'cobble');
    else if (finish === brick && brick.map) {
      const position = geometry.getAttribute('position');
      const uv = new Float32Array(position.count * 2);
      for (let i = 0; i < position.count; i++) {
        uv[i * 2] = position.getX(i) / 2.8;
        uv[i * 2 + 1] = position.getZ(i) / 2.8;
      }
      geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
    }
    return add(geometry, finish);
  };
  const area = (ring: Point[], finish: T.Material, offset = 0) => paved(groundPolygon([ring], (x, z) => surface(x, z) + offset), finish);
  const strip = (line: Point[], width: number, finish: T.Material, lift = 0.3) => paved(ribbon(line, width, (x, z) => surface(x, z) + lift), finish);
  const object = (geometry: T.BufferGeometry, finish: T.Material, x: number, z: number, height: number) => {
    const mesh = add(geometry, finish);
    mesh.position.set(x, surface(x, z) + height, z);
    mesh.castShadow = true;
    return mesh;
  };

  const opening = Array.from({ length: 64 }, (_, i) => circle(plaza, courtyardOpening.rx + 0.12, courtyardOpening.rz + 0.12, i, 64));
  paved(groundPolygon([points([[-10,22],[4,18],[17,20],[16,39],[9,47],[-2,49],[-12,39]]), opening], surface, 3.2, 0.32), brick);
  area(points([[-23,24],[-18,22.5],[-13,26],[-9.6,32.6],[-12,38],[-17.5,40],[-21.3,37.7],[-23.3,32.3]]), blue, 0.11);
  strip(points([[-18,43],[-11.6,46.2],[1.3,51.5],[13.4,50.3],[17,46]]), 3.9, stone);
  strip(points([[8,39],[8,44],[13.4,50.3],[13.4,54.2]]), 2.5, brick, 0.37);

  const ring = Array.from({ length: 65 }, (_, i) => circle(plaza, 6.01, 5.52, i, 64));
  const wellBottom = surface(plaza.x, plaza.z) - 2.6;
  const inside = Array.from({ length: 65 }, (_, i) => circle(plaza, courtyardOpening.rx, courtyardOpening.rz, i, 64));
  add(groundPolygon([inside.slice(0, -1)], () => wellBottom, 3.4, 0), material('#5b5141'));
  const positions: number[] = [], indices: number[] = [];
  inside.forEach(({ x, z }, i) => {
    positions.push(x, wellBottom - 0.08, z, x, surface(x, z) + 0.34, z);
    if (i > 0) {
      const k = i * 2 - 2;
      indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  });
  const insideWall = new T.BufferGeometry();
  insideWall.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  insideWall.setIndex(indices);
  insideWall.computeVertexNormals();
  surfaceUV(insideWall, 'stonewall', true);
  add(insideWall, wall);
  strip(ring, 0.68, stone, 0.5);
  strip(ring, 0.075, edge, 1.48);
  const railing = ring.slice(0, -1).filter((_, index) => index % 2 === 0);
  const post = new T.InstancedMesh(new T.CylinderGeometry(0.043, 0.046, 0.99, 8), edge, railing.length);
  const transform = new T.Object3D();
  const glass = material('#b2cec4');
  glass.transparent = true;
  glass.opacity = 0.22;
  glass.depthWrite = false;
  railing.forEach(({ x, z }, index) => {
    transform.position.set(x, surface(x, z) + 1.02, z);
    transform.updateMatrix();
    post.setMatrixAt(index, transform.matrix);
    const next = railing[(index + 1) % railing.length];
    const pane = new T.BufferGeometry();
    const from = surface(x, z), to = surface(next.x, next.z);
    pane.setAttribute('position', new T.Float32BufferAttribute([
      x, from + 0.58, z, next.x, to + 0.58, next.z,
      x, from + 1.42, z, next.x, to + 1.42, next.z,
    ], 3));
    pane.setIndex([0, 1, 2, 2, 1, 3]);
    pane.computeVertexNormals();
    add(pane, glass);
  });
  post.castShadow = true;
  group.add(post);

  const recessStair = new T.BoxGeometry(0.54, 0.15, 1.12);
  for (let i = 0; i < 18; i++) {
    const angle = 2.23 + i * 0.096;
    const x = plaza.x + Math.cos(angle) * 4.82, z = plaza.z + Math.sin(angle) * 4.34;
    const tread = add(recessStair, stone);
    tread.position.set(x, Math.max(wellBottom, surface(x, z) + 0.38 - i * 0.155), z);
    tread.rotation.y = angle + Math.PI / 2;
  }
  const green = material('#729447'), yellow = material('#d0ad49'), red = material('#a95442');
  for (const [x, lead] of [[-19.2, true], [-16.45, false]] as const) {
    object(new T.BoxGeometry(2.30, 0.30, 1.29), green, x, 32.1, 0.53);
    for (const dx of [-0.7, 0.7]) for (const dz of [-0.68, 0.68]) {
      const wheel = object(new T.CylinderGeometry(0.24, 0.24, 0.11, 12), red, x + dx, 32.1 + dz, 0.39);
      wheel.rotation.x = Math.PI / 2;
    }
    if (lead) {
      const boiler = object(new T.CylinderGeometry(0.39, 0.39, 1.23, 14), green, x - 0.52, 32.1, 0.99);
      boiler.rotation.z = Math.PI / 2;
      object(new T.CylinderGeometry(0.17, 0.13, 0.33, 10), yellow, x - 0.87, 32.1, 1.43);
    }
    for (const dx of lead ? [0.15, 0.92] : [-0.84, 0.84]) for (const dz of [-0.53, 0.53]) {
      object(new T.BoxGeometry(0.092, 1.15, 0.09), yellow, x + dx, 32.1 + dz, 1.16);
    }
    object(new T.BoxGeometry(lead ? 1.1 : 2.02, 0.14, 1.40), red, x + (lead ? 0.47 : 0), 32.1, 1.78);
  }
  object(new T.BoxGeometry(0.82, 0.10, 1.95), yellow, -15.8, 33.86, 0.79).rotation.x = -0.48;
  for (const [x, z, rotation] of [[12.5, 36.5, 0.23], [-5.7, 40.1, -0.27], [11.8, 43.1, 0.09]]) {
    object(new T.BoxGeometry(2.4, 0.16, 0.56), deck, x, z, 0.78).rotation.y = rotation;
    object(new T.BoxGeometry(1.75, 0.48, 0.21), stone, x, z, 0.51).rotation.y = rotation;
  }

  const treeLocations = points([[-25,29],[-23,39],[-16,43],[-10,49],[14,38],[19,32]]);
  const foliage = new T.InstancedMesh(new T.SphereGeometry(1, 11, 7), material('#a8b17a'), treeLocations.length);
  const trunks = new T.InstancedMesh(new T.CylinderGeometry(0.12, 0.19, 1, 7), deck, treeLocations.length);
  treeLocations.forEach(({ x, z }, index) => {
    const y = surface(x, z), height = 2.7 + (index * 3 % 7) * 0.36;
    transform.position.set(x, y + height / 2, z);
    transform.scale.set(1, height, 1);
    transform.updateMatrix();
    trunks.setMatrixAt(index, transform.matrix);
    transform.position.y = y + height;
    transform.scale.set(1.5 + (index % 3) * 0.19, height * 0.56, 1.47);
    transform.updateMatrix();
    foliage.setMatrixAt(index, transform.matrix);
    foliage.setColorAt(index, new T.Color(['#668650', '#7e9561', '#896748', '#86a365'][index % 4]));
  });
  trunks.castShadow = foliage.castShadow = true;
  foliage.receiveShadow = true;
  group.add(trunks, foliage);
  return addCourtyardGarden(group, surface, finish, ripples);
}
