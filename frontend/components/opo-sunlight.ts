import { Raycaster, Vector3, type Mesh } from 'three';
import SunCalc from 'suncalc3';
import { extent, type OpoData, type Point } from './opo-data';

export const interval = 10;
export const observationHeight = 1.5;
export type LightSample = {
  minute: number; status: 'night' | 'sun' | 'shade' | 'unknown'; cause?: string;
  obstruction?: {
    kind: 'terrain' | 'building'; objectId: number; distance: number;
    point: { x: number; y: number; z: number };
  };
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

function possibleUnmappedShade(data: OpoData, origin: Vector3, direction: Vector3) {
  const horizontal = Math.hypot(direction.x, direction.z);
  if (horizontal < 0.0001) return undefined;
  const dx = direction.x / horizontal, dz = direction.z / horizontal;
  const slope = direction.y / horizontal;
  const maxX = ((dx > 0 ? extent : -extent) - origin.x) / (dx || 1e-10);
  const maxZ = ((dz > 0 ? extent : -extent) - origin.z) / (dz || 1e-10);
  const maxDistance = Math.min(dx ? maxX : Infinity, dz ? maxZ : Infinity);
  const requiresHeightAt = (distance: number) => origin.y + slope * distance
    - data.ground(origin.x + dx * distance, origin.z + dz * distance);

  // Screen for an unmapped obstruction up to the tallest known building in this model.
  for (const [outline] of data.heightGaps) {
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i], b = outline[(i + 1) % outline.length];
      const ex = b.x - a.x, ez = b.z - a.z;
      const cross = dx * ez - dz * ex;
      if (Math.abs(cross) < 1e-8) continue;
      const ax = a.x - origin.x, az = a.z - origin.z;
      const distance = (ax * ez - az * ex) / cross;
      const segment = (ax * dz - az * dx) / cross;
      if (segment >= 0 && segment <= 1 && distance > 0.05 && distance <= maxDistance
          && requiresHeightAt(distance) <= data.referenceHeight) return '햇빛 방향에 높이 미확인 건물';
    }
  }

  const towardEdge = origin.x * dx + origin.z * dz;
  const inside = data.buildingRadius ** 2 - origin.x ** 2 - origin.z ** 2;
  const leaveAt = -towardEdge + Math.sqrt(Math.max(0, towardEdge ** 2 + inside));
  for (let distance = Math.max(0, leaveAt); distance < maxDistance; distance += 30) {
    if (requiresHeightAt(distance) <= data.referenceHeight) return '건물 표본 밖에서 차폐 가능';
  }
  return undefined;
}

export function createLightAnalyzer(data: OpoData, terrain: Mesh, buildings: Mesh[], surface = data.ground) {
  const origin = new Vector3();
  const ray = new Raycaster(origin, new Vector3(), 0.05, extent * 3);
  const objects = [terrain, ...buildings];

  function at(location: Point, date: string, minute: number): LightSample {
    const { altitude, direction } = sunAt(data, date, minute);
    if (altitude <= 0) return { minute, status: 'night' };
    origin.set(location.x, surface(location.x, location.z) + observationHeight, location.z);
    ray.set(origin, direction);
    const hit = ray.intersectObjects(objects, false)[0];
    if (hit) return { minute, status: 'shade', cause: hit.object.name,
      obstruction: { kind: hit.object === terrain ? 'terrain' : 'building', objectId: hit.object.id,
        distance: hit.distance, point: { x: hit.point.x, y: hit.point.y, z: hit.point.z } } };

    const cause = altitude < 5 * Math.PI / 180 ? '낮은 태양 고도 · 먼 지형 차폐 가능'
      : possibleUnmappedShade(data, origin, direction);
    return cause ? { minute, status: 'unknown', cause } : { minute, status: 'sun' };
  }

  function day(location: Point, date: string): LightReport {
    const samples: LightSample[] = [];
    let sunMinutes = 0, unclassifiedMinutes = 0;
    for (let minute = interval / 2; minute < 1440; minute += interval) {
      const sample = at(location, date, minute);
      samples.push(sample);
      if (sample.status === 'sun') sunMinutes += interval;
      if (sample.status === 'unknown') unclassifiedMinutes += interval;
    }
    return { samples, sunMinutes, unclassifiedMinutes };
  }
  return { at, day };
}
