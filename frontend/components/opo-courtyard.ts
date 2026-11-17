import * as T from 'three';
import { groundPolygon, ribbon } from './opo-meshes';
import type { OpoData, Point } from './opo-data';

// Field photos establish the appearance. The aerial image locates the spaces
// relative to the 101 and 104 footprints. Coordinates below are in site metres.
const plaza = { x: 4, z: 28 };
export const courtyard = {
  id: 'courtyard',
  name: '101·104동 중정',
  position: { x: 8, z: 44 },
  lookAt: plaza,
  sources: [
    { name: '단지 조경 사진', url: 'https://kbland.kr/se/c/21160' },
    { name: '계단과 원형 광장 사진', url: 'https://hogangnono.com/apt/6AD09' },
    { name: '항공영상 출처', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer' },
  ],
};
export const courtyardGarden = {
  id: 'courtyard-garden',
  name: '중정 남쪽 정원',
  position: { x: 8, z: 44 },
  lookAt: { x: -4, z: 65 },
};
const points = (coordinates: number[][]): Point[] => coordinates.map(([x, z]) => ({ x, z }));
const circle = (center: Point, rx: number, rz: number, step: number, count: number) => ({
  x: center.x + Math.cos(step / count * Math.PI * 2) * rx,
  z: center.z + Math.sin(step / count * Math.PI * 2) * rz,
});

export function inCourtyardRing(point: Point) {
  return Math.hypot((point.x - plaza.x) / 6.7, (point.z - plaza.z) / 6.15) < 1;
}

export function addCourtyard(scene: T.Scene, surface: OpoData['ground']) {
  const group = new T.Group();
  group.name = '101·104동 중정 · 사진 기반 근사';
  scene.add(group);
  const material = (color: string) => new T.MeshStandardMaterial({ color, roughness: 0.9, side: T.DoubleSide });
  const brick = material('#9d7460'), stone = material('#bdb6a5'), blue = material('#67979c');
  const edge = material('#5c6057'), deck = material('#875e4b'), wall = material('#6e7163'), water = material('#6b938f');
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
    if (finish === brick && brick.map) {
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

  area(points([[-10,22],[4,18],[17,20],[16,39],[9,47],[-2,49],[-12,39]]), brick, 0.09);
  area(points([[-23,24],[-18,22.5],[-13,26],[-9.6,32.6],[-12,38],[-17.5,40],[-21.3,37.7],[-23.3,32.3]]), blue, 0.11);
  strip(points([[-18,43],[-11.6,46.2],[1.3,51.5],[13.4,50.3],[17,46]]), 3.9, stone);
  strip(points([[8,39],[8,44],[13.4,50.3],[13.4,54.2]]), 2.5, brick, 0.37);

  const ring = Array.from({ length: 49 }, (_, i) => circle(plaza, 6.45, 5.9, i, 48));
  area(ring.slice(0, -1), material('#68685b'), 0.17);
  strip(ring, 0.93, stone, 0.65);
  const inner = ring.slice(4, 43);
  strip(inner, 0.12, edge, 1.48);
  const railing = inner.filter((_, index) => index % 2 === 0);
  const post = new T.InstancedMesh(new T.CylinderGeometry(0.044, 0.046, 0.94, 8), edge, railing.length);
  const transform = new T.Object3D();
  railing.forEach(({ x, z }, index) => {
    transform.position.set(x, surface(x, z) + 1.02, z);
    transform.updateMatrix();
    post.setMatrixAt(index, transform.matrix);
  });
  group.add(post);

  const green = material('#729447'), ochre = material('#bc9957'), red = material('#af7353');
  for (const x of [-18.7, -16.2]) {
    object(new T.BoxGeometry(2.15, 0.75, 1.5), green, x, 32.2, 0.83);
    for (const dx of [-0.7, 0.7]) for (const dz of [-0.65, 0.65]) {
      object(new T.BoxGeometry(0.10, 1.6, 0.10), edge, x + dx, 32.2 + dz, 1.15);
    }
    object(new T.BoxGeometry(1.98, 0.14, 1.65), x < -18 ? ochre : red, x, 32.2, 1.93);
  }
  object(new T.BoxGeometry(0.82, 0.10, 1.95), ochre, -15.8, 33.86, 0.79).rotation.x = -0.48;
  for (const [x, z, rotation] of [[12.5, 36.5, 0.23], [-5.7, 40.1, -0.27], [11.8, 43.1, 0.09]]) {
    object(new T.BoxGeometry(2.4, 0.16, 0.56), deck, x, z, 0.78).rotation.y = rotation;
    object(new T.BoxGeometry(1.75, 0.48, 0.21), stone, x, z, 0.51).rotation.y = rotation;
  }

  // The stone ledges and planting follow the rise visible behind the lower plaza.
  const terraceCurve = (z: number, margin: number) => Array.from({ length: 21 }, (_, i) => {
    const t = i / 20;
    const x = -19 + margin + (32 - 2 * margin) * t;
    return { x, z: z + 0.25 * x + Math.sin(t * Math.PI) * 3.6 };
  });
  [58.4, 63.9, 69.4].forEach((z, i) => {
    const path = terraceCurve(z, i * 1.4);
    const vertices: number[] = [], indices: number[] = [];
    path.forEach(({ x, z }, j) => {
      const y = surface(x, z);
      vertices.push(x, y - 0.24, z, x, y + 1.15 + i * 0.13, z);
      if (j) {
        const k = (j - 1) * 2;
        indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    });
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    add(geometry, wall);
    strip(path, 0.48, stone, 1.19 + i * 0.13);
    if (i < 2) strip(path.slice(3, -3).map(p => ({ x: p.x, z: p.z - 0.9 })), 1.55, water, 0.43);
  });

  const stairs = points([[18,58],[20,61],[18.5,65.5],[17,70.5]]);
  strip(stairs, 2.25, deck, 0.35);
  for (let i = 1; i < stairs.length; i++) {
    const a = stairs[i - 1], b = stairs[i];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const count = Math.ceil(length / 0.57);
    for (let step = 0; step < count; step++) {
      const t = (step + 0.5) / count;
      const x = T.MathUtils.lerp(a.x, b.x, t), z = T.MathUtils.lerp(a.z, b.z, t);
      const tread = add(new T.BoxGeometry(2.18, 0.15, length / count), deck);
      tread.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      tread.position.set(x, surface(x, z) + 0.35, z);
    }
  }

  const treeLocations = points([[-25,29],[-23,39],[-16,43],[-10,49],[14,38],[19,32],
    [-23,53],[-11,57],[-4,63],[4,65],[10,58],[15,62],[-17,69],[-4,73],[9,71]]);
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
  group.add(trunks, foliage);
}
