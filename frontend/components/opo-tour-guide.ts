import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { inShape, type Point, type Shape } from './opo-data';
import { sunGridPoints } from './opo-sun-map';

export const tourGuideStop = 'tour-guide';

export function placeTourGuide(boundary: Shape, entrance: Point, safe: (point: Point) => boolean,
  floor: (x: number, z: number) => number) {
  const outline = boundary[0];
  if (!outline || outline.length < 3) return undefined;
  const candidates = sunGridPoints(outline, point => inShape(point, boundary), 5)
    .sort((a, b) => Math.hypot(a.x - entrance.x, a.z - entrance.z) - Math.hypot(b.x - entrance.x, b.z - entrance.z));
  function canReach(a: Point, b: Point) {
    let previousY = floor(a.x, a.z);
    const steps = Math.ceil(Math.hypot(a.x - b.x, a.z - b.z));
    for (let i = 1; i <= steps; i++) {
      const point = { x: T.MathUtils.lerp(a.x, b.x, i / steps), z: T.MathUtils.lerp(a.z, b.z, i / steps) };
      const y = floor(point.x, point.z);
      if (!safe(point) || Math.abs(y - previousY) > .65) return false;
      previousY = y;
    }
    return true;
  }
  for (const point of candidates) {
    if (!safe(point)) continue;
    const facing = Math.atan2(entrance.x - point.x, entrance.z - point.z);
    for (const turn of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
      const angle = facing + turn;
      const position = { x: point.x + Math.sin(angle) * 3.5, z: point.z + Math.cos(angle) * 3.5 };
      if (inShape(position, boundary) && canReach(point, position)) {
        return { point, canReach, arrival: { id: tourGuideStop, name: '임장 안내원', position, lookAt: point } };
      }
    }
  }
}

export function addTourGuide(scene: T.Scene, location: NonNullable<ReturnType<typeof placeTourGuide>>,
  floor: (x: number, z: number) => number) {
  const { point, arrival } = location;
  const player = new T.Group();
  const height = 1.60;
  const y = floor(point.x, point.z);
  player.name = 'Complex tour guide';
  player.position.set(point.x, y + .015, point.z);
  player.rotation.y = Math.atan2(point.x - arrival.position.x, point.z - arrival.position.z);
  scene.add(player);

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const loading = new T.LoadingManager();
  let active = true;
  let mixer: T.AnimationMixer | undefined;

  new GLTFLoader(loading).loadAsync('/models/plush-guide.glb').then(({ scene: model, animations }) => {
    if (!active) {
      model.traverse(part => {
        if (part instanceof T.SkinnedMesh) part.skeleton.dispose();
        if (part instanceof T.Mesh) {
          part.geometry.dispose();
          for (const material of Array.isArray(part.material) ? part.material : [part.material]) {
            if (material instanceof T.MeshStandardMaterial) material.map?.dispose();
            material.dispose();
          }
        }
      });
      return;
    }
    const figure = new T.Group();
    // The source faces +Z. Tour actors face -Z in their local space.
    model.rotation.y = Math.PI;
    figure.add(model);
    const idle = T.AnimationClip.findByName(animations, 'Idle');
    if (idle) {
      mixer = new T.AnimationMixer(model);
      mixer.clipAction(idle).play();
      mixer.update(0);
    }
    const bounds = new T.Box3().setFromObject(model, true);
    const center = bounds.getCenter(new T.Vector3());
    const scale = height / (bounds.max.y - bounds.min.y);
    figure.scale.setScalar(scale);
    figure.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
    model.traverse(part => { if (part instanceof T.Mesh) part.castShadow = true; });
    player.add(figure);
  }).catch(error => {
    if (active) console.warn('임장 안내원 모델을 불러오지 못했어요.', error);
  });

  return {
    player,
    labelPosition: new T.Vector3(point.x, y + height + .22, point.z),
    update(elapsed: number) { if (!reducedMotion.matches) mixer?.update(elapsed); },
    dispose() {
      active = false;
      loading.abort();
      mixer?.stopAllAction();
      player.traverse(part => { if (part instanceof T.SkinnedMesh) part.skeleton.dispose(); });
    },
  };
}
