import * as T from 'three';
import { extent, inShape, type Building, type OpoData, type Point, type Shape } from './opo-data';

export function shapeFrom(rings: Shape) {
  const path = (ring: Point[]) => ring.map(({ x, z }) => new T.Vector2(x, -z));
  const shape = new T.Shape(path(rings[0]));
  shape.holes = rings.slice(1).map(ring => new T.Path(path(ring)));
  return shape;
}

export type RoofOutline = { rings: Shape; elevation: number; label: string };

export function makeGround(data: OpoData) {
  const geometry = new T.PlaneGeometry(extent * 2, extent * 2, 144, 144);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  const low = new T.Color('#b3be92');
  const high = new T.Color('#778a62');
  const color = new T.Color();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i);
    const elevation = data.ground(x, z);
    positions.setY(i, elevation);
    color.copy(low).lerp(high, T.MathUtils.clamp((elevation + 30) / 230, 0, 1));
    color.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new T.Mesh(geometry, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.97 }));
  mesh.receiveShadow = true;
  mesh.name = `주변 지형 (${data.terrainSource.resolution}m DTM)`;
  return mesh;
}

export function groundPolygon(rings: Shape, ground: OpoData['ground']) {
  // Split large faces into smaller ones so a land-cover polygon follows the terrain.
  const shape = new T.ShapeGeometry(shapeFrom(rings));
  shape.rotateX(-Math.PI / 2);
  const source = shape.toNonIndexed();
  shape.dispose();
  const positions = source.getAttribute('position');
  const vertices: number[] = [];
  const localPoint = (index: number) => ({ x: positions.getX(index), z: positions.getZ(index) });
  const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
  function triangle(a: Point, b: Point, c: Point) {
    const ab = distance(a, b), bc = distance(b, c), ca = distance(c, a);
    const longest = Math.max(ab, bc, ca);
    if (longest < 24) {
      for (const point of [a, b, c]) vertices.push(point.x, ground(point.x, point.z) + 0.23, point.z);
    } else if (longest === ab) {
      const m = midpoint(a, b); triangle(a, m, c); triangle(m, b, c);
    } else if (longest === bc) {
      const m = midpoint(b, c); triangle(a, b, m); triangle(a, m, c);
    } else {
      const m = midpoint(c, a); triangle(a, b, m); triangle(m, b, c);
    }
  }
  for (let i = 0; i < positions.count; i += 3) triangle(localPoint(i), localPoint(i + 1), localPoint(i + 2));
  source.dispose();
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function ribbon(points: Point[], width: number, elevation: OpoData['ground']) {
  const vertices: number[] = [];
  const indexes: number[] = [];
  const walk: Point[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const distance = Math.hypot(b.x - a.x, b.z - a.z);
    if (distance < 0.05) continue;
    const parts = Math.ceil(distance / 6);
    for (let j = 0; j < parts; j++) walk.push({ x: a.x + (b.x - a.x) * j / parts, z: a.z + (b.z - a.z) * j / parts });
  }
  if (!walk.length) return new T.BufferGeometry();
  walk.push(points[points.length - 1]);
  walk.forEach((point, i) => {
    const a = walk[Math.max(0, i - 1)], b = walk[Math.min(walk.length - 1, i + 1)];
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const dx = (b.z - a.z) / length * width / 2;
    const dz = (a.x - b.x) / length * width / 2;
    for (const sign of [1, -1]) {
      const x = point.x + dx * sign, z = point.z + dz * sign;
      vertices.push(x, elevation(x, z), z);
    }
    if (i) {
      const k = (i - 1) * 2;
      indexes.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  });
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indexes);
  geometry.computeVertexNormals();
  return geometry;
}

function facadeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#e5decd'; ctx.fillRect(0, 0, 128, 96);
  ctx.fillStyle = '#c7bcaa'; ctx.fillRect(0, 0, 26, 96);
  ctx.fillStyle = '#f6ebd9'; ctx.fillRect(28, 0, 5, 96);
  ctx.fillStyle = '#b9ab98'; ctx.fillRect(0, 83, 128, 5);
  ctx.fillStyle = '#77878a'; ctx.fillRect(46, 16, 61, 57);
  ctx.fillStyle = '#a3b5b7'; ctx.fillRect(50, 20, 53, 44);
  ctx.fillStyle = '#5d747b'; ctx.fillRect(50, 47, 53, 20);
  ctx.fillStyle = '#d1c8b9'; ctx.fillRect(76, 20, 3, 47);
  const texture = new T.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function buildMeshes(data: OpoData, scene: T.Scene) {
  const facade = new T.MeshStandardMaterial({ map: facadeTexture(), roughness: 0.88 });
  const apartmentRoof = new T.MeshStandardMaterial({ color: '#6f5b51', roughness: 1 });
  const wall = new T.MeshStandardMaterial({ color: '#c7bfaa', roughness: 1 });
  const roof = new T.MeshStandardMaterial({ color: '#a18977', roughness: 1 });
  const footprints = new T.MeshBasicMaterial({ color: '#a89d86' });
  const occluders: T.Mesh[] = [];
  const roofs: RoofOutline[] = [];
  const anchors: { point: T.Vector3; building: Building }[] = [];

  for (const building of data.buildings) {
    for (const [index, rings] of building.shapes.entries()) {
      const position = rings[0].reduce((p, item) => ({ x: p.x + item.x / rings[0].length, z: p.z + item.z / rings[0].length }), { x: 0, z: 0 });
      if (!building.height) {
        scene.add(new T.Mesh(groundPolygon(rings, data.ground), footprints));
        continue;
      }
      const verticalBase = data.ground(position.x, position.z);
      const shape = shapeFrom(rings);
      const geometry = new T.ExtrudeGeometry(shape, { depth: building.height, bevelEnabled: false });
      if (building.dong) {
        // ExtrudeGeometry provides along-wall distance and height as side UVs.
        const uv = geometry.getAttribute('uv');
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 4.6, uv.getY(i) / 3.1);
      }
      geometry.rotateX(-Math.PI / 2);
      const mesh = new T.Mesh(geometry, building.dong ? [apartmentRoof, facade] : [roof, wall]);
      mesh.position.y = verticalBase;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.name = building.dong ? `오포 포레스트 ${building.dong}` : building.label;
      scene.add(mesh);
      occluders.push(mesh);
      roofs.push({ rings, elevation: verticalBase + building.height, label: mesh.name });
      if (building.dong && index === 0) {
        anchors.push({ building, point: new T.Vector3(position.x, verticalBase + building.height + 7, position.z) });
      }
    }
  }
  return { occluders, anchors, roofs };
}

export function addEnvironment(data: OpoData, scene: T.Scene) {
  const colors = {
    wood: '#6d845d', grass: '#a6b587', farmland: '#b7ad7c', water: '#6798a4',
    stream: '#729eab', facility: '#aca17e', road: '#8c8c80', path: '#c3b79d',
  };
  const materials = Object.fromEntries(Object.entries(colors).map(([key, color]) => [
    key, new T.MeshStandardMaterial({ color, roughness: 0.95, side: T.DoubleSide }),
  ])) as Record<keyof typeof colors, T.MeshStandardMaterial>;
  const trees: Point[] = [];
  const greens = [];
  const waters: Point[][] = [];
  const surfaceOverlays = new T.Group();
  scene.add(surfaceOverlays);
  let seed = 48961;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (const feature of data.features) {
    if (feature.brunnel === 'tunnel') continue;
    const path = feature.category === 'path';
    const key = feature.kind === 'green' ? feature.category as 'wood' | 'grass' | 'farmland'
      : feature.kind === 'road' && path ? 'path' : feature.kind;
    for (const shape of feature.shapes) {
      const mesh = new T.Mesh(groundPolygon(shape, data.ground), materials[key]);
      mesh.receiveShadow = true;
      surfaceOverlays.add(mesh);
      if (feature.kind === 'water') waters.push([...shape[0], shape[0][0]]);
      if (feature.kind === 'green' && feature.category !== 'farmland') greens.push(shape);
      if (key !== 'wood') continue;
      const bounds = new T.Box2().setFromPoints(shape[0].map(p => new T.Vector2(p.x, p.z)));
      const size = bounds.getSize(new T.Vector2());
      const density = Math.min(2200, Math.ceil(size.x * size.y / 260));
      for (let i = 0; i < density; i++) {
        const point = { x: bounds.min.x + size.x * random(), z: bounds.min.y + size.y * random() };
        if (Math.abs(point.x) < extent && Math.abs(point.z) < extent && inShape(point, shape)) trees.push(point);
      }
    }
    for (const points of feature.lines) {
      const width = feature.kind === 'stream' ? feature.category === 'river' ? 8 : 1.8
        : path ? 1.8 : ['trunk', 'primary', 'secondary'].includes(feature.category) ? 10 : 5;
      const offset = feature.kind === 'stream' ? 0.34 : 0.48;
      const mesh = new T.Mesh(ribbon(points, width, (x, z) => data.ground(x, z) + offset), materials[key]);
      mesh.receiveShadow = true;
      (feature.kind === 'road' ? scene : surfaceOverlays).add(mesh);
      if (feature.kind === 'stream') waters.push(points);
    }
  }
  const canopy = new T.InstancedMesh(new T.ConeGeometry(1, 2, 6), new T.MeshStandardMaterial({ color: '#67875f', roughness: 1 }), trees.length);
  const transform = new T.Object3D();
  trees.forEach(({ x, z }, i) => {
    const height = 3.5 + random() * 4;
    transform.position.set(x, data.ground(x, z) + height * 0.68, z);
    transform.scale.set(height * 0.37, height * 0.64, height * 0.37);
    transform.rotation.y = random() * Math.PI;
    transform.updateMatrix();
    canopy.setMatrixAt(i, transform.matrix);
    canopy.setColorAt(i, new T.Color().setHSL(0.245 + random() * 0.04, 0.15, 0.42 + random() * 0.2));
  });
  surfaceOverlays.add(canopy);
  return { greens, waters, surfaceOverlays };
}
