import { readFileSync, writeFileSync } from 'node:fs';
import { LinearInterpolant, Object3D, QuaternionLinearInterpolant, Vector3 } from 'three';

const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/prepare-tour-avatar-motion.mjs /path/to/Barbarian.glb');

const glb = readFileSync(source);
if (glb.toString('ascii', 0, 4) !== 'glTF' || glb.readUInt32LE(4) !== 2) {
  throw new Error('Expected a glTF 2.0 binary');
}
const endOfJson = 20 + glb.readUInt32LE(12);
const data = JSON.parse(glb.toString('utf8', 20, endOfJson));
const binaryOffset = endOfJson + 8;

function values(index, width) {
  const accessor = data.accessors[index];
  const view = data.bufferViews[accessor.bufferView];
  if (accessor.componentType !== 5126 || (view.byteStride && view.byteStride !== width * 4)) {
    throw new Error('Expected packed float animation data');
  }
  const offset = binaryOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  return Float32Array.from({ length: accessor.count * width }, (_, i) => glb.readFloatLE(offset + i * 4));
}

function bake(name) {
  const animation = data.animations.find(clip => clip.name === name);
  if (!animation) throw new Error(`Missing clip: ${name}`);
  const nodes = data.nodes.map(node => {
    const joint = new Object3D();
    joint.name = node.name;
    if (node.translation) joint.position.fromArray(node.translation);
    if (node.rotation) joint.quaternion.fromArray(node.rotation);
    if (node.scale) joint.scale.fromArray(node.scale);
    return joint;
  });
  data.nodes.forEach((node, index) => {
    for (const child of node.children ?? []) nodes[index].add(nodes[child]);
  });
  const rig = nodes.find(node => node.name === 'Rig');
  const joints = ['upperleg.r', 'foot.r', 'upperleg.l', 'foot.l', 'chest'].map(name => {
    const joint = rig.getObjectByName(name);
    if (!joint) throw new Error(`Missing joint: ${name}`);
    return joint;
  });
  const channels = animation.channels.map(({ sampler, target }) => {
    const { input, output, interpolation } = animation.samplers[sampler];
    if (interpolation !== 'LINEAR') throw new Error(`Unsupported interpolation: ${interpolation}`);
    const node = nodes[target.node];
    const times = values(input, 1);
    const rotation = target.path === 'rotation';
    const value = rotation ? node.quaternion : target.path === 'scale' ? node.scale : node.position;
    const width = rotation ? 4 : 3;
    const Interpolant = rotation ? QuaternionLinearInterpolant : LinearInterpolant;
    return { end: times.at(-1), value, track: new Interpolant(times, values(output, width), width) };
  });
  const duration = Math.max(...channels.map(channel => channel.end));
  const frameCount = Math.ceil(duration * 24);
  const points = joints.map(() => new Vector3());
  const samples = Array.from({ length: frameCount }, (_, index) => {
    const time = (index / frameCount) * duration;
    for (const { track, value } of channels) value.fromArray(track.evaluate(time));
    rig.updateMatrixWorld(true);
    joints.forEach((joint, i) => points[i].setFromMatrixPosition(joint.matrixWorld));
    const [rightHip, rightFoot, leftHip, leftFoot, chest] = points;
    // KayKit faces +Z, while the site's avatar faces -Z. The hips are fixed by the world.
    const pitch = (hip, foot) => Math.atan2(foot.z - hip.z, hip.y - foot.y);
    return [pitch(rightHip, rightFoot), pitch(leftHip, leftFoot), chest.y];
  });
  return { duration, samples };
}

const idle = bake('Idle');
const walk = bake('Walking_A');
const neutral = idle.samples[0];
const output = Object.fromEntries(Object.entries({ idle, walk }).map(([name, clip]) => [
  name,
  {
    duration: Number(clip.duration.toFixed(6)),
    // Signed leg pitch (radians) and chest displacement (m), relative to the idle pose.
    frames: clip.samples.map(frame => frame.map((value, i) => Number((value - neutral[i]).toFixed(4)))),
  },
]));
const json = Object.entries(output).map(([name, { duration, frames }]) => (
  `  "${name}": { "duration": ${duration}, "frames": [\n${frames.map(frame => `    ${JSON.stringify(frame)}`).join(',\n')}\n  ] }`
));
writeFileSync(new URL('../components/data/tour-avatar-motion.json', import.meta.url), `{\n${json.join(',\n')}\n}\n`);
