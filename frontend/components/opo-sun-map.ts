import * as T from 'three';
import { inShape, type OpoData, type Point } from './opo-data';
import { observationHeight, type LightSample } from './opo-sunlight';

export const sunGridSpacing = 8;
export const sunMapLegend = {
  sun: { name: '직사광', color: '#ffcf68', shape: 'circle' },
  building: { name: '건물 그늘', color: '#91aafa', shape: 'diamond' },
  terrain: { name: '지형 그늘', color: '#77d8c2', shape: 'triangle' },
  unknown: { name: '미판정', color: '#d0d5df', shape: 'ring' },
  night: { name: '야간', color: '#8995aa', shape: 'circle' },
} as const;
type Kind = keyof typeof sunMapLegend;
const kinds = Object.keys(sunMapLegend) as Kind[];
export type SunMapCounts = Record<Kind, number>;

export function sunGridPoints(outline: Point[], eligible: (point: Point) => boolean, spacing = sunGridSpacing) {
  if (outline.length < 3 || !Number.isFinite(spacing) || spacing <= 0) return [];
  const bounds = new T.Box2().setFromPoints(outline.map(({ x, z }) => new T.Vector2(x, z)));
  const points: Point[] = [];
  for (let z = Math.ceil(bounds.min.y / spacing) * spacing; z <= bounds.max.y; z += spacing) {
    for (let x = Math.ceil(bounds.min.x / spacing) * spacing; x <= bounds.max.x; x += spacing) {
      const point = { x, z };
      if (inShape(point, [outline]) && eligible(point)) points.push(point);
    }
  }
  return points;
}

export function sunMapKind(sample: LightSample): Kind {
  return sample.status === 'shade' ? sample.obstruction?.kind ?? 'unknown' : sample.status;
}

export function createSunMap(scene: T.Scene, outline: Point[], points: Point[], surface: OpoData['ground']) {
  const group = new T.Group();
  group.name = '단지 실외 일조 표본';
  group.visible = false;
  scene.add(group);
  const markers = new Map<Kind, { mesh: T.InstancedMesh; points: Point[] }>();
  for (const kind of kinds) {
    const style = sunMapLegend[kind];
    const shape = style.shape === 'ring' ? new T.RingGeometry(1.17, 2.39, 16)
      : new T.CircleGeometry(kind === 'night' ? 1.64 : 2.52, style.shape === 'diamond' ? 4 : style.shape === 'triangle' ? 3 : 16,
        style.shape === 'triangle' ? Math.PI / 2 : 0);
    shape.rotateX(-Math.PI / 2);
    const material = new T.MeshBasicMaterial({ color: style.color, side: T.DoubleSide, toneMapped: false });
    const mesh = new T.InstancedMesh(shape, material, points.length);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    group.add(mesh);
    markers.set(kind, { mesh, points: [] });
  }
  const boundary = outline.map(({ x, z }) => new T.Vector3(x, surface(x, z) + 0.91, z));
  group.add(new T.LineLoop(new T.BufferGeometry().setFromPoints(boundary),
    new T.LineBasicMaterial({ color: '#e5e3cb', opacity: 0.73, transparent: true, toneMapped: false })));
  const positions = points.map(({ x, z }) => new T.Vector3(x, surface(x, z) + observationHeight, z));
  const matrix = new T.Matrix4();
  let stop: (() => void) | undefined;
  return {
    positions,
    pick(ray: T.Raycaster, maxDistance: number) {
      if (!group.visible) return;
      const candidates = [...markers.values()].filter(batch => batch.mesh.count > 0);
      const result = ray.intersectObjects(candidates.map(batch => batch.mesh), false)[0];
      if (!result || result.instanceId === undefined || result.distance > maxDistance + 0.15) return;
      return candidates.find(batch => batch.mesh === result.object)?.points[result.instanceId];
    },
    render(sampleAt: (point: Point) => LightSample, done: (counts: SunMapCounts) => void) {
      stop?.();
      group.visible = false;
      let index = 0, frame = 0;
      for (const batch of markers.values()) {
        batch.mesh.count = 0;
        batch.points = [];
      }
      const update = () => {
        const deadline = performance.now() + 6;
        do {
          if (index >= points.length) break;
          const point = points[index];
          const batch = markers.get(sunMapKind(sampleAt(point)))!;
          batch.mesh.setMatrixAt(batch.mesh.count++, matrix.setPosition(positions[index]));
          batch.points.push(point);
          index++;
        } while (performance.now() < deadline);
        if (index < points.length) { frame = requestAnimationFrame(update); return; }
        const counts: SunMapCounts = { sun: 0, building: 0, terrain: 0, unknown: 0, night: 0 };
        for (const [kind, batch] of markers) {
          batch.mesh.instanceMatrix.needsUpdate = true;
          batch.mesh.boundingSphere = null;
          counts[kind] = batch.mesh.count;
        }
        group.visible = true;
        done(counts);
      };
      const timer = window.setTimeout(() => { frame = requestAnimationFrame(update); }, 90);
      const cancel = () => {
        if (stop !== cancel) return;
        stop = undefined;
        window.clearTimeout(timer);
        cancelAnimationFrame(frame);
        group.visible = false;
      };
      stop = cancel;
      return cancel;
    },
    dispose() {
      stop?.();
      for (const batch of markers.values()) batch.mesh.dispose();
    },
  };
}
