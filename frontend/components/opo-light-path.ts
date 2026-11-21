import * as T from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { OpoData, Shape } from './opo-data';
import type { LightSample } from './opo-sunlight';

export function createLightPath(scene: T.Scene, objects: T.Mesh[], ground: OpoData['ground']) {
  const group = new T.Group();
  group.name = '선택 지점의 햇빛 경로';
  group.visible = false;
  scene.add(group);
  const geometry = new LineGeometry().setPositions([0, 0, 0, 0, 0, 0]);
  const foreground = new LineMaterial({ linewidth: 3, color: '#dcc18d', depthTest: false, depthWrite: false, dashSize: 3, gapSize: 2 });
  const backing = new LineMaterial({ linewidth: 6, color: '#263143', depthTest: false, depthWrite: false, dashSize: 3, gapSize: 2 });
  const line = new Line2(geometry, foreground);
  const stroke = new Line2(geometry, backing);
  stroke.renderOrder = 10;
  line.renderOrder = 11;
  const pointMaterial = new T.MeshBasicMaterial({ color: '#dcc18d', depthTest: false, depthWrite: false });
  const pointGeometry = new T.SphereGeometry(1.1, 12, 8);
  const start = new T.Mesh(pointGeometry, pointMaterial);
  const end = new T.Mesh(pointGeometry, pointMaterial);
  start.renderOrder = end.renderOrder = 12;
  const arrow = new T.Mesh(new T.ConeGeometry(1.8, 5, 12), pointMaterial);
  arrow.renderOrder = 12;
  const outlineMaterial = new T.LineBasicMaterial({
    color: '#dcc18d', depthTest: false, depthWrite: false, transparent: true, opacity: 0.8,
  });
  const outline = new T.LineSegments(new T.BufferGeometry(), outlineMaterial);
  outline.matrixAutoUpdate = false;
  outline.renderOrder = 9;
  group.add(stroke, line, start, end, arrow, outline);
  const bounds = new T.Box3();
  const labelPoint = new T.Vector3();
  let outlined: number | Shape | null = null;

  function update(sample: LightSample, origin: T.Vector3, direction: T.Vector3, slot: 'A' | 'B') {
    group.visible = sample.status !== 'night';
    bounds.makeEmpty();
    if (!group.visible) return;
    const color = slot === 'A' ? '#dcc18d' : '#9bb5af';
    const isUncertain = sample.status === 'unknown';
    foreground.color.set(isUncertain ? '#e5bc86' : color);
    foreground.dashed = backing.dashed = isUncertain;
    outlineMaterial.color.copy(foreground.color);
    pointMaterial.color.copy(foreground.color);
    start.position.copy(origin);
    const hit = sample.obstruction;
    const gap = sample.heightGap;
    const rayLength = gap ? Math.max(18, (gap.distance + 8) / Math.hypot(direction.x, direction.z)) : 120;
    const target = hit ? new T.Vector3(hit.point.x, hit.point.y, hit.point.z)
      : origin.clone().addScaledVector(direction, rayLength);
    const rayStart = geometry.getAttribute('instanceStart');
    const rayEnd = geometry.getAttribute('instanceEnd');
    rayStart.setXYZ(0, origin.x, origin.y, origin.z);
    rayEnd.setXYZ(0, target.x, target.y, target.z);
    rayStart.needsUpdate = true;
    rayEnd.needsUpdate = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    line.computeLineDistances();
    end.position.copy(target);
    end.visible = Boolean(hit);
    arrow.visible = !hit;
    arrow.position.copy(target);
    arrow.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), direction);
    outline.visible = false;
    if (hit?.kind === 'building') {
      const object = objects.find(mesh => mesh.id === hit.objectId);
      if (object) {
        if (outlined !== object.id) {
          outline.geometry.dispose();
          outline.geometry = new T.EdgesGeometry(object.geometry);
          outlined = object.id;
        }
        outline.matrix.copy(object.matrixWorld);
        outline.matrixWorldNeedsUpdate = true;
        outline.visible = true;
        bounds.expandByObject(object);
      }
    }
    bounds.expandByPoint(origin).expandByPoint(target);
    labelPoint.copy(target).add(new T.Vector3(0, 5, 0));
    if (gap) {
      if (outlined !== gap.rings) {
        const points = gap.rings.flatMap(ring => ring.flatMap((point, index) =>
          [point, ring[(index + 1) % ring.length]].map(({ x, z }) => new T.Vector3(x, ground(x, z) + 0.25, z))));
        outline.geometry.dispose();
        outline.geometry = new T.BufferGeometry().setFromPoints(points);
        outline.matrix.identity();
        outline.matrixWorldNeedsUpdate = true;
        outlined = gap.rings;
      }
      outline.visible = true;
      bounds.expandByObject(outline);
      const { x, z } = gap.center;
      labelPoint.set(x, ground(x, z) + 4, z);
    }
  }

  function dispose() {
    group.removeFromParent();
    geometry.dispose();
    pointGeometry.dispose();
    arrow.geometry.dispose();
    outline.geometry.dispose();
    foreground.dispose();
    backing.dispose();
    pointMaterial.dispose();
    outlineMaterial.dispose();
  }

  return { group, bounds, originPoint: start.position, labelPoint, update, dispose };
}
