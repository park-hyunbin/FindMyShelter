import * as T from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { LightSample } from './opo-sunlight';

export function createLightPath(scene: T.Scene, objects: T.Mesh[]) {
  const group = new T.Group();
  group.name = '선택 지점의 햇빛 경로';
  group.visible = false;
  scene.add(group);
  const geometry = new LineGeometry().setPositions([0, 0, 0, 0, 0, 0]);
  const foreground = new LineMaterial({ linewidth: 3, color: '#f8d78b', depthTest: false, depthWrite: false, dashSize: 3, gapSize: 2 });
  const backing = new LineMaterial({ linewidth: 6, color: '#263143', depthTest: false, depthWrite: false, dashSize: 3, gapSize: 2 });
  const line = new Line2(geometry, foreground);
  const stroke = new Line2(geometry, backing);
  stroke.renderOrder = 10;
  line.renderOrder = 11;
  const pointMaterial = new T.MeshBasicMaterial({ color: '#f8d78b', depthTest: false, depthWrite: false });
  const pointGeometry = new T.SphereGeometry(1.1, 12, 8);
  const start = new T.Mesh(pointGeometry, pointMaterial);
  const end = new T.Mesh(pointGeometry, pointMaterial);
  start.renderOrder = end.renderOrder = 12;
  const arrow = new T.Mesh(new T.ConeGeometry(1.8, 5, 12), pointMaterial);
  arrow.renderOrder = 12;
  const outlineMaterial = new T.LineBasicMaterial({
    color: '#f8d78b', depthTest: false, depthWrite: false, transparent: true, opacity: 0.8,
  });
  const outline = new T.LineSegments(new T.BufferGeometry(), outlineMaterial);
  outline.matrixAutoUpdate = false;
  outline.renderOrder = 9;
  group.add(stroke, line, start, end, arrow, outline);
  const bounds = new T.Box3();
  const labelPoint = new T.Vector3();
  let outlinedObjectId: number | null = null;

  function update(sample: LightSample, origin: T.Vector3, direction: T.Vector3, slot: 'A' | 'B') {
    group.visible = sample.status !== 'night';
    bounds.makeEmpty();
    if (!group.visible) return;
    const color = slot === 'A' ? '#f8d78b' : '#91ded0';
    const isUncertain = sample.status === 'unknown';
    foreground.color.set(isUncertain ? '#e5bc86' : color);
    foreground.dashed = backing.dashed = isUncertain;
    outlineMaterial.color.set(color);
    pointMaterial.color.copy(foreground.color);
    start.position.copy(origin);
    const hit = sample.obstruction;
    const target = hit ? new T.Vector3(hit.point.x, hit.point.y, hit.point.z)
      : origin.clone().addScaledVector(direction, 120);
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
        if (outlinedObjectId !== object.id) {
          outline.geometry.dispose();
          outline.geometry = new T.EdgesGeometry(object.geometry);
          outlinedObjectId = object.id;
        }
        outline.matrix.copy(object.matrixWorld);
        outline.visible = true;
        bounds.expandByObject(object);
      }
    }
    bounds.expandByPoint(origin).expandByPoint(target);
    labelPoint.copy(target).add(new T.Vector3(0, 5, 0));
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
