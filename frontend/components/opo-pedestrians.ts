import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { extent, nearestOnLine, type Point } from './opo-data';
import { animateAvatarLegs } from './tour-avatar';

export const residentVariants = ['rose', 'royal', 'sprout', 'scarlet', 'reader', 'sleepy'] as const;

type WalkPoint = Point & { y: number };
export type AmbientPerson = {
  variant: typeof residentVariants[number];
  scale: number;
  range?: number;
  pose: (seconds: number) => WalkPoint & { heading: number; speed: number };
};
type WalkRoute = { points: (WalkPoint & { distance: number })[]; length: number };

function clearWalks(points: Point[], lift: number, origin: Point,
  elevation: (point: Point, lift: number) => number, blocked: (point: Point) => boolean) {
  const runs: WalkRoute[] = [];
  let run: WalkRoute = { points: [], length: 0 };
  function finish() {
    if (run.length >= 8) runs.push(run);
    run = { points: [], length: 0 };
  }
  function add(point: Point) {
    if (Math.max(Math.abs(point.x), Math.abs(point.z)) > extent - 26 ||
        Math.hypot(point.x - origin.x, point.z - origin.z) > 425 || blocked(point)) {
      finish();
      return;
    }
    const y = elevation(point, lift);
    const previous = run.points.at(-1);
    if (previous && Math.abs(previous.y - y) > .72) finish();
    const end = run.points.at(-1);
    if (end) run.length += Math.hypot(point.x - end.x, point.z - end.z);
    run.points.push({ ...point, y, distance: run.length });
  }
  add(points[0]);
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1], end = points[index];
    const pieces = Math.ceil(Math.hypot(end.x - start.x, end.z - start.z) / 1.05);
    for (let step = 1; step <= pieces; step++) {
      add({ x: T.MathUtils.lerp(start.x, end.x, step / pieces), z: T.MathUtils.lerp(start.z, end.z, step / pieces) });
    }
  }
  finish();
  return runs;
}

function walkPose(route: WalkRoute, travelled: number, speed: number) {
  const cycle = travelled % (route.length * 2);
  const forward = cycle <= route.length;
  const distance = forward ? cycle : route.length * 2 - cycle;
  const index = route.points.findIndex((point, i) => i > 0 && point.distance >= distance);
  const a = route.points[Math.max(0, index - 1)], b = route.points[Math.max(1, index)];
  const t = T.MathUtils.clamp((distance - a.distance) / Math.max(.001, b.distance - a.distance), 0, 1);
  return {
    x: T.MathUtils.lerp(a.x, b.x, t), y: T.MathUtils.lerp(a.y, b.y, t), z: T.MathUtils.lerp(a.z, b.z, t),
    heading: Math.atan2(a.x - b.x, a.z - b.z) + (forward ? 0 : Math.PI), speed,
  };
}

export function neighborhoodWalkers(paths: { points: Point[]; lift: number }[], origin: Point,
  elevation: (point: Point, lift: number) => number, blocked: (point: Point) => boolean) {
  const candidates = paths.filter(({ points }) => points.length >= 2).map(path => ({
    path, distance: nearestOnLine(origin, [path.points]).distance,
  })).filter(({ distance }) => distance <= 400).sort((a, b) => a.distance - b.distance);
  const accepted: Point[] = [];
  const walkers: AmbientPerson[] = [];
  let firstWalk: { position: Point; lookAt: Point } | undefined;
  for (const { path } of candidates.slice(0, 120)) {
    const runs = clearWalks(path.points, path.lift, origin, elevation, blocked);
    for (const safe of runs) {
      const seed = nearestOnLine(origin, [safe.points]).point;
      if (accepted.some(point => Math.hypot(point.x - seed.x, point.z - seed.z) < 34)) continue;
      const closest = safe.points.reduce((best, point) =>
        Math.hypot(point.x - seed.x, point.z - seed.z) < Math.hypot(best.x - seed.x, best.z - seed.z) ? point : best);
      const patrolLength = walkers.length ? 38 : 22;
      const start = Math.max(0, Math.min(closest.distance - patrolLength * .5, safe.length - patrolLength));
      const patrol = safe.points.filter(point => point.distance >= start && point.distance <= start + patrolLength);
      const offset = patrol[0].distance;
      const route = { points: patrol.map(point => ({ ...point, distance: point.distance - offset })),
        length: patrol.at(-1)!.distance - offset };
      const index = walkers.length;
      const speed = 1.02 + index % 4 * .14;
      const phase = route.length * (.17 + (index % 5) * .15);
      const variant = residentVariants[index];
      const resting = walkPose(route, phase, 0);
      walkers.push({
        variant, scale: 0.94 + (index % 3) * .035,
        range: variant === 'sleepy' ? 42 : undefined,
        pose: seconds => variant === 'sleepy' ? resting : walkPose(route, seconds * speed + phase, speed),
      });
      if (!firstWalk) {
        firstWalk = { position: route.points[0], lookAt: route.points[Math.min(9, route.points.length - 1)] };
      }
      accepted.push(seed);
      if (walkers.length === residentVariants.length) return { walkers, firstWalk };
    }
  }
  return { walkers, firstWalk };
}

export function addAmbientPeople(scene: T.Scene, people: AmbientPerson[], visibleLimit: number) {
  if (!people.length) return undefined;
  const group = new T.Group();
  group.name = 'Illustrative neighborhood pedestrians';
  scene.add(group);
  const actors: { person: AmbientPerson; avatar: T.Group; legs: T.Object3D[] }[] = [];
  const loading = new T.LoadingManager();
  let active = true;
  new GLTFLoader(loading).loadAsync('/models/neighborhood-residents.glb').then(({ scene: library }) => {
    if (!active) {
      library.traverse(part => {
        if (part instanceof T.SkinnedMesh) part.skeleton.dispose();
        if (part instanceof T.Mesh) {
          part.geometry.dispose();
          for (const material of Array.isArray(part.material) ? part.material : [part.material]) material.dispose();
        }
      });
      return;
    }
    library.visible = false;
    group.add(library);
    for (const person of people) {
      const model = library.getObjectByName(`npc_${person.variant}`);
      if (!model) continue;
      const figure = clone(model);
      figure.rotation.y = Math.PI;
      const avatar = new T.Group();
      avatar.visible = false;
      avatar.scale.setScalar(person.scale);
      avatar.add(figure);
      group.add(avatar);
      const legs = [0, 1].flatMap(index => {
        const leg = figure.getObjectByName(`leg_${person.variant}_${index}`);
        return leg ? [leg] : [];
      });
      actors.push({ person, avatar, legs });
    }
  }).catch(error => {
    if (active) console.warn('산책 주민 모델을 불러오지 못했어요.', error);
  });
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  return {
    update(now: number, eye: T.Vector3, enabled: boolean) {
      group.visible = enabled;
      if (!enabled) return;
      const seconds = reducedMotion.matches ? 0 : now * .001;
      const nearby = actors.map(actor => {
        actor.avatar.visible = false;
        const pose = actor.person.pose(seconds);
        const distance = (eye.x - pose.x) ** 2 + (eye.y - pose.y) ** 2 + (eye.z - pose.z) ** 2;
        return { ...actor, pose, distance };
      }).filter(({ distance, person }) => distance < (person.range ?? 95) ** 2)
        .sort((a, b) => a.distance - b.distance).slice(0, visibleLimit);
      for (const { avatar, legs, person, pose } of nearby) {
        avatar.visible = true;
        avatar.position.set(pose.x, pose.y, pose.z);
        avatar.rotation.y = pose.heading;
        animateAvatarLegs(legs, now, reducedMotion.matches ? 0 : pose.speed);
      }
    },
    dispose() {
      active = false;
      loading.abort();
      group.traverse(part => { if (part instanceof T.SkinnedMesh) part.skeleton.dispose(); });
    },
  };
}
