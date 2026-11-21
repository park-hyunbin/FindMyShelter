import { Raycaster, Vector3, type Intersection, type Mesh } from 'three';
import SunCalc from 'suncalc3';
import { distanceToBuildingCoverage, extent, firstHeightGap, type ObservationPoint, type OpoData, type Point, type Shape } from './opo-data';
import { terrainSurface } from './opo-meshes';

export const interval = 10;
export const observationHeight = 1.5;
export const nearSurfaceHeight = 0.05;
export type LightSample = {
  minute: number; status: 'night' | 'sun' | 'shade' | 'unknown'; cause?: string;
  obstruction?: {
    kind: 'terrain' | 'building'; objectId: number; distance: number;
    point: { x: number; y: number; z: number };
  };
  heightGap?: { label: string; distance: number; requiredHeight: number; rings: Shape; center: Point };
};
export type LightReport = { samples: LightSample[]; sunMinutes: number; unclassifiedMinutes: number };

export function sunAt(data: OpoData, date: string, minute: number) {
  const time = Date.parse(`${date}T00:00:00+09:00`) + minute * 60000;
  const sun = SunCalc.getPosition(time, data.center[1], data.center[0]);
  const azimuth = sun.azimuth + data.northOffset;
  const horizontal = Math.cos(sun.altitude);
  return {
    altitude: sun.altitude,
    direction: new Vector3(horizontal * Math.sin(azimuth), Math.sin(sun.altitude), -horizontal * Math.cos(azimuth)),
  };
}

function possibleUnmappedShade(data: OpoData, origin: Vector3, direction: Vector3): Pick<LightSample, 'cause' | 'heightGap'> | undefined {
  const horizontal = Math.hypot(direction.x, direction.z);
  if (horizontal < 0.0001) return undefined;
  const dx = direction.x / horizontal, dz = direction.z / horizontal;
  const slope = direction.y / horizontal;
  const maxX = ((dx > 0 ? extent : -extent) - origin.x) / (dx || 1e-10);
  const maxZ = ((dz > 0 ? extent : -extent) - origin.z) / (dz || 1e-10);
  const maxDistance = Math.min(dx ? maxX : Infinity, dz ? maxZ : Infinity);
  const modelGround = (x: number, z: number) => terrainSurface(data.ground, x, z);
  const heightNeeded = (center: Point, distance: number) =>
    Math.max(0, origin.y + slope * distance - modelGround(center.x, center.z));
  // Use the same base as the building mesh and the first place its footprint meets the ray.
  const nearest = firstHeightGap(data.heightGaps, origin, { x: dx, z: dz }, maxDistance,
    (gap, distance) => heightNeeded(gap.center, distance) <= data.referenceHeight);
  if (nearest) {
    const { gap, distance } = nearest;
    return { cause: `높이 미확인 · ${gap.label}`,
      heightGap: { label: gap.label, distance, requiredHeight: heightNeeded(gap.center, distance),
        rings: gap.rings, center: gap.center } };
  }

  const leaveAt = distanceToBuildingCoverage(origin, { x: dx, z: dz }, data.buildingRadius, data.buildingCenter);
  for (let distance = leaveAt; distance < maxDistance; distance += 30) {
    if (heightNeeded({ x: origin.x + dx * distance, z: origin.z + dz * distance }, distance) <= data.referenceHeight) {
      return { cause: '건물 표본 밖에서 차폐 가능' };
    }
  }
  return undefined;
}

export function createLightAnalyzer(data: OpoData, terrain: Mesh, buildings: Mesh[], surface = data.ground) {
  const origin = new Vector3();
  const ray = new Raycaster(origin, new Vector3(), 0.05, extent * 3);
  const objects = [terrain, ...buildings];
  const hits: Intersection[] = [];

  function sampleAtTime(date: string, minute: number) {
    const { altitude, direction } = sunAt(data, date, minute);
    return (location: ObservationPoint, height = observationHeight, base?: number): LightSample => {
      if (altitude <= 0) return { minute, status: 'night' };
      origin.set(location.x, (base ?? location.observationBase ?? surface(location.x, location.z)) + height, location.z);
      ray.set(origin, direction);
      hits.length = 0;
      const hit = ray.intersectObjects(objects, false, hits)[0];
      if (hit) return { minute, status: 'shade', cause: hit.object.name,
        obstruction: { kind: hit.object === terrain ? 'terrain' : 'building', objectId: hit.object.id,
          distance: hit.distance, point: { x: hit.point.x, y: hit.point.y, z: hit.point.z } } };

      const uncertain = altitude < 5 * Math.PI / 180 ? { cause: '낮은 태양 고도 · 먼 지형 차폐 가능' }
        : possibleUnmappedShade(data, origin, direction);
      return uncertain ? { minute, status: 'unknown', ...uncertain } : { minute, status: 'sun' };
    };
  }

  const at = (location: ObservationPoint, date: string, minute: number, height = observationHeight) => sampleAtTime(date, minute)(location, height);
  function day(location: ObservationPoint, date: string): LightReport {
    const samples: LightSample[] = [];
    const base = location.observationBase ?? surface(location.x, location.z);
    let sunMinutes = 0, unclassifiedMinutes = 0;
    for (let minute = interval / 2; minute < 1440; minute += interval) {
      const sample = sampleAtTime(date, minute)(location, observationHeight, base);
      samples.push(sample);
      if (sample.status === 'sun') sunMinutes += interval;
      if (sample.status === 'unknown') unclassifiedMinutes += interval;
    }
    return { samples, sunMinutes, unclassifiedMinutes };
  }
  return { at, day, sampleAtTime };
}
