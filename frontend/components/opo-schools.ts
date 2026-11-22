import * as T from 'three';
import { groundPolygon, ribbon } from './opo-meshes';
import type { SchoolCampus } from './data/school-campuses';
import { residentVariants, type AmbientPerson } from './opo-pedestrians';
import type { Point } from './opo-data';

type Runner = { center: Point; radius: number; phase: number; pace: number };
const fieldLift = 0.39;
const twoPi = Math.PI * 2;

function runningPoint(runner: Runner, theta: number) {
  return { x: runner.center.x + Math.cos(theta) * runner.radius,
    z: runner.center.z + Math.sin(theta) * runner.radius * 0.65 };
}

export function addSchoolGrounds(scene: T.Scene, campuses: SchoolCampus[],
  surface: (x: number, z: number) => number, insideBuilding: (point: Point) => boolean) {
  const fields = campuses.filter(campus => campus.field && !insideBuilding(campus.field.center));
  if (!fields.length) return [];

  const group = new T.Group();
  group.name = 'School sports grounds';
  scene.add(group);
  const turf = new T.MeshStandardMaterial({ color: '#92a982', roughness: 0.96 });
  const sand = new T.MeshStandardMaterial({ color: '#c3a177', roughness: 0.98 });
  const paint = new T.MeshStandardMaterial({ color: '#f6e7c9', roughness: 0.92, side: T.DoubleSide });
  const runners: AmbientPerson[] = [];

  for (const campus of fields) {
    const field = campus.field!;
    const court = new T.Mesh(groundPolygon(field.outline, surface, 8, fieldLift),
      field.sport === 'soccer' || field.surface?.includes('grass') ? turf : sand);
    court.name = campus.name + ' 운동장';
    court.receiveShadow = true;
    group.add(court);
    const edge = field.outline[0];
    const paintHeight = (x: number, z: number) => surface(x, z) + fieldLift + .055;
    group.add(new T.Mesh(ribbon([...edge, edge[0]], .28, paintHeight), paint));
    if (field.sport === 'soccer' && field.radiusM >= 9) {
      const ring = Array.from({ length: 33 }, (_, index) => ({
        x: field.center.x + Math.cos(index / 32 * twoPi) * 4,
        z: field.center.z + Math.sin(index / 32 * twoPi) * 4,
      }));
      group.add(new T.Mesh(ribbon(ring, .24, paintHeight), paint));
    }
    const localRunners = campus.level === 'elementary' ? 2 : 1;
    for (let seat = 0; seat < localRunners; seat++) {
      const runner = {
        center: field.center, radius: Math.min(field.radiusM * (.45 + seat * .12), 8 + seat * 1.8),
        phase: seat / localRunners * twoPi, pace: 2.1 + seat * .19,
      };
      if (Array.from({ length: 16 }, (_, index) => runningPoint(runner, twoPi * index / 16)).every(p => !insideBuilding(p))) {
        runners.push({
          variant: residentVariants[seat],
          scale: campus.level === 'elementary' ? .72 : .84,
          range: 120,
          pose(seconds) {
            const theta = seconds * runner.pace / runner.radius + runner.phase;
            const { x, z } = runningPoint(runner, theta);
            return { x, z, y: surface(x, z) + fieldLift + Math.abs(Math.sin(seconds * 14)) * .06,
              heading: Math.atan2(Math.sin(theta), -Math.cos(theta) * .65), speed: runner.pace };
          },
        });
      }
    }
  }
  return runners;
}
