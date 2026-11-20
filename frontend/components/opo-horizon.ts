import { distanceToBuildingCoverage, firstHeightGap, outlineDistance, type OpoData, type Point } from './opo-data';
import { terrainRayBreaks, terrainSurface, type RoofOutline } from './opo-meshes';
import { observationHeight } from './opo-sunlight';

export const horizonRange = 800;
export const horizonChartStep = 50;
type HorizonHit = { angle: number; distance: number; source: string };
export type DirectionProfile = {
  heights: (number | null)[]; hit: HorizonHit | null; terrainAngleBelowBuilding: number | null;
  nearestHeightGap: { label: string; distance: number } | null;
  terrainRange: number; buildingRange: number;
};

export function firstBuildingAhead(data: Pick<OpoData, 'buildings' | 'northOffset' | 'buildingRadius'>, point: Point, bearing: number) {
  const angle = bearing * Math.PI / 180 + data.northOffset;
  const direction = { x: Math.sin(angle), z: -Math.cos(angle) };
  const range = Math.min(horizonRange, distanceToBuildingCoverage(point, direction, data.buildingRadius));
  let nearest: { name: string; distance: number } | null = null;
  for (const building of data.buildings) {
    for (const rings of building.shapes) {
      const distance = outlineDistance(point, direction, rings);
      if (distance <= range && distance < (nearest?.distance ?? Infinity)) nearest = { name: building.dong ?? building.label, distance };
    }
  }
  return { nearest, range };
}

export function directionProfile(data: Pick<OpoData, 'ground' | 'northOffset' | 'heightGaps' | 'buildingRadius'>, roofs: RoofOutline[],
    standingHeight: number, point: Point, bearing: number): DirectionProfile {
  const angle = bearing * Math.PI / 180 + data.northOffset;
  const direction = { x: Math.sin(angle), z: -Math.cos(angle) };
  const base = terrainSurface(data.ground, point.x, point.z);
  const eye = standingHeight + observationHeight;
  const { range: terrainRange, distances } = terrainRayBreaks(point, direction, horizonRange);
  const buildingRange = Math.min(horizonRange, distanceToBuildingCoverage(point, direction, data.buildingRadius));
  const heightAt = (distance: number) => terrainSurface(data.ground,
    point.x + direction.x * distance, point.z + direction.z * distance);
  const heights: (number | null)[] = [0];
  for (let distance = horizonChartStep; distance <= horizonRange; distance += horizonChartStep) {
    heights.push(distance <= terrainRange ? heightAt(distance) - base : null);
  }
  let hit: HorizonHit | null = null;
  // Elevation is linear inside each triangle, so the maximum angle occurs at one of its ends.
  for (const distance of distances) {
    const elevationAngle = Math.atan2(heightAt(distance) - eye, distance) * 180 / Math.PI;
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
  const nearest = firstHeightGap(data.heightGaps, point, direction, Math.min(terrainRange, buildingRange));
  return {
    heights, terrainRange, buildingRange, hit, terrainAngleBelowBuilding: hit === terrainHit ? null : terrainHit?.angle ?? 0,
    nearestHeightGap: nearest && { label: nearest.gap.label, distance: nearest.distance },
  };
}
