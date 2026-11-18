import * as T from 'three';
import type { OpoData, Point } from './opo-data';

type Fixture = { position: Point; kind: 'road' | 'security'; toward?: Point };

export function addStreetLights(scene: T.Scene, fixtures: Fixture[], ground: OpoData['ground'], limit: number) {
  if (!fixtures.length) return;
  const metal = new T.MeshStandardMaterial({ color: '#8a9799', roughness: 0.65 });
  const glass = new T.MeshStandardMaterial({ color: '#e3dfce', emissive: '#ffe0a6', emissiveIntensity: 0 });
  const body = new T.BoxGeometry(1, 1, 1);
  const poles = new T.InstancedMesh(new T.CylinderGeometry(0.73, 1, 1, 8), metal, fixtures.length);
  const arms = new T.InstancedMesh(body, metal, fixtures.length);
  const housings = new T.InstancedMesh(body, metal, fixtures.length);
  const lenses = new T.InstancedMesh(body, glass, fixtures.length);
  const transform = new T.Object3D();
  const place = (mesh: T.InstancedMesh, index: number, x: number, y: number, z: number,
    width: number, height: number, length: number, heading = 0) => {
    transform.position.set(x, y, z);
    transform.rotation.y = heading;
    transform.scale.set(width, height, length);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  };
  const emitters = fixtures.map(({ position: { x, z }, kind, toward }, index) => {
    const main = kind === 'road';
    const height = main ? 7.6 : 4.1;
    const reach = main ? 0.98 : 0.3;
    const radius = main ? 0.097 : 0.059;
    const y = ground(x, z);
    const heading = toward ? Math.atan2(toward.x - x, toward.z - z) : 0;
    const dx = Math.sin(heading), dz = Math.cos(heading);
    const head = new T.Vector3(x + dx * reach, y + height - 0.04, z + dz * reach);
    place(poles, index, x, y + height / 2, z, radius, height, radius);
    place(arms, index, x + dx * reach / 2, y + height - 0.06, z + dz * reach / 2,
      0.075, 0.07, reach, heading);
    place(housings, index, head.x, head.y, head.z, main ? 0.23 : 0.18, 0.1, main ? 0.50 : 0.31, heading);
    place(lenses, index, head.x, head.y - 0.059, head.z, main ? 0.19 : 0.14, 0.025, main ? 0.41 : 0.23, heading);
    return { position: head.add(new T.Vector3(0, -0.15, 0)), distance: main ? 24 : 14, intensity: main ? 58 : 19 };
  });
  poles.castShadow = true;
  const models = new T.Group();
  models.name = '가로등·보안등';
  models.add(poles, arms, housings, lenses);
  const illumination = new T.Group();
  illumination.name = '야간 조명 모형';
  illumination.visible = false;
  const lights = Array.from({ length: Math.min(limit, emitters.length) }, () => new T.PointLight('#ffdfab', 0));
  illumination.add(...lights);
  scene.add(models, illumination);

  let selected: typeof emitters = [];
  let night = 0;
  function updateLighting() {
    const active = selected.length > 0 && night > 0.01;
    illumination.visible = active;
    glass.emissiveIntensity = active ? night * 3.4 : 0;
    lights.forEach((light, i) => {
      const emitter = selected[i];
      light.intensity = active && emitter ? emitter.intensity * night : 0;
    });
  }
  return {
    refer(point?: Point) {
      selected = [];
      if (point) {
        const distance = (emitter: typeof emitters[number]) => (emitter.position.x - point.x) ** 2 + (emitter.position.z - point.z) ** 2;
        selected = emitters.slice().sort((a, b) => distance(a) - distance(b)).slice(0, lights.length);
      }
      selected.forEach((emitter, i) => {
        lights[i].position.copy(emitter.position);
        lights[i].distance = emitter.distance;
      });
      updateLighting();
    },
    setSunAltitude(altitude: number) {
      night = 1 - T.MathUtils.smoothstep(altitude, -0.16, -0.04);
      updateLighting();
    },
  };
}
