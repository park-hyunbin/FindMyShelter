import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { OpoData } from './opo-data';

type XYZ = [x: number, y: number, z: number];
type Equipment = 'tower' | 'swing' | 'seesaw' | 'animal-rocker' | 'car-rocker';
export type PlaygroundLayout = {
  origin: [longitude: number, latitude: number];
  equipment: { kind: Equipment; offset: [east: number, south: number]; rotation?: number }[];
};

export function addPlayground(data: OpoData, scene: T.Scene, grade: OpoData['ground'], layout: PlaygroundLayout) {
  const center = data.project(layout.origin);
  const batches = new Map<string, T.BufferGeometry[]>();
  const parts: { color: string; geometry: T.BufferGeometry }[] = [];
  const blue = '#2856ad', steel = '#8c969e', yellow = '#e9a940';
  const path = (points: XYZ[]) => new T.CatmullRomCurve3(points.map(point => new T.Vector3(...point)));

  function piece(geometry: T.BufferGeometry, color: string, [x, y, z]: XYZ, rotation = 0) {
    geometry.rotateY(rotation).translate(x, y, z);
    parts.push({ color, geometry });
  }

  function box(size: XYZ, position: XYZ, color: string, radius = 0) {
    piece(radius ? new RoundedBoxGeometry(...size, 2, radius) : new T.BoxGeometry(...size), color, position);
  }

  function beam(a: XYZ, b: XYZ, radius: number, color: string) {
    const start = new T.Vector3(...a), end = new T.Vector3(...b);
    const direction = end.clone().sub(start);
    const rotation = new T.Quaternion().setFromUnitVectors(T.Object3D.DEFAULT_UP, direction.clone().normalize());
    const mid = start.lerp(end, 0.5);
    piece(new T.CylinderGeometry(radius, radius, direction.length(), 10).applyQuaternion(rotation), color, [mid.x, mid.y, mid.z]);
  }

  function slideChannel(curve: T.CatmullRomCurve3, color: string, width: number, sideHeight: number) {
    const positions: number[] = [], indices: number[] = [];
    const across = 8;
    for (const [row, point] of curve.getPoints(24).entries()) {
      for (let col = 0; col <= across; col++) {
        const offset = 2 * col / across - 1;
        positions.push(point.x + offset * width * 0.5, point.y + Math.abs(offset) ** 6 * sideHeight, point.z);
        if (row && col) {
          const i = row * (across + 1) + col;
          indices.push(i, i - 1, i - across - 1, i - 1, i - across - 2, i - across - 1);
        }
      }
    }
    const body = new T.BufferGeometry();
    body.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    body.setIndex(indices);
    body.computeVertexNormals();
    piece(body, color, [0, 0, 0]);
  }

  function slide(x: number, height: number, color: string) {
    const curve = path([[x, height, 0.58], [x, height - 0.16, 1.14], [x, height * 0.45, 2.15], [x, 0.21, 3.2]]);
    slideChannel(curve, color, 0.78, 0.19);
    beam([x, 0.03, 2.93], [x, 0.19, 2.93], 0.08, blue);
  }

  function platform(x: number, deck: number, roof: number, roofColor: string) {
    for (const xOffset of [-0.71, 0.71]) for (const z of [-0.66, 0.66]) {
      beam([x + xOffset, 0, z], [x + xOffset, roof, z], 0.073, blue);
    }
    box([1.55, 0.13, 1.42], [x, deck, 0], '#3b454a');
    piece(new T.ConeGeometry(1.28, 0.63, 4), roofColor, [x, roof + 0.24, 0], Math.PI / 4);
    for (const z of [-0.66, 0.66]) {
      beam([x - 0.7, deck + 0.86, z], [x + 0.7, deck + 0.86, z], 0.042, yellow);
    }
  }

  function tower() {
    platform(-1.08, 1.68, 3.42, '#168e83');
    platform(1.38, 1.26, 2.92, '#bd6559');
    box([1.12, 0.15, 0.70], [0.14, 1.48, 0], '#b58b32');
    for (const z of [-0.36, 0.36]) beam([-0.38, 2.12, z], [0.7, 1.87, z], 0.07, '#e4ad3b');
    slide(-0.79, 1.68, '#dc785f');
    slide(1.38, 1.26, '#b4dbd6');
    const chute = path([[-1.57, 1.72, 0.06], [-2.53, 1.64, 0.17], [-3.07, 1.20, 1.03], [-2.76, 0.74, 1.77], [-2.49, 0.48, 2.83]]);
    piece(new T.TubeGeometry(chute, 28, 0.43, 12, false), '#788c87', [0, 0, 0]);
    piece(new T.TorusGeometry(0.41, 0.055, 8, 20), '#bf634b', [-2.49, 0.48, 2.84]);
    slideChannel(path([[-2.49, 0.13, 2.76], [-2.47, 0.13, 3.08], [-2.43, 0.18, 3.52]]), '#dc785f', 0.86, 0.18);
    beam([-2.85, 0, 1.98], [-2.85, 0.86, 1.98], 0.04, steel);
    for (let step = 0; step < 6; step++) {
      box([0.64, 0.08, 0.24], [1.28, 0.16 + step * 0.186, -2.01 + step * 0.22], '#424a50');
    }
    for (const x of [0.92, 1.64]) {
      beam([x, 0.05, -2.19], [x, 1.28, -0.69], 0.045, steel);
      beam([x, 0.78, -2.19], [x, 2.02, -0.69], 0.030, steel);
      beam([x, 0.05, -2.19], [x, 0.78, -2.19], 0.030, steel);
    }
  }

  function swing() {
    for (const x of [-1.68, 1.68]) for (const z of [-0.82, 0.82]) {
      beam([x, 0, z], [x, 2.30, 0], 0.047, steel);
    }
    beam([-1.76, 2.30, 0], [1.76, 2.30, 0], 0.047, steel);
    for (const [x, color] of [[-0.78, '#437b66'], [0.78, '#b6414d']] as const) {
      for (const side of [-0.23, 0.23]) beam([x + side, 2.25, 0], [x + side, 0.64, 0], 0.014, color);
      box([0.54, 0.075, 0.31], [x, 0.62, 0], color, 0.035);
    }
  }

  function spring(x: number, color: string) {
    const coil = new T.CatmullRomCurve3(Array.from({ length: 33 }, (_, i) => {
      const angle = i * Math.PI / 4;
      return new T.Vector3(x + Math.cos(angle) * 0.106, 0.05 + 0.30 * i / 32, Math.sin(angle) * 0.106);
    }));
    piece(new T.TubeGeometry(coil, 32, 0.025, 6, false), color, [0, 0, 0]);
  }

  function seesaw() {
    spring(-0.14, blue);
    spring(0.14, blue);
    beam([-1.42, 0.47, 0], [1.42, 0.47, 0], 0.067, blue);
    for (const x of [-1.2, -0.72, 0.72, 1.2]) {
      box([0.27, 0.08, 0.26], [x, 0.51, 0], Math.abs(x) > 1 ? '#c83c50' : yellow, 0.034);
      piece(new T.TorusGeometry(0.14, 0.023, 6, 16), blue, [x, 0.68, 0], Math.PI / 2);
    }
  }

  function rocker(style: 'animal' | 'car') {
    const car = style === 'car';
    const body = car ? '#cb4054' : '#4c90be';
    spring(0, car ? '#576168' : '#c4aa58');
    box([0.92, 0.24, 0.44], [0, 0.46, 0], body, 0.1);
    box([0.34, 0.10, 0.34], [0, 0.59, 0], car ? '#c94354' : '#e2bd64', 0.04);
    if (car) {
      for (const x of [-0.28, 0.28]) for (const z of [-0.25, 0.25]) {
        piece(new T.CylinderGeometry(0.13, 0.13, 0.08, 10).rotateX(Math.PI / 2), body, [x, 0.44, z]);
      }
    } else {
      box([0.32, 0.36, 0.16], [0.34, 0.64, 0], body, 0.075);
    }
    piece(new T.TorusGeometry(0.15, 0.022, 6, 16), car ? body : yellow, [0.13, 0.77, 0], Math.PI / 2);
  }

  const build = { tower, swing, seesaw, 'animal-rocker': () => rocker('animal'), 'car-rocker': () => rocker('car') };
  for (const { kind, offset: [east, south], rotation = 0 } of layout.equipment) {
    const x = center.x + east, z = center.z + south;
    const y = grade(x, z);
    build[kind]();
    for (const { color, geometry } of parts) {
      geometry.rotateY(T.MathUtils.degToRad(rotation)).translate(x, y, z);
      const flat = geometry.index ? geometry.toNonIndexed() : geometry;
      if (flat !== geometry) geometry.dispose();
      flat.deleteAttribute('uv');
      const batch = batches.get(color) ?? [];
      batch.push(flat);
      batches.set(color, batch);
    }
    parts.length = 0;
  }
  const group = new T.Group();
  group.name = '놀이터 기구 모형';
  for (const [color, geometries] of batches) {
    const geometry = mergeGeometries(geometries);
    geometries.forEach(part => part.dispose());
    if (!geometry) continue;
    const material = new T.MeshStandardMaterial({ color, roughness: 0.72, side: T.DoubleSide });
    const mesh = new T.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  scene.add(group);
}
