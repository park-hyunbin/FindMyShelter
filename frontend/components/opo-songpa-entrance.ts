import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { OpoData } from './opo-data';

type Coordinate = [longitude: number, latitude: number];

export type ParkingCanopyLayout = {
  sections: [Coordinate, Coordinate][];
  eaveM: number;
  riseM: number;
};

export function addParkingCanopy(data: OpoData, scene: T.Scene, layout: ParkingCanopyLayout, grade: OpoData['ground']) {
  const edges = [0, 1].map(side => new T.CatmullRomCurve3(layout.sections.map(section => {
    const { x, z } = data.project(section[side]);
    return new T.Vector3(x, 0, z);
  })));
  const arcSteps = 16;
  const bays = Math.max(1, Math.round((edges[0].getLength() + edges[1].getLength()) / 3.8));
  const panels: number[] = [];
  const indices: number[] = [];
  const frames: T.BufferGeometry[] = [];
  const gutters: [T.Vector3[], T.Vector3[]] = [[], []];

  for (let bay = 0; bay <= bays; bay++) {
    const [left, right] = edges.map(edge => edge.getPoint(bay / bays));
    const center = left.clone().lerp(right, 0.5);
    const eave = grade(center.x, center.z) + layout.eaveM;
    const profile = Array.from({ length: arcSteps + 1 }, (_, step) => {
      const angle = step * Math.PI / arcSteps;
      const point = left.clone().lerp(right, (1 - Math.cos(angle)) / 2);
      return point.setY(eave + Math.sin(angle) * layout.riseM);
    });
    for (const point of profile) panels.push(point.x, point.y, point.z);
    frames.push(new T.TubeGeometry(new T.CatmullRomCurve3(profile), arcSteps * 2, 0.046, 6));

    for (const [side, point] of [profile[0], profile[arcSteps]].entries()) {
      gutters[side].push(point);
      const ground = grade(point.x, point.z);
      if (point.y > ground) {
        frames.push(new T.BoxGeometry(0.078, point.y - ground, 0.078)
          .translate(point.x, (point.y + ground) / 2, point.z));
      }
    }
    if (bay === 0) continue;
    for (let step = 0; step < arcSteps; step++) {
      const a = (bay - 1) * (arcSteps + 1) + step;
      const b = a + arcSteps + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  for (const gutter of gutters) {
    frames.push(new T.TubeGeometry(new T.CatmullRomCurve3(gutter), bays * 4, 0.058, 6));
  }

  const shell = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(panels, 3));
  shell.setIndex(indices);
  shell.computeVertexNormals();
  const roof = new T.Mesh(shell, new T.MeshStandardMaterial({
    color: '#5a978d', roughness: 0.46, metalness: 0.1, side: T.DoubleSide,
    transparent: true, opacity: 0.55, depthWrite: false,
  }));
  roof.name = '주차장 덮개';
  roof.receiveShadow = true;

  const frameGeometry = mergeGeometries(frames);
  frames.forEach(geometry => geometry.dispose());
  const structure = new T.Mesh(frameGeometry, new T.MeshStandardMaterial({
    color: '#c3cbc3', roughness: 0.57, metalness: 0.23,
  }));
  structure.name = '주차장 덮개 골조';
  structure.castShadow = structure.receiveShadow = true;
  scene.add(roof, structure);
}
