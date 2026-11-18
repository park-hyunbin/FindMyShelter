import { inShape, type OpoData, type Point, type Shape } from './opo-data';
import { terrainSurface, type RoofOutline } from './opo-meshes';
import { observationHeight } from './opo-sunlight';

export const horizonRange = 800;
const terrainStep = 10;
type HorizonHit = { angle: number; distance: number; source: string };
export type DirectionProfile = {
  heights: number[]; hit: HorizonHit | null; terrainAngleBelowBuilding: number | null; nearestHeightGap: number | null;
};

function outlineDistance(origin: Point, direction: Point, rings: Shape) {
  if (inShape(origin, rings)) return 0;
  let nearest = Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const ex = b.x - a.x, ez = b.z - a.z;
      const cross = direction.x * ez - direction.z * ex;
      const ax = a.x - origin.x, az = a.z - origin.z;
      if (Math.abs(cross) < 1e-8) {
        if (Math.abs(ax * direction.z - az * direction.x) < 1e-8) {
          const first = ax * direction.x + az * direction.z;
          const last = first + ex * direction.x + ez * direction.z;
          if (Math.max(first, last) >= 0) nearest = Math.min(nearest, Math.max(0, Math.min(first, last)));
        }
        continue;
      }
      const distance = (ax * ez - az * ex) / cross;
      const segment = (ax * direction.z - az * direction.x) / cross;
      if (distance >= 0 && segment >= 0 && segment <= 1) nearest = Math.min(nearest, distance);
    }
  }
  return nearest;
}

export function directionProfile(data: Pick<OpoData, 'ground' | 'northOffset' | 'heightGaps'>, roofs: RoofOutline[],
    surface: OpoData['ground'], point: Point, bearing: number): DirectionProfile {
  const angle = bearing * Math.PI / 180 + data.northOffset;
  const direction = { x: Math.sin(angle), z: -Math.cos(angle) };
  const base = terrainSurface(data.ground, point.x, point.z);
  const eye = surface(point.x, point.z) + observationHeight;
  const heights = [0];
  let hit: HorizonHit | null = null;
  for (let distance = terrainStep; distance <= horizonRange; distance += terrainStep) {
    const height = terrainSurface(data.ground, point.x + direction.x * distance, point.z + direction.z * distance);
    if (distance % 50 === 0) heights.push(height - base);
    const elevationAngle = Math.atan2(height - eye, distance) * 180 / Math.PI;
    if (elevationAngle > (hit?.angle ?? 0)) hit = { angle: elevationAngle, distance, source: '주변 지형' };
  }
  const terrainHit = hit;
  for (const roof of roofs) {
    if (roof.elevation <= eye) continue;
    const distance = outlineDistance(point, direction, roof.rings);
    if (distance > horizonRange) continue;
    const elevationAngle = Math.atan2(roof.elevation - eye, distance) * 180 / Math.PI;
    if (elevationAngle > (hit?.angle ?? 0)) hit = { angle: elevationAngle, distance, source: roof.label };
  }
  let nearestHeightGap = Infinity;
  for (const shape of data.heightGaps) nearestHeightGap = Math.min(nearestHeightGap, outlineDistance(point, direction, shape));
  return {
    heights, hit, terrainAngleBelowBuilding: hit === terrainHit ? null : terrainHit?.angle ?? 0,
    nearestHeightGap: nearestHeightGap <= horizonRange ? nearestHeightGap : null,
  };
}
