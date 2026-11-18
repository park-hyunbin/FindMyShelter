import * as T from 'three';
import type { LightSample } from './opo-sunlight';

export function createLightPath(scene: T.Scene, objects: T.Mesh[]) {
  const group = new T.Group();
  group.name = '선택 지점의 햇빛 경로';
  group.visible = false;
  scene.add(group);
  const solid = new T.LineBasicMaterial({ color: '#f8d78b', depthTest: false, transparent: true, opacity: 0.95 });
  const uncertain = new T.LineDashedMaterial({
    color: '#e5bc86', depthTest: false, transparent: true, opacity: 0.9, dashSize: 3, gapSize: 2,
  });
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(new Float32Array(6), 3));
  const line = new T.Line<T.BufferGeometry, T.LineBasicMaterial>(geometry, solid);
  line.renderOrder = 10;
  const pointMaterial = new T.MeshBasicMaterial({ color: '#f8d78b', depthTest: false, transparent: true, opacity: 0.95 });
  const pointGeometry = new T.SphereGeometry(1.1, 12, 8);
  const start = new T.Mesh(pointGeometry, pointMaterial);
  const end = new T.Mesh(pointGeometry, pointMaterial);
  start.renderOrder = end.renderOrder = 11;
  const arrow = new T.Mesh(new T.ConeGeometry(1.8, 5, 12), pointMaterial);
  arrow.renderOrder = 11;
  const outlineMaterial = new T.LineBasicMaterial({
    color: '#f8d78b', depthTest: false, transparent: true, opacity: 0.65,
  });
  const outline = new T.LineSegments(new T.BufferGeometry(), outlineMaterial);
  outline.matrixAutoUpdate = false;
  outline.renderOrder = 9;
  group.add(line, start, end, arrow, outline);
  const bounds = new T.Box3();
  const labelPoint = new T.Vector3();
  let outlinedObjectId: number | null = null;

  function update(sample: LightSample, origin: T.Vector3, direction: T.Vector3, slot: 'A' | 'B') {
    group.visible = sample.status !== 'night';
    bounds.makeEmpty();
    if (!group.visible) return;
    const color = slot === 'A' ? '#f8d78b' : '#91ded0';
    solid.color.set(color);
    outlineMaterial.color.set(color);
    pointMaterial.color.set(sample.status === 'unknown' ? '#e5bc86' : color);
    start.position.copy(origin);
    const hit = sample.obstruction;
    const target = hit ? new T.Vector3(hit.point.x, hit.point.y, hit.point.z)
      : origin.clone().addScaledVector(direction, 120);
    const positions = geometry.getAttribute('position');
    positions.setXYZ(0, origin.x, origin.y, origin.z);
    positions.setXYZ(1, target.x, target.y, target.z);
    positions.needsUpdate = true;
    geometry.computeBoundingSphere();
    line.material = sample.status === 'unknown' ? uncertain : solid;
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
    solid.dispose();
    uncertain.dispose();
    pointMaterial.dispose();
    outlineMaterial.dispose();
  }

  return { group, bounds, labelPoint, update, dispose };
}
