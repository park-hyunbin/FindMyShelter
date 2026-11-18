import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export function makeCar(color = '#c59b44', lights = true) {
  const model = new T.Group();
  const body = new T.MeshStandardMaterial({ color, roughness: 0.31, metalness: 0.14 });
  const glass = new T.MeshStandardMaterial({ color: '#405a64', roughness: 0.43, metalness: 0.12 });
  const rubber = new T.MeshStandardMaterial({ color: '#263334' });
  const chassis = new T.Mesh(new RoundedBoxGeometry(1.72, 0.55, 3.65, 3, 0.16), body);
  chassis.position.set(0, 0.55, 0);
  const cabin = new T.Mesh(new RoundedBoxGeometry(1.41, 0.52, 1.95, 3, 0.2), glass);
  cabin.position.set(0, 0.995, 0.11);
  model.add(chassis, cabin);
  const roof = new T.Mesh(new RoundedBoxGeometry(1.31, 0.12, 1.29, 3, 0.06), body);
  roof.position.set(0, 1.25, 0.20);
  model.add(roof);
  const headlight = new T.MeshStandardMaterial({ color: '#f0e9cd', emissive: '#c7ac65', emissiveIntensity: lights ? 0.22 : 0 });
  const taillight = new T.MeshStandardMaterial({ color: '#a74137', emissive: '#b63e2e', emissiveIntensity: lights ? 0.22 : 0 });
  for (const x of [-0.57, 0.57]) {
    const front = new T.Mesh(new RoundedBoxGeometry(0.37, 0.13, 0.08, 2, 0.032), headlight);
    front.position.set(x, 0.65, -1.79);
    const rear = new T.Mesh(new RoundedBoxGeometry(0.36, 0.12, 0.08, 2, 0.032), taillight);
    rear.position.set(x, 0.64, 1.79);
    const mirror = new T.Mesh(new T.BoxGeometry(0.20, 0.13, 0.22), glass);
    mirror.position.set(x * 1.52, 1.0, -0.53);
    model.add(front, rear, mirror);
  }
  const bumper = new T.Mesh(new RoundedBoxGeometry(1.54, 0.13, 0.12, 2, 0.04), rubber);
  bumper.position.set(0, 0.43, 1.78);
  model.add(bumper);
  const wheel = new T.CylinderGeometry(0.31, 0.31, 0.2, 18);
  const rim = new T.CylinderGeometry(0.174, 0.174, 0.026, 14);
  const metal = new T.MeshStandardMaterial({ color: '#a2a7a9', roughness: 0.46, metalness: 0.48 });
  wheel.rotateZ(Math.PI / 2);
  rim.rotateZ(Math.PI / 2);
  for (const x of [-0.8, 0.8]) for (const z of [-1.02, 1.02]) {
    const tyre = new T.Mesh(wheel, rubber);
    tyre.position.set(x, 0.32, z);
    const hub = new T.Mesh(rim, metal);
    hub.position.set(x + Math.sign(x) * 0.10, 0.32, z);
    model.add(tyre, hub);
  }
  model.traverse(object => { if (object instanceof T.Mesh) object.castShadow = true; });
  return model;
}
