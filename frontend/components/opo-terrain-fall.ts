import type { Point } from './opo-data';

const compass = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
export const terrainComparisonM = 30;
const spacingM = 10;

/** Compare ground elevations at equal distances in true compass directions. */
export function terrainFallAt(start: Point, ground: (x: number, z: number) => number, northOffset: number) {
  const elevation = ground(start.x, start.z);
  const rays = compass.map((direction, index) => {
    const angle = northOffset + index * Math.PI / 4;
    const axis = { x: Math.sin(angle), z: -Math.cos(angle) };
    const changes = Array.from({ length: terrainComparisonM / spacingM }, (_, i) => {
      const distance = (i + 1) * spacingM;
      return { distance, change: ground(start.x + axis.x * distance, start.z + axis.z * distance) - elevation };
    });
    return { direction, axis, changes, change: changes.at(-1)!.change };
  });
  const lowest = rays.reduce((best, ray) => ray.change < best.change ? ray : best);
  // A difference that rounds to zero at the displayed precision does not get a direction marker.
  return lowest.change <= -0.05 ? lowest : null;
}
