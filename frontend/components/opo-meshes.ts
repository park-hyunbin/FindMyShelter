import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { extent, inShape, nearestOnLine, type Building, type OpoData, type Point, type Shape } from './opo-data';

export function shapeFrom(rings: Shape) {
  const path = (ring: Point[]) => ring.map(({ x, z }) => new T.Vector2(x, -z));
  const shape = new T.Shape(path(rings[0]));
  shape.holes = rings.slice(1).map(ring => new T.Path(path(ring)));
  return shape;
}

export type RoofOutline = { rings: Shape; elevation: number; label: string };
const terrainSegments = 144;

export function makeGround(data: OpoData) {
  const geometry = new T.PlaneGeometry(extent * 2, extent * 2, terrainSegments, terrainSegments);
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

export function terrainSurface(ground: OpoData['ground'], x: number, z: number) {
  const spacing = extent * 2 / terrainSegments;
  const column = T.MathUtils.clamp((x + extent) / spacing, 0, terrainSegments);
  const row = T.MathUtils.clamp((z + extent) / spacing, 0, terrainSegments);
  const i = Math.min(terrainSegments - 1, Math.floor(column));
  const j = Math.min(terrainSegments - 1, Math.floor(row));
  const fx = column - i, fz = row - j;
  const left = i * spacing - extent, top = j * spacing - extent;
  const northEast = ground(left + spacing, top), southWest = ground(left, top + spacing);
  if (fx + fz <= 1) return ground(left, top) * (1 - fx - fz) + northEast * fx + southWest * fz;
  return ground(left + spacing, top + spacing) * (fx + fz - 1) + northEast * (1 - fz) + southWest * (1 - fx);
}

export function groundPolygon(rings: Shape, ground: OpoData['ground'], maxEdge = 12, lift = 0.23) {
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
    if (longest < maxEdge) {
      for (const point of [a, b, c]) vertices.push(point.x, ground(point.x, point.z) + lift, point.z);
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
    const parts = Math.ceil(distance / 3);
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
  ctx.fillStyle = '#f1e9da'; ctx.fillRect(40, 66, 74, 5); ctx.fillRect(43, 14, 67, 4);
  ctx.fillStyle = '#7c8580'; ctx.fillRect(45, 18, 3, 50); ctx.fillRect(105, 18, 3, 50);
  const texture = new T.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function neighborhoodFacade(wall: string, glass: string, trim: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 96; canvas.height = 80;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = wall; ctx.fillRect(0, 0, 96, 80);
  ctx.fillStyle = trim; ctx.fillRect(0, 70, 96, 5); ctx.fillRect(12, 16, 70, 44);
  ctx.fillStyle = glass; ctx.fillRect(15, 19, 64, 36);
  ctx.fillStyle = trim; ctx.fillRect(44, 19, 4, 36);
  ctx.fillStyle = '#d4e0d6'; ctx.fillRect(15, 19, 64, 3);
  const texture = new T.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  return new T.MeshStandardMaterial({ map: texture, roughness: 0.87 });
}

function buildingStyle(building: Building) {
  if (/industrial|warehouse|commercial|retail|공장|창고|근린생활/.test(building.category)) return 2;
  if (/apartments|school|church|hospital|공동주택|학교|다세대/.test(building.category)) return 1;
  return [...building.id].reduce((hash, c) => (hash * 31 + c.charCodeAt(0)) >>> 0, 0) % 3 === 0 ? 3 : 0;
}

function splitMaterialGroup(geometry: T.BufferGeometry, index: number) {
  const result = new T.BufferGeometry();
  const group = geometry.groups.find(item => item.materialIndex === index);
  if (!group) return result;
  for (const attribute of ['position', 'normal', 'uv']) {
    const source = geometry.getAttribute(attribute);
    result.setAttribute(attribute, new T.BufferAttribute(
      source.array.slice(group.start * source.itemSize, (group.start + group.count) * source.itemSize), source.itemSize));
  }
  return result;
}

function apartmentRoofScene(rings: Shape, eave: number, top: number, material: T.MeshStandardMaterial,
    pavilionWall: T.MeshStandardMaterial, scene: T.Scene) {
  const outlines = rings.map(ring => [...ring, ring[0]]);
  const edgeDistance = (point: Point) => nearestOnLine(point, outlines).distance;
  const roofRise = top - eave;
  const roofGeometry = groundPolygon(rings, (x, z) => eave + Math.min(roofRise, edgeDistance({ x, z }) * 0.39), 2.1, 0);
  const roof = new T.Mesh(roofGeometry, material);
  roof.castShadow = roof.receiveShadow = true;
  scene.add(roof);

  const outline = rings[0];
  const center = outline.reduce((p, a) => ({ x: p.x + a.x / outline.length, z: p.z + a.z / outline.length }), { x: 0, z: 0 });
  const moment = outline.reduce((sum, p) => {
    const x = p.x - center.x, z = p.z - center.z;
    return { xx: sum.xx + x * x, xz: sum.xz + x * z, zz: sum.zz + z * z };
  }, { xx: 0, xz: 0, zz: 0 });
  const theta = 0.5 * Math.atan2(2 * moment.xz, moment.xx - moment.zz);
  const along = { x: Math.cos(theta), z: Math.sin(theta) };
  const projections = outline.map(p => (p.x - center.x) * along.x + (p.z - center.z) * along.z);
  const reach = Math.max(...projections) - Math.min(...projections);
  const fractions = reach > 38 ? [-0.23, 0.23] : [0];
  for (const fraction of fractions) {
    const position = [1, 0.75, 0.55].map(factor => ({
      x: center.x + along.x * fraction * reach * factor, z: center.z + along.z * fraction * reach * factor,
    })).find(p => inShape(p, rings) && edgeDistance(p) > 2.9);
    if (!position) continue;
    const body = new T.Mesh(new T.BoxGeometry(4.05, roofRise * 0.69, 3.15), pavilionWall);
    body.position.set(position.x, eave + roofRise * 0.34, position.z);
    body.rotation.y = -theta;
    body.castShadow = body.receiveShadow = true;
    scene.add(body);
    const cap = new T.CylinderGeometry(1.12, 2.49, roofRise * 0.34, 4, 1);
    cap.rotateY(Math.PI / 4);
    cap.scale(1.25, 1, 1);
    const canopy = new T.Mesh(cap, material);
    canopy.position.set(position.x, top - roofRise * 0.17, position.z);
    canopy.rotation.y = -theta;
    canopy.castShadow = true;
    scene.add(canopy);
  }
}

export function buildMeshes(data: OpoData, scene: T.Scene) {
  const facade = new T.MeshStandardMaterial({ map: facadeTexture(), roughness: 0.88 });
  const apartmentRoof = new T.MeshStandardMaterial({ color: '#805e4f', roughness: 0.95 });
  const pavilionWall = new T.MeshStandardMaterial({ color: '#d6cabb', roughness: 0.91 });
  const roofColors = ['#70645a', '#777875', '#596d71', '#845a48'];
  const roofMaterials = roofColors.map(color => new T.MeshStandardMaterial({ color, roughness: 0.96 }));
  const facadeMaterials = [
    neighborhoodFacade('#d8d1ba', '#63777a', '#a9a18e'),
    neighborhoodFacade('#d5c4ac', '#65757b', '#a19a8d'),
    neighborhoodFacade('#bdc4bf', '#667f86', '#94a09f'),
    neighborhoodFacade('#b89480', '#6a7d80', '#977968'),
  ];
  const displayRoofs = roofColors.map(() => [] as T.BufferGeometry[]);
  const displayWalls = roofColors.map(() => [] as T.BufferGeometry[]);
  const footprints = new T.MeshBasicMaterial({ color: '#a89d86' });
  const occluders: T.Mesh[] = [];
  const roofs: RoofOutline[] = [];
  const anchors: { point: T.Vector3; building: Building }[] = [];

  for (const building of data.buildings) {
    for (const [index, rings] of building.shapes.entries()) {
      if (!building.height && data.region !== 'opo') {
        scene.add(new T.Mesh(groundPolygon(rings, data.ground), footprints));
        continue;
      }
      const position = rings[0].reduce((p, item) => ({ x: p.x + item.x / rings[0].length, z: p.z + item.z / rings[0].length }), { x: 0, z: 0 });
      const verticalBase = data.ground(position.x, position.z);
      const skirt = Math.max(1.15, ...rings[0].map(p => verticalBase - data.ground(p.x, p.z) + 0.75));
      const style = buildingStyle(building);
      const displayHeight = building.height || (building.levels ? Math.min(65, building.levels * 3.05)
        : /garage|shed|greenhouse|hut/.test(building.category) ? 3.1 : style === 2 ? 6.4 : style === 1 ? 10 : 5.9);
      const shape = shapeFrom(rings);
      const geometry = new T.ExtrudeGeometry(shape, { depth: displayHeight + skirt, bevelEnabled: false });
      const roofRise = building.dong && building.height ? 2.8 : 0;
      const wallHeight = displayHeight - roofRise;
      const floorHeight = building.dong && building.levels ? wallHeight / building.levels : 3.1;
      if (!roofRise) {
        const uv = geometry.getAttribute('uv');
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 3.25, (uv.getY(i) - skirt) / floorHeight);
      }
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, verticalBase - skirt, 0);
      const roofStyle = ['gabled', 'hipped', 'half-hipped'].includes(building.roof ?? '') ? 3 : style;
      if (!building.height) {
        displayRoofs[roofStyle].push(splitMaterialGroup(geometry, 0));
        displayWalls[style].push(splitMaterialGroup(geometry, 1));
        geometry.dispose();
        continue;
      }
      const mesh = new T.Mesh(geometry, building.dong ? [apartmentRoof, facade] : [roofMaterials[roofStyle], facadeMaterials[style]]);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.name = building.dong ? `오포 포레스트 ${building.dong}` : building.label;
      scene.add(mesh);
      occluders.push(mesh);
      if (roofRise) {
        // Site shadow/ray analyses retain the registered-height envelope.
        mesh.visible = false;
        const exterior = new T.ExtrudeGeometry(shape, { depth: wallHeight + skirt, bevelEnabled: false });
        const exteriorUV = exterior.getAttribute('uv');
        const exteriorPosition = exterior.getAttribute('position');
        for (let i = 0; i < exteriorUV.count; i++) exteriorUV.setXY(i,
          exteriorUV.getX(i) / 4.6, (exteriorPosition.getZ(i) - skirt) / floorHeight);
        exterior.rotateX(-Math.PI / 2).translate(0, verticalBase - skirt, 0);
        const facadeMesh = new T.Mesh(exterior, [apartmentRoof, facade]);
        facadeMesh.name = `${mesh.name} 외관`;
        facadeMesh.castShadow = facadeMesh.receiveShadow = true;
        scene.add(facadeMesh);
        apartmentRoofScene(rings, verticalBase + wallHeight, verticalBase + displayHeight, apartmentRoof, pavilionWall, scene);
      }
      roofs.push({ rings, elevation: verticalBase + building.height, label: mesh.name });
      if (building.dong && index === 0) {
        anchors.push({ building, point: new T.Vector3(position.x, verticalBase + building.height + 7, position.z) });
      }
    }
  }
  for (const [sets, materials] of [[displayRoofs, roofMaterials], [displayWalls, facadeMaterials]] as const) {
    sets.forEach((batch, style) => {
      const visible = batch.filter(geometry => geometry.hasAttribute('position'));
      if (!visible.length) return;
      const geometry = mergeGeometries(visible);
      batch.forEach(item => item.dispose());
      if (!geometry) return;
      const mesh = new T.Mesh(geometry, materials[style]);
      mesh.receiveShadow = true;
      scene.add(mesh);
    });
  }
  return { occluders, anchors, roofs };
}

export function addEnvironment(data: OpoData, scene: T.Scene) {
  const colors = {
    wood: '#6d845d', grass: '#a6b587', farmland: '#b7ad7c', water: '#719c9c',
    stream: '#729eab', facility: '#aca17e',
  };
  const materials = Object.fromEntries(Object.entries(colors).map(([key, color]) => [
    key, new T.MeshStandardMaterial({ color, roughness: 0.95, side: T.DoubleSide }),
  ])) as Record<keyof typeof colors, T.MeshStandardMaterial>;
  const trees: Point[] = [];
  const greens = [];
  const waters: Point[][] = [];
  const surfaceOverlays = new T.Group();
  const vegetation = new T.Group();
  scene.add(surfaceOverlays, vegetation);
  const surface = (x: number, z: number) => terrainSurface(data.ground, x, z);
  let seed = 48961;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (const feature of data.features) {
    if (feature.brunnel === 'tunnel' || feature.kind === 'road') continue;
    const key = feature.kind === 'green' ? feature.category as 'wood' | 'grass' | 'farmland' : feature.kind;
    for (const shape of feature.shapes) {
      const mesh = new T.Mesh(groundPolygon(shape, surface), materials[key]);
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
      const width = feature.kind === 'stream' && feature.category === 'river' ? 8 : 1.8;
      const offset = feature.kind === 'stream' ? 0.34 : 0.48;
      const mesh = new T.Mesh(ribbon(points, width, (x, z) => surface(x, z) + offset), materials[key]);
      mesh.receiveShadow = true;
      surfaceOverlays.add(mesh);
      if (feature.kind === 'stream') waters.push(points);
    }
  }
  for (const point of data.streetPoints) if (point.kind === 'tree') trees.push(point.position);
  const treeMaterial = new T.MeshStandardMaterial({ color: '#93a776', roughness: 1 });
  const canopy = new T.InstancedMesh(new T.SphereGeometry(1, 9, 6), treeMaterial, trees.length);
  const trunk = new T.InstancedMesh(new T.CylinderGeometry(0.12, 0.19, 1, 6),
    new T.MeshStandardMaterial({ color: '#766754', roughness: 1 }), trees.length);
  const transform = new T.Object3D();
  trees.forEach(({ x, z }, i) => {
    const height = 3.5 + random() * 4;
    transform.position.set(x, surface(x, z) + height * 0.66, z);
    transform.scale.set(height * 0.30, height * (i % 4 ? 0.43 : 0.58), height * 0.30);
    transform.rotation.y = random() * Math.PI;
    transform.updateMatrix();
    canopy.setMatrixAt(i, transform.matrix);
    canopy.setColorAt(i, new T.Color().setHSL(0.23 + random() * 0.055, 0.19, 0.40 + random() * 0.24));
    transform.position.y = surface(x, z) + height * 0.29;
    transform.scale.set(1, height * 0.59, 1);
    transform.updateMatrix();
    trunk.setMatrixAt(i, transform.matrix);
  });
  canopy.receiveShadow = true;
  vegetation.add(trunk, canopy);
  return { greens, waters, surfaceOverlays };
}
