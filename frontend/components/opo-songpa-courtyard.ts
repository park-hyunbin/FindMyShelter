import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { songpaCourtyard } from './data/songpa-grounds';
import type { OpoData, Point } from './opo-data';
import { surfaceUV, type TourMaterials, type TourSurface } from './opo-materials';
import { groundPolygon } from './opo-meshes';
import { addShrubPlanting, type ShrubPlacement } from './opo-vegetation';

export function addSongpaCourtyard(data: OpoData, scene: T.Scene, grade: OpoData['ground'], finish: TourMaterials) {
  const group = new T.Group();
  const mulch = material('#aa9877', 'forest');
  const seat = material('#765244', 'planks');

  function material(color: string, texture?: TourSurface) {
    const base = new T.MeshStandardMaterial({ color, roughness: 0.93, side: T.DoubleSide });
    return texture ? finish(base, texture) : base;
  }

  function surface(geometry: T.BufferGeometry, value: T.Material, texture?: TourSurface) {
    if (texture) surfaceUV(geometry, texture);
    const mesh = new T.Mesh(geometry, value);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const beds = songpaCourtyard.beds.map(ring => ring.map(data.project));
  const curbs: T.BufferGeometry[] = [];
  const plants: ShrubPlacement[] = [];
  for (const bed of beds) {
    surface(groundPolygon([bed], grade, 3, 0.19), mulch, 'forest');
    const center = bed.reduce((sum, point) => ({ x: sum.x + point.x / bed.length, z: sum.z + point.z / bed.length }), { x: 0, z: 0 });
    for (const [index, a] of bed.entries()) {
      const b = bed[(index + 1) % bed.length];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      const sections = Math.ceil(length / 1.25);
      for (let i = 0; i < sections; i++) {
        const x = T.MathUtils.lerp(a.x, b.x, (i + 0.5) / sections);
        const z = T.MathUtils.lerp(a.z, b.z, (i + 0.5) / sections);
        curbs.push(new T.BoxGeometry(0.21, 0.26, length / sections + 0.04)
          .rotateY(Math.atan2(b.x - a.x, b.z - a.z)).translate(x, grade(x, z) + 0.20, z));
        const px = T.MathUtils.lerp(x, center.x, 0.35);
        const pz = T.MathUtils.lerp(z, center.z, 0.35);
        const size = 0.41 + (index + i) % 4 * 0.07;
        plants.push({ x: px, y: grade(px, pz) + 0.50, z: pz, scale: [size * 1.35, size * 0.7, size] });
      }
    }
  }
  const curbMesh = new T.Mesh(mergeGeometries(curbs), new T.MeshStandardMaterial({ color: '#b3a798', roughness: 0.98 }));
  curbs.forEach(geometry => geometry.dispose());
  curbMesh.receiveShadow = true;
  group.add(curbMesh);

  addShrubPlanting(group, plants, '단지 안 화단 관목');

  const { x, z } = data.project(songpaCourtyard.roundSeat);
  const circle = (radius: number) => Array.from({ length: 28 }, (_, i) => ({
    x: x + Math.sin(i * Math.PI / 14) * radius, z: z + Math.cos(i * Math.PI / 14) * radius,
  }));
  const outer = circle(1.45), inner = circle(0.94);
  surface(groundPolygon([outer, inner], grade, 1, 0.53), seat, 'planks');
  surface(groundPolygon([inner], grade, 1, 0.23), mulch, 'forest');
  for (const ring of [outer, inner]) {
    const positions: number[] = [];
    for (const [i, a] of ring.entries()) {
      const b = ring[(i + 1) % ring.length];
      const foot = (point: Point) => [point.x, grade(point.x, point.z) + 0.1, point.z];
      const top = (point: Point) => [point.x, grade(point.x, point.z) + 0.53, point.z];
      positions.push(...foot(a), ...foot(b), ...top(a), ...top(a), ...foot(b), ...top(b));
    }
    const geometry = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    surface(geometry, new T.MeshStandardMaterial({ color: '#9a8a77', roughness: 0.98, side: T.DoubleSide }));
  }
  scene.add(group);
}
