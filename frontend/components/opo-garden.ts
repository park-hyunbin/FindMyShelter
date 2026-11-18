import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { inShape, type OpoData, type Point } from './opo-data';
import { groundPolygon, ribbon } from './opo-meshes';
import { surfaceUV, type TourMaterials } from './opo-materials';

export const courtyardStairs = {
  id: 'courtyard-stairs',
  name: '정원 목재 계단 위',
  position: { x: 16.3, z: 74.8 },
  lookAt: { x: 18, z: 58 },
};

type Surface = OpoData['ground'];
type RaisedPoint = Point & { y: number };
const stairWidth = 2.3;
const deckCenter = { x: -12.5, z: 54.85 };

function gardenCrown(maple: boolean) {
  const source = new T.IcosahedronGeometry(1, 1);
  const pieces: T.BufferGeometry[] = [];
  const color = new T.Color();
  const layers = maple ? [0.62, 0.73, 0.84, 0.9] : [0.42, 0.53, 0.64, 0.75, 0.85, 0.94];
  layers.forEach((y, level) => {
    const count = maple ? [8, 12, 9, 5][level] : [11, 10, 8, 6, 5, 3][level];
    const width = maple ? [0.2, 0.26, 0.21, 0.13][level] : [0.23, 0.20, 0.17, 0.14, 0.10, 0.05][level];
    for (let i = 0; i < count; i++) {
      const angle = i * 2 * Math.PI / count + level * 0.81;
      const variation = 0.83 + (Math.sin(i * 5.7 + level * 2.4) + 1) * 0.18;
      const radius = width * variation;
      const cluster = source.clone();
      const leafWidth = maple ? 0.09 : 0.061 + width * 0.17;
      cluster.scale(leafWidth * variation * (maple ? 1 : 1.5), leafWidth * (maple ? 0.70 : 0.95), leafWidth * variation)
        .rotateY(-angle)
        .translate(Math.cos(angle) * radius, y + Math.sin(angle * 3) * 0.034, Math.sin(angle) * radius);
      const colors = new Float32Array(cluster.getAttribute('position').count * 3);
      color.setScalar(0.56 + y * 0.31 + (i % 4) * 0.07);
      for (let j = 0; j < colors.length; j += 3) color.toArray(colors, j);
      cluster.setAttribute('color', new T.BufferAttribute(colors, 3));
      pieces.push(cluster);
    }
  });
  source.dispose();
  const geometry = mergeGeometries(pieces)!;
  pieces.forEach(piece => piece.dispose());
  return geometry;
}

function forestLetters() {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#e0c582';
  ctx.font = 'bold 59px Georgia, serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('FOREST', 256, 52);
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  return new T.Mesh(new T.PlaneGeometry(3.45, 0.65),
    new T.MeshStandardMaterial({ map, transparent: true, depthWrite: false, roughness: 0.8 }));
}

export function addCourtyardGarden(group: T.Group, surface: Surface, finish: TourMaterials, ripples: T.Texture | null) {
  const material = (color: string, roughness = 0.92) => new T.MeshStandardMaterial({ color, roughness, side: T.DoubleSide });
  const stone = finish(material('#a29b88'), 'stonewall');
  const pathFinish = finish(material('#d6c9ad'), 'cobble');
  const earth = finish(material('#a6ad78'), 'forest');
  const cap = material('#928d79');
  const timber = finish(material('#bfa18b'), 'planks'), rails = material('#62554a');
  const water = material('#798d77', 0.24);
  water.normalMap = ripples;
  water.normalScale.setScalar(0.49);
  const splashes = material('#c5dcce', 0.38);
  splashes.transparent = true;
  splashes.opacity = 0.65;
  splashes.depthWrite = false;
  splashes.normalMap = ripples;
  splashes.normalScale.setScalar(0.85);
  splashes.onBeforeCompile = shader => {
    shader.uniforms.fallScroll = { value: ripples?.offset ?? new T.Vector2() };
    shader.vertexShader = 'varying vec2 fallUV;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\n fallUV = uv;',
    );
    shader.fragmentShader = 'varying vec2 fallUV;\n uniform vec2 fallScroll;\n' + shader.fragmentShader.replace(
      '#include <color_fragment>', `
        #include <color_fragment>
        float edge = smoothstep(0.0, 0.21, fallUV.x) * (1.0 - smoothstep(0.78, 1.0, fallUV.x));
        float bands = 0.43 + 0.32 * sin(fallUV.x * 99.0 + sin(fallUV.x * 45.0) * 1.4);
        float flow = 0.72 + 0.27 * sin((fallUV.y - fallScroll.y * 34.0) * 23.0 + fallUV.x * 16.0);
        diffuseColor.a *= edge * (bands * flow + 0.2);
      `,
    );
  };

  const add = (geometry: T.BufferGeometry, mat: T.MeshStandardMaterial, castShadow = false) => {
    const mesh = new T.Mesh(geometry, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = castShadow;
    group.add(mesh);
    return mesh;
  };
  const unitBox = new T.BoxGeometry(1, 1, 1);
  const batches = new Map<T.MeshStandardMaterial, T.Object3D[]>();
  function box(x: number, y: number, z: number, width: number, height: number, depth: number, mat: T.MeshStandardMaterial, heading = 0) {
    const item = new T.Object3D();
    item.position.set(x, y, z);
    item.scale.set(width, height, depth);
    item.rotation.y = heading;
    const batch = batches.get(mat);
    if (batch) batch.push(item);
    else batches.set(mat, [item]);
    return item;
  }
  function beam(from: RaisedPoint, to: RaisedPoint, width: number, mat: T.MeshStandardMaterial) {
    const direction = new T.Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
    const item = box((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2, width, direction.length(), width, mat);
    item.quaternion.setFromUnitVectors(T.Object3D.DEFAULT_UP, direction.normalize());
  }
  function rail(points: RaisedPoint[]) {
    points.forEach(({ x, y, z }) => box(x, y + 0.47, z, 0.072, 0.94, 0.072, rails));
    for (let i = 1; i < points.length; i++) for (const lift of [0.31, 0.58, 0.92]) {
      const from = points[i - 1], to = points[i];
      beam({ ...from, y: from.y + lift }, { ...to, y: to.y + lift }, lift > 0.9 ? 0.085 : 0.045, rails);
    }
  }
  function area(boundary: Point[], y: number, mat: typeof water, uv: 'water' | 'forest' | 'cobble') {
    const geo = groundPolygon([boundary], () => y, 2.7, 0);
    surfaceUV(geo, uv);
    return add(geo, mat);
  }
  function face(points: Point[], floor: number, top: number, mat: typeof stone) {
    const positions: number[] = [], indexes: number[] = [];
    points.forEach(({ x, z }, i) => {
      positions.push(x, floor, z, x, top, z);
      if (i) {
        const a = 2 * i - 2;
        indexes.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geo.setIndex(indexes);
    geo.computeVertexNormals();
    if (mat === splashes) {
      const uv = points.flatMap((_, i) => [i / (points.length - 1), 0, i / (points.length - 1), 1]);
      geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    } else surfaceUV(geo, 'stonewall', true);
    return add(geo, mat, mat === stone);
  }

  // Each wall retains its own shallow pool. Their arc and height are inferred from photos.
  // The photographed pools sit uphill from the mapped service road.
  const base = surface(deckCenter.x, 56) + 0.61;
  const tiers = [
    { center: -5.4, z: 59.5, width: 23.9, y: base + 1.36 },
    { center: -6.9, z: 64.8, width: 21.4, y: base + 2.91 },
    { center: -8.2, z: 70.1, width: 18.8, y: base + 4.65 },
  ];
  const contours = tiers.map(tier => Array.from({ length: 25 }, (_, i) => {
    const t = i / 24 - 0.5;
    return { x: tier.center + t * tier.width, z: tier.z + 3.4 * t * t + 0.23 * t * tier.width };
  }));
  const poolFront = contours[0].map(p => ({ ...p, z: p.z - 2.75 }));
  const wettedFootprint = [...poolFront, ...contours[2].map(p => ({ ...p, z: p.z + 2.1 })).reverse()];
  for (const [i, tier] of tiers.entries()) {
    const contour = contours[i], next = contours[i + 1];
    const downstream = i ? tiers[i - 1].y - 0.13 : base - 0.08;
    face(contour, downstream - 0.62, tier.y, stone);
    add(ribbon(contour, 0.34, () => tier.y + 0.02), cap, true);
    const far = next ? next.map(p => ({ ...p, z: p.z - 0.03 })) : contour.map(p => ({ ...p, z: p.z + 2.45 }));
    area([...contour, ...far.reverse()], tier.y - 0.11, water, 'water');
    const fall = contour.slice(10, 13).map(p => ({ ...p, z: p.z - 0.075 }));
    face(fall, downstream + 0.02, tier.y - 0.08, splashes);
    if (i === tiers.length - 1) {
      const walk = contour.map(p => ({ ...p, z: p.z + 2.55 }));
      const walkway = ribbon(walk, 1.55, () => tier.y + 0.12);
      surfaceUV(walkway, 'cobble');
      add(walkway, pathFinish);
      rail(walk.filter((_, index) => index % 2 === 0).map(p => ({ ...p, z: p.z - 0.82, y: tier.y + 0.12 })));
      const letters = forestLetters();
      if (letters) {
        letters.position.set(tier.center - 3.25, tier.y - 0.66, tier.z - 0.69);
        letters.rotateY(0.12);
        letters.rotation.y = Math.PI;
        group.add(letters);
      }
    }
  }
  area([...poolFront, ...contours[0].slice().reverse()], base - 0.08, water, 'water');
  const lowerPaving = [
    { x: -17.7, z: 52.5 }, { x: 10.2, z: 58.8 }, { x: 9.4, z: 60.1 },
    { x: 5.8, z: 59.4 }, { x: -17.1, z: 55.55 }, { x: -20.0, z: 53.9 },
  ];
  const lower = groundPolygon([lowerPaving], surface, 3.3, 0.25);
  surfaceUV(lower, 'cobble');
  add(lower, pathFinish);
  const deckY = Math.max(...[-3, 3].flatMap(dx => [-1.5, 1.5].map(dz => surface(deckCenter.x + dx, deckCenter.z + dz)))) + 0.36;
  for (let z = deckCenter.z - 1.55; z <= deckCenter.z + 1.57; z += 0.16) box(deckCenter.x, deckY - 0.08, z, 6.5, 0.16, 0.151, timber);
  box(deckCenter.x, deckY - 0.22, deckCenter.z, 6.47, 0.28, 3.09, timber);
  const table = add(new T.CylinderGeometry(0.77, 0.77, 0.13, 20), material('#ab8f6e'), true);
  table.position.set(deckCenter.x - 1.25, deckY + 0.79, deckCenter.z);
  box(deckCenter.x - 1.25, deckY + 1.15, deckCenter.z, 0.064, 2.3, 0.064, rails);
  const umbrella = add(new T.ConeGeometry(1.38, 0.33, 8), material('#ac3e37'), true);
  umbrella.position.set(deckCenter.x - 1.25, deckY + 2.27, deckCenter.z);
  umbrella.rotation.y = Math.PI / 8;
  for (const x of [-3, -0.15]) {
    box(deckCenter.x + x, deckY + 0.36, deckCenter.z + 0.72, 0.72, 0.12, 0.68, timber);
    box(deckCenter.x + x, deckY + 0.50, deckCenter.z + 1.03, 0.65, 0.35, 0.07, timber);
  }

  // A continuous walking elevation follows the visible stair flights and landings.
  const stairPlan = [{ x: 18.6, z: 52.0 }, { x: 19.7, z: 58.9 }, { x: 18.2, z: 65.8 }, courtyardStairs.position];
  const low = surface(stairPlan[0].x, stairPlan[0].z) + 0.23;
  const high = Math.max(low + 2.25, surface(courtyardStairs.position.x, courtyardStairs.position.z) + 0.48);
  const stairNodes = stairPlan.map((p, i) => ({ ...p, y: T.MathUtils.lerp(low, high, [0, 0.27, 0.58, 1][i]) }));
  const flights = stairNodes.slice(1).map((b, i) => {
    const a = stairNodes[i], length = Math.hypot(b.x - a.x, b.z - a.z), dx = (b.x - a.x) / length, dz = (b.z - a.z) / length;
    const climbStart = 0.16, climbEnd = 0.76;
    const heightAt = (t: number) => T.MathUtils.lerp(a.y, b.y, T.MathUtils.clamp((t - climbStart) / (climbEnd - climbStart), 0, 1));
    const count = Math.ceil((b.y - a.y) / 0.125);
    const at = (t: number, side = 0) => ({
      x: T.MathUtils.lerp(a.x, b.x, t) + side * dz,
      z: T.MathUtils.lerp(a.z, b.z, t) - side * dx,
      y: heightAt(t),
    });
    for (const [start, end] of [[0, climbStart], [climbEnd, 1]]) {
      const landing = at((start + end) / 2);
      box(landing.x, landing.y - 0.09, landing.z, stairWidth, 0.18, length * (end - start) + 0.012, timber, Math.atan2(dx, dz));
    }
    for (let i = 0; i < count; i++) {
      const p = at(T.MathUtils.lerp(climbStart, climbEnd, (i + 0.5) / count)), rise = (b.y - a.y) / count;
      box(p.x, p.y - 0.09, p.z, stairWidth, 0.18 + rise, length * (climbEnd - climbStart) / count + 0.014, timber, Math.atan2(dx, dz));
    }
    const sections = Math.ceil(length / 1.65);
    for (const side of [-stairWidth / 2 + 0.08, stairWidth / 2 - 0.08]) {
      rail(Array.from({ length: sections + 1 }, (_, i) => at(i / sections, side)));
    }
    return { a, length, dx, dz, heightAt };
  });
  for (const node of stairNodes.slice(1)) box(node.x, node.y - 0.08, node.z, 2.38, 0.16, 0.76, timber);
  const top = stairNodes.at(-1)!;
  const ramp = ribbon([top, { x: 16.12, z: 77.9 }], stairWidth,
    (x, z) => T.MathUtils.lerp(top.y, surface(x, z) + 0.13, T.MathUtils.clamp((z - top.z) / 3.1, 0, 1)));
  surfaceUV(ramp, 'planks');
  add(ramp, timber, true);

  const gardenBeds = [
    [{ x: -23, z: 51 }, { x: -17.2, z: 48 }, { x: -14.5, z: 69.9 }, { x: -25, z: 73.5 }],
    [{ x: 6.7, z: 55.3 }, { x: 16.6, z: 51.0 }, { x: 15.2, z: 73.0 }, { x: 4.1, z: 70.3 }],
    [{ x: -21, z: 70.5 }, { x: 12.2, z: 70.4 }, { x: 10.9, z: 78.9 }, { x: -23.5, z: 78.4 }],
  ];
  const plantCenters: { x: number; z: number; scale: number; color: T.Color }[] = [];
  let seed = 8033;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const bedColors = ['#837644', '#617640', '#839d58', '#507744', '#8d4140', '#a65842', '#6c813f'];
  for (const bed of gardenBeds) {
    const bedShape = groundPolygon([bed], surface, 3.2, 0.24);
    surfaceUV(bedShape, 'forest');
    add(bedShape, earth);
    const xs = bed.map(p => p.x), zs = bed.map(p => p.z);
    for (let i = 0; i < 125; i++) {
      const x = T.MathUtils.lerp(Math.min(...xs), Math.max(...xs), random());
      const z = T.MathUtils.lerp(Math.min(...zs), Math.max(...zs), random());
      if (inShape({ x, z }, [bed]) && !inShape({ x, z }, [wettedFootprint])) {
        plantCenters.push({ x, z, scale: 0.36 + random() * 0.54, color: new T.Color(bedColors[Math.floor(random() * bedColors.length)]) });
      }
    }
  }
  const transform = new T.Object3D();
  const shrubs = new T.InstancedMesh(new T.IcosahedronGeometry(1, 1), material('#ffffff'), plantCenters.length);
  plantCenters.forEach(({ x, z, scale, color }, i) => {
    transform.position.set(x, surface(x, z) + scale * 0.6, z);
    transform.scale.set(scale * 1.1, scale * 0.68, scale);
    transform.rotation.y = random() * Math.PI;
    transform.updateMatrix();
    shrubs.setMatrixAt(i, transform.matrix);
    shrubs.setColorAt(i, color);
  });
  shrubs.castShadow = shrubs.receiveShadow = true;
  group.add(shrubs);

  const trees = [
    [-20, 53.8, 4.5, 0], [-18.5, 61, 6.25, 0], [-22, 68.1, 5.0, 1], [-16, 69, 5.3, 0],
    [-11.5, 74, 4.1, 1], [-3.5, 75.8, 4.3, 0], [6.5, 74.5, 4.25, 1], [7.6, 62, 4.9, 0],
    [12.6, 58, 4.7, 1], [13.3, 65, 3.9, 1], [13.3, 70.9, 4.9, 0], [20.7, 67.9, 5.4, 1],
  ];
  const coniferCrown = gardenCrown(false), mapleCrown = gardenCrown(true);
  for (const [x, z, height, maple] of trees) {
    const y = surface(x, z);
    const leaves = material(maple ? '#975147' : '#657842');
    leaves.vertexColors = true;
    const tree = add(maple ? mapleCrown : coniferCrown, leaves, true);
    tree.scale.set(height * 1.15, height, height * 1.07);
    tree.position.set(x, y, z);
    tree.rotation.y = random() * Math.PI;
    box(x, y + height * 0.25, z, height * 0.052, height * 0.58, height * 0.054, timber);
  }
  const rockMat = material('#6c6a5c');
  rockMat.flatShading = true;
  const roughRock = new T.DodecahedronGeometry(1, 1);
  contours.forEach((contour, i) => {
    for (const index of [2, 8, 10, 12, 16, 22]) {
      const { x, z } = contour[index];
      const rock = add(roughRock, rockMat, true);
      const dimensions = 0.34 + random() * 0.63;
      rock.position.set(x, (i ? tiers[i - 1].y : base) + dimensions * 0.22, z - 0.74 - random() * 0.61);
      rock.scale.set(dimensions * 1.24, dimensions, dimensions * 0.89);
      rock.rotation.set(random() * 0.36, random() * Math.PI, random() * 0.41);
    }
  });
  for (const [mat, items] of batches) {
    const meshes = new T.InstancedMesh(unitBox, mat, items.length);
    items.forEach((transform, index) => { transform.updateMatrix(); meshes.setMatrixAt(index, transform.matrix); });
    meshes.castShadow = meshes.receiveShadow = true;
    group.add(meshes);
  }

  return {
    blocked(point: Point) { return inShape(point, [wettedFootprint]); },
    elevation(point: Point) {
      let floor = -Infinity;
      for (const { a, length, dx, dz, heightAt } of flights) {
        const x = point.x - a.x, z = point.z - a.z;
        const forward = x * dx + z * dz, lateral = x * dz - z * dx;
        if (forward >= -0.31 && forward <= length + 0.31 && Math.abs(lateral) <= stairWidth / 2) {
          floor = Math.max(floor, heightAt(forward / length));
        }
      }
      if (point.z >= top.z && point.z < 77.9 && Math.abs(point.x - top.x) < stairWidth / 2) {
        floor = Math.max(floor, T.MathUtils.lerp(top.y, surface(point.x, point.z) + 0.13, (point.z - top.z) / 3.1));
      }
      if (Math.abs(point.x - deckCenter.x) < 3.24 && Math.abs(point.z - deckCenter.z) < 1.58) floor = Math.max(floor, deckY);
      return Number.isFinite(floor) ? floor : undefined;
    },
  };
}
