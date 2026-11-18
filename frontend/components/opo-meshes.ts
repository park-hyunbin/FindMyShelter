import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { extent, inShape, nearestOnLine, type Building, type OpoData, type Point, type Shape } from './opo-data';
import { riverNormals, surfaceUV, type TourMaterials } from './opo-materials';
import type { TreeCover } from './opo-tree-cover';
import { addSongpaTowerExterior, songpaExteriorMaterials } from './opo-songpa-exterior';
import { addStreetExterior } from './opo-street-exterior';
import { buildingAppearance } from './data/building-appearance';
import { buildingProfile, buildingProfiles, type BuildingUse } from './data/building-profile';
import { facadeUV, neighborhoodFacade } from './opo-neighborhood-facade';
import { addLandscapeTrees, type LandscapePoint } from './opo-vegetation';

export function shapeFrom(rings: Shape) {
  const path = (ring: Point[]) => ring.map(({ x, z }) => new T.Vector2(x, -z));
  const shape = new T.Shape(path(rings[0]));
  shape.holes = rings.slice(1).map(ring => new T.Path(path(ring)));
  return shape;
}

export type RoofOutline = { rings: Shape; elevation: number; label: string };
const terrainSegments = 144;
const terrainSpacing = extent * 2 / terrainSegments;

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
  const spacing = terrainSpacing;
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

export function terrainRayBreaks(origin: Point, direction: Point, limit: number) {
  function edge(coordinate: number, velocity: number) {
    return velocity === 0 ? Infinity : ((velocity > 0 ? extent : -extent) - coordinate) / velocity;
  }
  const range = Math.max(0, Math.min(limit, edge(origin.x, direction.x), edge(origin.z, direction.z)));
  const distances = range ? [range] : [];
  // Each rendered triangle lies between two grid edges and the north-east to south-west diagonal.
  for (const [coordinate, velocity] of [
    [origin.x + extent, direction.x],
    [origin.z + extent, direction.z],
    [origin.x + origin.z + 2 * extent, direction.x + direction.z],
  ]) {
    if (Math.abs(velocity) < 1e-10) continue;
    const far = coordinate + velocity * range;
    const first = Math.ceil(Math.min(coordinate, far) / terrainSpacing);
    const last = Math.floor(Math.max(coordinate, far) / terrainSpacing);
    for (let index = first; index <= last; index++) {
      const distance = (index * terrainSpacing - coordinate) / velocity;
      if (distance > 1e-6 && distance < range) distances.push(distance);
    }
  }
  return { range, distances: distances.sort((a, b) => a - b) };
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

export const streetDeckLift = 0.47;

export function ribbon(points: Point[], width: number, elevation: OpoData['ground'], crossStep = Infinity, alongStep = 3) {
  const vertices: number[] = [];
  const indexes: number[] = [];
  const walk: Point[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const distance = Math.hypot(b.x - a.x, b.z - a.z);
    if (distance < 0.05) continue;
    const parts = Math.ceil(distance / alongStep);
    for (let j = 0; j < parts; j++) walk.push({ x: a.x + (b.x - a.x) * j / parts, z: a.z + (b.z - a.z) * j / parts });
  }
  if (!walk.length) return new T.BufferGeometry();
  walk.push(points[points.length - 1]);
  const last = walk.length - 1;
  const closed = last > 2 && walk[0].x === walk[last].x && walk[0].z === walk[last].z;
  const sections = Math.max(1, Math.ceil(width / crossStep));
  const rowLength = sections + 1;
  walk.forEach((point, i) => {
    const a = walk[closed && i === 0 ? last - 1 : Math.max(0, i - 1)];
    const b = walk[closed && i === last ? 1 : Math.min(last, i + 1)];
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const dx = (b.z - a.z) / length * width / 2;
    const dz = (a.x - b.x) / length * width / 2;
    for (let across = 0; across <= sections; across++) {
      const fraction = 1 - 2 * across / sections;
      const x = point.x + dx * fraction, z = point.z + dz * fraction;
      vertices.push(x, elevation(x, z), z);
    }
    if (i) {
      const start = (i - 1) * rowLength;
      for (let across = 0; across < sections; across++) {
        const a = start + across, b = a + rowLength;
        indexes.push(a, b, a + 1, a + 1, b, b + 1);
      }
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
  ctx.fillStyle = '#e5e5dc'; ctx.fillRect(0, 0, 128, 96);
  ctx.fillStyle = '#d6d7cf'; ctx.fillRect(0, 0, 23, 96);
  ctx.fillStyle = '#f1f0e7'; ctx.fillRect(24, 0, 5, 96);
  ctx.fillStyle = '#aeb6b1'; ctx.fillRect(0, 90, 128, 3);
  ctx.fillStyle = '#76888a'; ctx.fillRect(45, 21, 60, 49);
  ctx.fillStyle = '#a8babb'; ctx.fillRect(49, 24, 52, 40);
  ctx.fillStyle = '#607a80'; ctx.fillRect(49, 49, 52, 16);
  ctx.fillStyle = '#e5e6dc'; ctx.fillRect(74, 24, 3, 41);
  ctx.fillStyle = '#f3f2e9'; ctx.fillRect(40, 69, 70, 5); ctx.fillRect(41, 19, 67, 3);
  ctx.fillStyle = '#a0aaa5'; ctx.fillRect(43, 22, 3, 49); ctx.fillRect(104, 22, 3, 49);
  const texture = new T.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
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

function apartmentRoofScene(rings: Shape, coreFaces: Point[][],
    dimensions: { base: number; eave: number; top: number; levels: number; mainRoofRiseM: number },
    finishes: { roof: T.MeshStandardMaterial; wall: T.MeshStandardMaterial }, scene: T.Scene) {
  const { base, eave, top, levels, mainRoofRiseM } = dimensions;
  const { roof: material, wall: pavilionWall } = finishes;
  const outlines = rings.map(ring => [...ring, ring[0]]);
  const edgeDistance = (point: Point) => nearestOnLine(point, outlines).distance;
  const roofRise = top - eave;
  const roofGeometry = groundPolygon(rings, (x, z) => eave + Math.min(mainRoofRiseM, edgeDistance({ x, z }) * 0.39), 2.1, 0);
  const roof = new T.Mesh(roofGeometry, material);
  roof.castShadow = roof.receiveShadow = true;
  scene.add(roof);

  const trim = new T.MeshStandardMaterial({ color: '#98a29d', roughness: 0.92 });
  const accent = new T.MeshStandardMaterial({ color: '#627781', roughness: 0.87 });
  const bandMaterial = new T.MeshStandardMaterial({
    color: '#929c98', roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  for (const floor of [5, 10, levels]) {
    const band = new T.ExtrudeGeometry(shapeFrom(rings), { depth: 0.2, bevelEnabled: false });
    band.rotateX(-Math.PI / 2).translate(0, base + (eave - base) * floor / levels, 0);
    const mesh = new T.Mesh(band, bandMaterial);
    mesh.name = '사진 참고 외벽 띠 장식';
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  const bodyHeight = roofRise * 0.55, lanternHeight = roofRise * 0.2, capHeight = roofRise * 0.25;
  for (const [a, b] of coreFaces) {
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const along = { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
    const middle = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    const normal = { x: -along.z, z: along.x };
    const inward = [1, -1].find(sign => inShape({
      x: middle.x + normal.x * 1.9 * sign, z: middle.z + normal.z * 1.9 * sign,
    }, rings));
    if (!inward) continue;
    const position = { x: middle.x + normal.x * 1.9 * inward, z: middle.z + normal.z * 1.9 * inward };
    const theta = Math.atan2(along.z, along.x);
    function box(width: number, height: number, depth: number, y: number, finish: T.Material, x = position.x, z = position.z) {
      const mesh = new T.Mesh(new T.BoxGeometry(width, height, depth), finish);
      mesh.position.set(x, y + height / 2, z);
      mesh.rotation.y = -theta;
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
      return mesh;
    }
    box(4.4, bodyHeight, 3.5, eave, pavilionWall).name = '사진 참고 지붕 탑';
    box(4.75, 0.2, 3.85, eave + bodyHeight - 0.2, trim);
    for (const x of [-1.7, 1.7]) for (const z of [-1.26, 1.26]) {
      const worldX = position.x + along.x * x - along.z * z;
      const worldZ = position.z + along.z * x + along.x * z;
      box(0.45, lanternHeight, 0.45, eave + bodyHeight, pavilionWall, worldX, worldZ);
    }
    box(4.8, 0.17, 3.9, top - capHeight - 0.17, trim);
    const cap = new T.CylinderGeometry(1.18, 2.55, capHeight, 4, 1);
    cap.rotateY(Math.PI / 4).scale(1.22, 1, 1);
    const canopy = new T.Mesh(cap, material);
    canopy.position.set(position.x, top - capHeight / 2, position.z);
    canopy.rotation.y = -theta;
    canopy.castShadow = true;
    scene.add(canopy);
    const faceX = middle.x - normal.x * inward * 0.1;
    const faceZ = middle.z - normal.z * inward * 0.1;
    box(2.65, eave + bodyHeight - base, 0.18, base, trim, faceX, faceZ);
    box(1.8, eave + bodyHeight - base - 0.6, 0.2, base + 0.3, accent, faceX, faceZ);
  }
}

export function buildMeshes(data: OpoData, scene: T.Scene) {
  const facade = new T.MeshStandardMaterial({ map: facadeTexture(), roughness: 0.88 });
  const appearance = buildingAppearance[data.region];
  const claddingMaterials = appearance?.towerCladding ? songpaExteriorMaterials() : null;
  const apartmentRoof = new T.MeshStandardMaterial({ color: '#665a53', roughness: 0.95 });
  const pavilionWall = new T.MeshStandardMaterial({ color: '#e4e2d8', roughness: 0.91 });
  const defaultMaterials = new Map(Object.entries(buildingProfiles).map(([use, style]) => [use as BuildingUse, {
    roof: new T.MeshStandardMaterial({ color: style.roof, roughness: 0.96 }),
    wall: neighborhoodFacade(use as BuildingUse),
  }]));
  const pitchedRoofMaterial = new T.MeshStandardMaterial({ color: '#845a48', roughness: 0.96 });
  const estimatedGeometry = new Map<T.Material, T.BufferGeometry[]>();
  const footprints = new T.MeshBasicMaterial({ color: '#a89d86' });
  const occluders: T.Mesh[] = [];
  const roofs: RoofOutline[] = [];
  const anchors: { point: T.Vector3; building: Building }[] = [];
  const ground = (x: number, z: number) => terrainSurface(data.ground, x, z);

  for (const building of data.buildings) {
    const { use, profile, sourceHeight, displayHeight, pitchedRoof } = buildingProfile(building);
    const pavilion = appearance?.roofPavilions?.get(building.id);
    const roofRise = sourceHeight && pavilion ? pavilion.roofRiseM : 0;
    const wallHeight = (displayHeight ?? 0) - roofRise;
    const floorHeight = building.levels ? wallHeight / building.levels : profile.floorM;
    const sharedFacade = !building.dong || !sourceHeight;
    const materials = defaultMaterials.get(use)!;
    const roof = pitchedRoof ? pitchedRoofMaterial : materials.roof;
    for (const [index, rings] of building.shapes.entries()) {
      if (displayHeight === null) {
        scene.add(new T.Mesh(groundPolygon(rings, ground), footprints));
        continue;
      }
      const position = rings[0].reduce((p, item) => ({ x: p.x + item.x / rings[0].length, z: p.z + item.z / rings[0].length }), { x: 0, z: 0 });
      const verticalBase = ground(position.x, position.z);
      const skirt = Math.max(1.15, ...rings[0].map(p => verticalBase - ground(p.x, p.z) + 0.75));
      const shape = shapeFrom(rings);
      const genericFloorHeight = building.levels ? floorHeight : displayHeight / Math.max(1, Math.round(displayHeight / profile.floorM));
      const geometry = new T.ExtrudeGeometry(shape, {
        depth: displayHeight + skirt, bevelEnabled: false,
        UVGenerator: sharedFacade ? facadeUV(profile.bayM, genericFloorHeight, skirt) : undefined,
      });
      if (!sharedFacade && !roofRise) {
        const uv = geometry.getAttribute('uv');
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / profile.bayM, (uv.getY(i) - skirt) / floorHeight);
      }
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, verticalBase - skirt, 0);
      if (!sourceHeight) {
        [roof, materials.wall].forEach((material, group) => {
          const bucket = estimatedGeometry.get(material) ?? [];
          bucket.push(splitMaterialGroup(geometry, group));
          estimatedGeometry.set(material, bucket);
        });
        geometry.dispose();
        continue;
      }
      const streetFacade = index === 0 ? appearance?.streetFacades?.get(building.id) : null;
      const streetExterior = streetFacade ? addStreetExterior(streetFacade, building, data, rings[0], verticalBase, sourceHeight, scene) : null;
      const mesh = new T.Mesh(geometry, streetExterior ?? (building.dong ? [apartmentRoof, facade] : [roof, materials.wall]));
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.name = data.region === 'opo' && building.dong ? `오포 포레스트 ${building.dong}` : building.label;
      scene.add(mesh);
      occluders.push(mesh);
      const towerCladding = index === 0 ? appearance?.towerCladding?.get(building.id) : null;
      if (claddingMaterials && towerCladding && building.dong) {
        // Keep the analysis mesh while the photo-based exterior renders at the same maximum height.
        addSongpaTowerExterior(scene, {
          label: mesh.name, number: building.dong.replace('동', ''), levels: building.levels ?? 20,
          points: rings[0], shape, center: position, grade: verticalBase, skirt, top: verticalBase + displayHeight,
        }, towerCladding, claddingMaterials);
        mesh.visible = false;
      }
      if (pavilion && roofRise) {
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
        apartmentRoofScene(rings, pavilion.coreFaces.map(face => face.map(data.project)),
          { base: verticalBase, eave: verticalBase + wallHeight, top: verticalBase + displayHeight,
            levels: building.levels ?? 15, mainRoofRiseM: pavilion.mainRoofRiseM },
          { roof: apartmentRoof, wall: pavilionWall }, scene);
      }
      roofs.push({ rings, elevation: verticalBase + sourceHeight, label: mesh.name });
      if (building.dong && index === 0) {
        anchors.push({ building, point: new T.Vector3(position.x, verticalBase + sourceHeight + 7, position.z) });
      }
    }
  }
  for (const [material, batch] of estimatedGeometry) {
    const visible = batch.filter(geometry => geometry.hasAttribute('position'));
    if (!visible.length) continue;
    const geometry = mergeGeometries(visible);
    batch.forEach(item => item.dispose());
    if (!geometry) continue;
    const mesh = new T.Mesh(geometry, material);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  return { occluders, anchors, roofs };
}

function addReeds(group: T.Group, locations: Point[], surface: OpoData['ground'], random: () => number) {
  if (!locations.length) return;
  const vertices: number[] = [];
  for (let i = 0; i < 7; i++) {
    const x = (random() - 0.5) * 0.33, z = (random() - 0.5) * 0.33;
    const rise = 0.44 + random() * 0.44, bend = 0.19 + random() * 0.17;
    const angle = i * Math.PI * 2 / 7;
    const dx = Math.cos(angle), dz = Math.sin(angle);
    const left = [x - dz * 0.026, 0, z + dx * 0.026];
    const right = [x + dz * 0.026, 0, z - dx * 0.026];
    const stem = [x + dx * bend * 0.25, rise * 0.65, z + dz * bend * 0.25];
    const tip = [x + dx * bend, rise, z + dz * bend];
    vertices.push(...left, ...right, ...stem, ...right, ...tip, ...stem);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  const reeds = new T.InstancedMesh(geometry,
    new T.MeshStandardMaterial({ roughness: 0.92, side: T.DoubleSide }), locations.length);
  const transform = new T.Object3D(), color = new T.Color();
  locations.forEach(({ x, z }, index) => {
    transform.position.set(x, surface(x, z) + 0.06, z);
    transform.scale.set(0.7 + random() * 0.9, 0.66 + random() * 0.68, 0.72 + random() * 0.85);
    transform.rotation.y = random() * Math.PI * 2;
    transform.updateMatrix();
    reeds.setMatrixAt(index, transform.matrix);
    reeds.setColorAt(index, color.setHSL(0.17 + random() * 0.09, 0.3, 0.27 + random() * 0.16, T.SRGBColorSpace));
  });
  reeds.receiveShadow = true;
  group.add(reeds);
}

export function addEnvironment(data: OpoData, scene: T.Scene, finish?: TourMaterials, paved?: (p: Point) => boolean,
    forest?: TreeCover) {
  const colors = {
    wood: '#6d845d', grass: '#a6b587', farmland: '#b7ad7c', water: '#719c9c',
    stream: '#729eab', facility: '#aca17e',
  };
  const materials = Object.fromEntries(Object.entries(colors).map(([key, color]) => [
    key, new T.MeshStandardMaterial({ color, roughness: 0.95, side: T.DoubleSide }),
  ])) as Record<keyof typeof colors, T.MeshStandardMaterial>;
  const waterNormal = finish ? riverNormals() : null;
  const landCover = { wood: 'forest', grass: 'grass', farmland: 'grass' } as const;
  if (finish) {
    for (const key of ['wood', 'grass', 'farmland'] as const) {
      materials[key].color.set(key === 'wood' ? '#c5d1a9' : key === 'grass' ? '#f4ffe1' : '#d8c899');
      finish(materials[key], landCover[key]);
    }
    for (const key of ['water', 'stream'] as const) {
      const material = materials[key];
      material.color.set(key === 'stream' ? '#537874' : '#628986');
      material.normalMap = waterNormal;
      material.normalScale.setScalar(0.65);
      material.roughness = 0.29;
    }
  }
  const trees: LandscapePoint[] = [];
  const greens = [];
  const waters: Point[][] = [];
  const waterAreas = data.features.filter(feature => feature.kind === 'water').flatMap(feature => feature.shapes);
  const waterways = data.features.filter(feature => feature.kind === 'stream' && feature.brunnel !== 'tunnel')
    .flatMap(feature => feature.lines.map(points => ({ points, width: feature.category === 'river' ? 8 : 1.8 })));
  const canPlant = (point: Point) => !paved?.(point) && !waterAreas.some(shape => inShape(point, shape))
    && !waterways.some(({ points, width }) => nearestOnLine(point, [points]).distance <= width / 2);
  const riverbanks: Point[] = [];
  const surfaceOverlays = new T.Group();
  const landCoverOverlays = new T.Group();
  const vegetation = new T.Group();
  surfaceOverlays.add(landCoverOverlays);
  scene.add(surfaceOverlays, vegetation);
  const surface = (x: number, z: number) => terrainSurface(data.ground, x, z);
  let seed = 48961;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (const feature of data.features) {
    if (feature.brunnel === 'tunnel' || feature.kind === 'road') continue;
    const key = feature.kind === 'green' ? feature.category as 'wood' | 'grass' | 'farmland' : feature.kind;
    for (const shape of feature.shapes) {
      const geometry = groundPolygon(shape, surface);
      if (finish && (key === 'wood' || key === 'grass' || key === 'farmland')) surfaceUV(geometry, landCover[key]);
      if (waterNormal && key === 'water') surfaceUV(geometry, 'water');
      const mesh = new T.Mesh(geometry, materials[key]);
      mesh.receiveShadow = true;
      (feature.kind === 'green' ? landCoverOverlays : surfaceOverlays).add(mesh);
      if (feature.kind === 'water') waters.push([...shape[0], shape[0][0]]);
      if (feature.kind === 'green' && feature.category !== 'farmland') greens.push(shape);
      if (key !== 'wood' || forest) continue;
      const bounds = new T.Box2().setFromPoints(shape[0].map(p => new T.Vector2(p.x, p.z)));
      const size = bounds.getSize(new T.Vector2());
      const density = Math.min(2200, Math.ceil(size.x * size.y / 260));
      for (let i = 0; i < density; i++) {
        const point = { x: bounds.min.x + size.x * random(), z: bounds.min.y + size.y * random() };
        if (Math.abs(point.x) < extent && Math.abs(point.z) < extent && inShape(point, shape) && canPlant(point)) trees.push(point);
      }
    }
    for (const points of feature.lines) {
      const width = feature.kind === 'stream' && feature.category === 'river' ? 8 : 1.8;
      const offset = feature.kind === 'stream' ? 0.34 : 0.48;
      const geometry = ribbon(points, width, (x, z) => surface(x, z) + offset);
      if (!geometry.getAttribute('position')?.count) { geometry.dispose(); continue; }
      if (finish && (key === 'wood' || key === 'grass' || key === 'farmland')) surfaceUV(geometry, landCover[key]);
      if (waterNormal && key === 'stream') {
        surfaceUV(geometry, 'water');
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1], b = points[i];
          if (Math.hypot(a.x, a.z) > 280 && Math.hypot(b.x, b.z) > 280) continue;
          const distance = Math.hypot(b.x - a.x, b.z - a.z);
          for (let metre = 0.6; metre < distance; metre += 0.75 + random() * 1.35) {
            const t = metre / distance;
            for (const sign of [-1, 1]) {
              const margin = sign * (width / 2 + 0.2 + random() * 1.2);
              const point = {
                x: T.MathUtils.lerp(a.x, b.x, t) + (b.z - a.z) / distance * margin,
                z: T.MathUtils.lerp(a.z, b.z, t) - (b.x - a.x) / distance * margin,
              };
              if (Math.hypot(point.x, point.z) <= 280 && !paved?.(point)) riverbanks.push(point);
            }
          }
        }
      }
      const mesh = new T.Mesh(geometry, materials[key]);
      mesh.receiveShadow = true;
      surfaceOverlays.add(mesh);
      if (feature.kind === 'stream') waters.push(points);
    }
  }
  if (forest) {
    const inComplex = data.siteOutline.length ? [data.siteOutline] : null;
    trees.push(...forest.placements(random, point => !canPlant(point) || Boolean(inComplex && inShape(point, inComplex))));
  }
  for (const point of data.streetPoints) {
    if (point.kind === 'tree' && canPlant(point.position)) trees.push({ ...point.position, mapped: true, form: point.treeForm });
  }
  addLandscapeTrees(vegetation, trees, surface, Boolean(finish), Boolean(forest));
  addReeds(surfaceOverlays, riverbanks, surface, random);
  return { greens, waters, surfaceOverlays, landCoverOverlays, vegetation, waterNormal, grassTexture: materials.grass.map };
}
