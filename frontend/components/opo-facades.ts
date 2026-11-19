import { inShape, type OpoData, type Point } from './opo-data';

export type FacadeView = Point & { id: string; label: string; dong: string; bearing: number; direction: string };

export const facadeOffsetM = 3;
const compass = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];

export function facadeViews(data: Pick<OpoData, 'buildings' | 'northOffset' | 'siteOutline'>, canAnalyze: (point: Point) => boolean) {
  if (data.siteOutline.length < 3) return [];
  return data.buildings.flatMap(building => {
    const dong = building.dong;
    if (!dong) return [];
    const ring = building.shapes[0][0];
    const winding = Math.sign(ring.reduce((area, a, i) => {
      const b = ring[(i + 1) % ring.length];
      return area + a.x * b.z - b.x * a.z;
    }, 0));
    if (!winding) return [];
    const faces = new Map<number, { view: FacadeView; length: number }>();
    for (const [i, a] of ring.entries()) {
      const b = ring[(i + 1) % ring.length];
      const dx = b.x - a.x, dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      if (length < 6) continue;
      const nx = winding * dz / length, nz = -winding * dx / length;
      const bearing = ((Math.atan2(nx, -nz) - data.northOffset) * 180 / Math.PI + 720) % 360;
      const sector = Math.round(bearing / 45) % compass.length;
      if (length <= (faces.get(sector)?.length ?? 0)) continue;
      const point = { x: (a.x + b.x) / 2 + facadeOffsetM * nx, z: (a.z + b.z) / 2 + facadeOffsetM * nz };
      if (!canAnalyze(point) || !inShape(point, [data.siteOutline])) continue;
      const direction = compass[sector];
      faces.set(sector, { length, view: {
        ...point, id: `facade-${building.id}-${sector}`, dong, direction, bearing,
        label: `${dong} ${direction}쪽 외벽 바깥`,
      } });
    }
    return [...faces.values()].map(({ view }) => view);
  }).sort((a, b) => a.dong.localeCompare(b.dong) || a.bearing - b.bearing);
}
