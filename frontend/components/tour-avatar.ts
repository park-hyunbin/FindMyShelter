import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const avatarPalette = { shirt: '#a3d8e9', shoes: '#33313c', skin: '#f2c9ad' };
export const avatarLegName = 'avatar-leg';
export const avatarFootHeight = 0.16;
export const avatarVariants = ['berry', 'sky', 'crown', 'sprout'] as const;
export type AvatarVariant = typeof avatarVariants[number];

const outfits = {
  sky: { shirt: avatarPalette.shirt, pants: '#54504f', hair: '#604238', cuff: '#d3eff1', medal: false },
  crown: { shirt: '#a0cde3', pants: '#52676e', hair: '#32242a', cuff: '#e4f1e9', medal: true },
  sprout: { shirt: '#4a4c4f', pants: '#537648', hair: '#3c272a', cuff: '#686966', medal: false },
  berry: { shirt: '#bf473d', pants: '#604843', hair: '#422b2b', cuff: '#d3715d', medal: true },
} as const;

function avatarHairShell(segments: number, rows: number, short: boolean, color: string) {
  const positions = [], indices = [], colors = [];
  const base = new T.Color(color), strand = new T.Color();
  for (let row = 0; row <= rows; row++) {
    const progress = row / rows;
    for (let segment = 0; segment <= segments; segment++) {
      const angle = segment / segments * Math.PI * 2;
      const across = Math.cos(angle), depth = Math.sin(angle);
      const front = T.MathUtils.smoothstep(-depth, .1, .94);
      const back = T.MathUtils.smoothstep(depth, .15, .93);
      const part = Math.exp(-(((across + .26) / .19) ** 2));
      const sweep = Math.exp(-(((across - .32) / .46) ** 2));
      const shortPart = Math.exp(-(((across + .3) / .15) ** 2));
      const fringe = short ? 1.15 + .18 * sweep - .12 * shortPart : 1.205 + .24 * sweep - .13 * part;
      const temple = Math.exp(-(((depth + .24) / .16) ** 2));
      const side = short ? 1.40 + (.34 + .045 * Math.sin(angle * 5)) * back + .19 * temple
        : T.MathUtils.lerp(1.53, 1.88, back);
      const polar = T.MathUtils.lerp(side, fringe, front) * progress;
      const fringeLift = .035 * front * sweep * T.MathUtils.smoothstep(progress, .25, 1);
      const lock = Math.cos(angle * 7 + .95 * Math.sin(progress * Math.PI * .5) * across);
      const relief = short ? Math.sin(progress * Math.PI * .82) * (.022 * lock - .018 * front * shortPart) : 0;
      const lift = short ? .052 * (front * sweep + back * .2) * Math.sin(progress * Math.PI) : 0;
      positions.push(across * Math.sin(polar) * (1 + relief), Math.cos(polar) + lift,
        depth * Math.sin(polar) * (1 + fringeLift + relief));
      const tone = short ? 1 + progress * (front * (.12 * sweep - .052 * shortPart) + .052 * lock)
        : 1 + front * progress * (.12 * sweep - .07 * part + .023 * Math.sin(angle * 9 + progress * 1.3));
      strand.copy(base).multiplyScalar(tone).toArray(colors, colors.length);
      if (row < rows && segment < segments) {
        const a = row * (segments + 1) + segment, b = a + segments + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function painted(geometry: T.BufferGeometry, color: string, x: number, y: number, z: number) {
  const result = geometry.index ? geometry.toNonIndexed() : geometry;
  if (result !== geometry) geometry.dispose();
  result.deleteAttribute('uv');
  result.translate(x, y, z);
  if (result.hasAttribute('color')) return result;
  const tint = new T.Color(color);
  const colors = new Float32Array(result.getAttribute('position').count * 3);
  for (let offset = 0; offset < colors.length; offset += 3) tint.toArray(colors, offset);
  result.setAttribute('color', new T.BufferAttribute(colors, 3));
  return result;
}

function merge(parts: T.BufferGeometry[], material: T.Material) {
  const geometry = mergeGeometries(parts)!;
  for (const part of parts) part.dispose();
  const mesh = new T.Mesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
}

function backpackStrap(side: number, closeDetail: boolean) {
  const route = [
    [.115, .665, .228], [.149, .814, .226], [.166, .913, .117],
    [.148, .964, .015], [.14, .940, -.112], [.145, .812, -.183],
    [.175, .665, -.174], [.222, .604, -.121], [.258, .602, .005],
    [.214, .639, .148], [.123, .665, .223],
  ].map(([x, y, z]) => new T.Vector3(side * x, y, z));
  const strap = new T.TubeGeometry(new T.CatmullRomCurve3(route), closeDetail ? 32 : 18, .019, 6, false);
  return painted(strap, '#38343c', 0, 0, 0);
}

type Oval = (x: number, y: number, z: number, width: number, height: number, depth: number, color: string, tilt?: number) => T.BufferGeometry;

function makeOval(segments: number, rows: number): Oval {
  return (x, y, z, width, height, depth, color, tilt = 0) =>
    painted(new T.SphereGeometry(1, segments, rows)
      .scale(width, height, depth).rotateZ(tilt), color, x, y, z);
}

const headY = 1.37, headWidth = .375, headHeight = .34, headDepth = .286;

function avatarFace(variant: AvatarVariant, skin: string, oval: Oval, closeDetail: boolean) {
  const faceZ = (x: number, y: number) => -headDepth * Math.sqrt(Math.max(.05,
    1 - (x / headWidth) ** 2 - ((y - headY) / headHeight) ** 2));
  function faceStroke(points: number[][], color: string, radius: number) {
    const path = points.map(([x, y]) => new T.Vector3(x, y, faceZ(x, y) - .013));
    return painted(new T.TubeGeometry(new T.CatmullRomCurve3(path), closeDetail ? 12 : 7, radius, 5, false), color, 0, 0, 0);
  }
  function cheek(side: number) {
    const geometry = new T.CircleGeometry(1, 16);
    const position = geometry.getAttribute('position');
    const colors = [];
    const warm = new T.Color('#e38486'), edge = new T.Color(skin);
    for (let index = 0; index < position.count; index++) {
      const x = side * .232 + position.getX(index) * .091;
      const y = 1.306 + position.getY(index) * .048;
      position.setXYZ(index, -x, y, faceZ(x, y) - .006);
      (index === 0 ? warm : edge).toArray(colors, index * 3);
    }
    // Mirror the ellipse so it faces the same way as the rest of the face.
    geometry.computeVertexNormals();
    geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    const flat = geometry.toNonIndexed();
    geometry.dispose();
    flat.deleteAttribute('uv');
    return flat;
  }
  const smile = variant === 'crown'
    ? [[-.06, 1.286], [-.028, 1.256], [0, 1.27], [.028, 1.256], [.06, 1.286]]
    : [[-.094, 1.291], [-.048, 1.265], [0, 1.273], [.052, 1.265], [.094, 1.293]];
  const face = [
    oval(0, 1.304, faceZ(0, 1.304) - .004, .024, .013, .014, '#e5ad91'),
    faceStroke(smile, '#62423c', .0055),
  ];
  for (const side of [-1, 1]) {
    const eyeX = side * .149, eyeY = 1.384;
    const brow = [[side * .112, 1.443], [side * .148, 1.46], [side * .19, 1.448]];
    face.push(cheek(side), faceStroke(brow, '#66453b', .008));
    if (variant === 'sprout' && side === 1) {
      face.push(faceStroke([[.115, 1.381], [.149, 1.397], [.186, 1.378]], '#3b272a', .010));
    } else {
      face.push(oval(eyeX, eyeY, faceZ(eyeX, eyeY) - .01, .032, .039, .016, '#412e30'),
        oval(eyeX - .01, eyeY + .013, faceZ(eyeX, eyeY) - .025, .0095, .011, .005, '#fff6e8'));
    }
  }
  return face;
}

export function createTourAvatar(variant: AvatarVariant = 'sky', closeDetail = true) {
  const material = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.87 });
  const oval = makeOval(closeDetail ? 14 : 9, closeDetail ? 10 : 6);

  const { skin, shoes } = avatarPalette;
  const { hair, shirt, pants, cuff, medal } = outfits[variant];
  const shortHair = variant === 'sky';
  const hairShell = avatarHairShell(shortHair ? (closeDetail ? 44 : 24) : (closeDetail ? 32 : 18),
    closeDetail ? 12 : 7, shortHair, hair);
  if (shortHair) hairShell.scale(.387, .375, .305);
  else hairShell.scale(.382, .364, .301);
  const body = [
    oval(0, .72, .012, .285, .298, .213, shirt),
    oval(0, .515, .016, .272, .157, .195, pants),
    oval(0, .969, .009, .108, .099, .096, skin),
    oval(0, headY, 0, headWidth, headHeight, headDepth, skin),
    painted(hairShell, hair, 0, shortHair ? headY : 1.386, 0),
    ...avatarFace(variant, skin, oval, closeDetail),
  ];
  if (variant === 'sky') {
    body.push(oval(0, .747, .209, .174, .177, .083, '#292a31'),
      oval(0, .684, .266, .132, .087, .042, '#3d3941'),
      backpackStrap(-1, closeDetail), backpackStrap(1, closeDetail));
  } else if (variant === 'crown') {
    const crown = new T.Shape().moveTo(-.19, 0).lineTo(-.24, .18).lineTo(-.093, .105)
      .lineTo(0, .222).lineTo(.092, .105).lineTo(.23, .168).lineTo(.18, 0).closePath();
    body.push(oval(0, 1.265, .143, .335, .288, .155, hair),
      oval(-.291, 1.275, -.048, .074, .226, .158, hair, -.08),
      oval(.291, 1.275, -.048, .074, .226, .158, hair, .08),
      painted(new T.ExtrudeGeometry(crown, { depth: .044, bevelEnabled: false }).rotateY(Math.PI), '#e7b74f', 0, 1.632, -.151),
      oval(0, 1.702, -.202, .036, .04, .022, '#b75954'));
  } else if (variant === 'sprout') {
    body.push(oval(.032, 1.718, .05, .047, .047, .048, '#6ea4ad'),
      oval(.071, 1.778, .039, .046, .102, .042, hair, -.64));
  }
  if (medal) body.push(oval(0, .706, -.199, .105, .072, .022, '#eed394'),
    oval(0, .706, -.221, .067, .035, .009, '#946c45'));
  for (const side of [-1, 1]) {
    body.push(
      oval(side * .343, 1.346, .009, .047, .069, .044, skin),
      oval(side * .348, 1.345, -.027, .022, .031, .01, '#e8ae9a'),
      oval(side * .271, .752, -.017, .081, .147, .082, shirt, side * .24),
      oval(side * .307, .643, -.018, .055, .052, .056, skin),
      oval(side * .288, .687, -.021, .062, .027, .079, cuff, side * .27),
    );
  }
  const feet = [
    oval(0, -.055, .01, .109, .187, .12, pants),
    oval(0, -.207, -.006, .087, .149, .09, pants),
    oval(0, -.306, -.052, .109, .074, .142, shoes),
  ];
  return assembleAvatar(body, feet, material);
}

function assembleAvatar(body: T.BufferGeometry[], feet: T.BufferGeometry[], material: T.Material, hipHeight = .54) {
  const player = new T.Group();
  player.name = 'Find My Shelter avatar';
  const torso = merge(body, material);
  player.add(torso);
  const foot = merge(feet, material);
  const legs = [-.128, .128].map(x => {
    const leg = new T.Group();
    leg.name = avatarLegName;
    leg.position.set(x, hipHeight, 0);
    leg.add(foot.clone());
    return leg;
  });
  player.add(...legs);
  return { player, legs, torso };
}

export function animateAvatarLegs(legs: T.Object3D[], now: number, speed: number) {
  const stride = Math.min(.68, Math.abs(speed) * .25);
  legs.forEach((leg, index) => { leg.rotation.x = Math.sin(now / 78 + index * Math.PI) * stride; });
}
