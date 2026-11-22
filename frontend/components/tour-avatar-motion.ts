import { MathUtils, type Object3D } from 'three';
import { idle, walk } from './data/tour-avatar-motion.json';

function sample(clip: typeof idle, time: number, pose: number[]) {
  const frame = MathUtils.euclideanModulo(time, clip.duration) / clip.duration * clip.frames.length;
  const index = Math.floor(frame);
  const current = clip.frames[index];
  const next = clip.frames[(index + 1) % clip.frames.length];
  for (let i = 0; i < pose.length; i++) pose[i] = MathUtils.lerp(current[i], next[i], frame - index);
}

// Adapt KayKit's Idle and Walking_A to the existing rigid avatar. The world owns root motion.
export function createTourAvatarMotion(legs: Object3D[], torso: Object3D) {
  let idleTime = 0, walkTime = walk.duration * .2, walkBlend = 0;
  const idlePose = [0, 0, 0], walkPose = [0, 0, 0];

  return (dt: number, actualSpeed: number, backwards: boolean) => {
    const walking = MathUtils.smoothstep(actualSpeed, .04, .5);
    walkBlend = MathUtils.damp(walkBlend, walking, 16, dt);
    idleTime = (idleTime + dt) % idle.duration;
    const cadence = MathUtils.clamp(.7 + actualSpeed * .19, .7, 1.8);
    walkTime = MathUtils.euclideanModulo(walkTime + dt * cadence * (backwards ? -1 : 1), walk.duration);
    sample(idle, idleTime, idlePose);
    sample(walk, walkTime, walkPose);

    legs[0].rotation.x = MathUtils.lerp(idlePose[0], walkPose[0] * .66, walkBlend);
    legs[1].rotation.x = MathUtils.lerp(idlePose[1], walkPose[1] * .66, walkBlend);
    torso.position.y = MathUtils.lerp(idlePose[2] * .55, walkPose[2] * .32, walkBlend);
  };
}
