import * as T from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { extent, inShape, nearestOnLine, outlineCenter, type Building, type OpoData, type Point, type Shape } from './opo-data';
import { riverNormals, surfaceUV, type TourMaterials } from './opo-materials';
import type { TreeCover } from './opo-tree-cover';
import { addSongpaTowerExterior, songpaExteriorMaterials } from './opo-songpa-exterior';
import { addStreetExterior } from './opo-street-exterior';
import { buildingAppearance } from './data/building-appearance';
import { buildingProfile, buildingProfiles, type BuildingUse } from './data/building-profile';
import { buildingFacadeKind } from './data/building-use-code';
import { schoolLevel, schoolStyles, type SchoolLevel } from './data/school-campuses';
import { facadeUV, neighborhoodFacade, type NeighborhoodPalette } from './opo-neighborhood-facade';
import { lowRiseFacadeUV, lowRisePresets, makeDetachedRoof, makeLowRiseFacade, type LowRiseKind } from './opo-low-rise-facade';
import { addLandscapeTrees, type LandscapePoint } from './opo-vegetation';
import { createSurfaceClipper } from './opo-surface-clip';

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
  // Mapped vegetation is a separate surface. Leave unclassified urban ground neutral.
  const urban = data.region === 'songpa';
  const low = new T.Color(urban ? '#ada495' : '#b3be92');
  const high = new T.Color(urban ? '#8c8174' : '#778a62');
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

export function streetDeckLift(region: OpoData['region']) {
  // Urban road decks follow the terrain mesh. This is clearance for rendering,
  // since the elevation source does not resolve road grades and curbs separately.
  return region === 'opo' ? 0.47 : 0.08;
}

export function createTerrainProjection(terrain: T.BufferGeometry) {
  const clipper = createSurfaceClipper(terrainSpacing * 1.5);
  clipper.addSurface(terrain);
  function fit(mask: T.BufferGeometry, lift: number) {
    const geometry = clipper.clip(mask, lift);
    mask.dispose();
    return geometry;
  }
  return {
    fit,
    area: (shape: Shape, lift: number) => fit(groundPolygon(shape, () => 0, terrainSpacing * 3, 0), lift),
    clear: clipper.clear,
  };
}

export type RibbonSection = (point: Point, normal: Point, halfWidth: number) => [number, number];

export function ribbon(points: Point[], width: number, elevation: OpoData['ground'], crossStep = Infinity, alongStep = 3,
  section?: RibbonSection, endNormal?: (point: Point) => Point | undefined, trackPaintCoordinates = false) {
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
  const paintCoordinates = trackPaintCoordinates ? [] as number[] : undefined;
  let station = 0;
  walk.forEach((point, i) => {
    if (paintCoordinates && i > 0) station += Math.hypot(point.x - walk[i - 1].x, point.z - walk[i - 1].z);
    const a = walk[closed && i === 0 ? last - 1 : Math.max(0, i - 1)];
    const b = walk[closed && i === last ? 1 : Math.min(last, i + 1)];
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    let normal = { x: (b.z - a.z) / length, z: (a.x - b.x) / length };
    const shared = !closed && (i === 0 ? endNormal?.(points[0]) : i === last ? endNormal?.(point) : undefined);
    if (shared) {
      const sign = normal.x * shared.x + normal.z * shared.z < 0 ? -1 : 1;
      normal = { x: shared.x * sign, z: shared.z * sign };
    }
    const limits = section?.(point, normal, width / 2);
    for (let across = 0; across <= sections; across++) {
      const offset = limits ? T.MathUtils.lerp(limits[1], limits[0], across / sections)
        : width / 2 * (1 - 2 * across / sections);
      const x = point.x + normal.x * offset, z = point.z + normal.z * offset;
      vertices.push(x, elevation(x, z), z);
      paintCoordinates?.push(offset / width, station);
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
  if (paintCoordinates) {
    for (let index = 1; index < paintCoordinates.length; index += 2) paintCoordinates[index] /= station;
    geometry.setAttribute('paintCoordinates', new T.Float32BufferAttribute(paintCoordinates, 2));
  }
  geometry.setIndex(indexes);
  geometry.computeVertexNormals();
  return geometry;
}

export function paintRibbon(points: Point[], width: number, elevation: OpoData['ground'] = () => 0, crossStep = Infinity) {
  return ribbon(points, width, elevation, crossStep, 3, undefined, undefined, true);
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

function detachedRoofGeometry(rings: Shape, base: number, height: number) {
  const edges = rings.map(ring => [...ring, ring[0]]);
  const bounds = new T.Box2().setFromPoints(rings[0].map(({ x, z }) => new T.Vector2(x, z)));
  const size = bounds.getSize(new T.Vector2());
  // The sampled distance to the eaves keeps the roof within the footprint, including holes.
  const geometry = groundPolygon(rings, (x, z) => nearestOnLine({ x, z }, edges).distance,
    Math.max(1.8, Math.max(size.x, size.y) / 16), 0);
  const position = geometry.getAttribute('position');
  let ridgeDistance = 0;
  for (let i = 0; i < position.count; i++) ridgeDistance = Math.max(ridgeDistance, position.getY(i));
  const rise = Math.min(height * 0.28, ridgeDistance * 0.64, 2.2);
  if (rise < 0.2) {
    geometry.dispose();
    return null;
  }
  const wallHeight = height - rise;
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    position.setY(i, base + wallHeight + rise * position.getY(i) / ridgeDistance);
    uv[i * 2] = position.getX(i);
    uv[i * 2 + 1] = -position.getZ(i);
  }
  geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  return { geometry, wallHeight };
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

function appendOutline(edges: number[], ring: Point[], heightAt: (point: Point) => number) {
  for (const [index, point] of ring.entries()) {
    const next = ring[(index + 1) % ring.length];
    edges.push(point.x, heightAt(point), point.z, next.x, heightAt(next), next.z);
  }
}

export function buildMeshes(data: OpoData, scene: T.Scene) {
  const appearance = buildingAppearance[data.region];
  const claddingMaterials = appearance?.towerCladding ? songpaExteriorMaterials() : null;
  const apartmentRoof = new T.MeshStandardMaterial({ color: '#665a53', roughness: 0.95 });
  const pavilionWall = new T.MeshStandardMaterial({ color: '#e4e2d8', roughness: 0.91 });
  const apartmentMaterials = (style: NeighborhoodPalette) => ({
    roof: new T.MeshStandardMaterial({ color: style.roof, roughness: 0.96 }),
    wall: neighborhoodFacade('apartments', style),
  });
  const plainMaterials = new Map(Object.entries(buildingProfiles).map(([use, style]) => [use as BuildingUse, {
    roof: new T.MeshStandardMaterial({ color: style.roof, roughness: 0.96 }),
    wall: new T.MeshStandardMaterial({ color: style.wall, roughness: 0.94 }),
  }]));
  const detailMaterials = new Map<string, { roof: T.MeshStandardMaterial; wall: T.MeshStandardMaterial }>();
  const schoolMaterials = new Map<SchoolLevel, { roof: T.MeshStandardMaterial; wall: T.MeshStandardMaterial }>();
  function materialsForSchool(level: SchoolLevel) {
    let materials = schoolMaterials.get(level);
    if (!materials) {
      const colors = schoolStyles[level];
      materials = { roof: new T.MeshStandardMaterial({ color: colors.roof, roughness: 0.96 }),
        wall: neighborhoodFacade('civic', colors) };
      schoolMaterials.set(level, materials);
    }
    return materials;
  }
  function materialsForLowRise(kind: LowRiseKind, id: string) {
    const { palettes } = lowRisePresets[kind];
    // Keep each footprint's palette stable across reloads and neighboring tours.
    const keyHash = [...id].reduce((hash, character) => (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0, 0);
    const index = keyHash % palettes.length;
    const key = `${kind}:${index}`;
    let materials = detailMaterials.get(key);
    if (!materials) {
      const style = palettes[index];
      materials = {
        roof: kind === 'detached' ? makeDetachedRoof(style.roof)
          : new T.MeshStandardMaterial({ color: style.roof, roughness: 0.96 }),
        wall: makeLowRiseFacade(kind, style),
      };
      detailMaterials.set(key, materials);
    }
    return materials;
  }
  const defaultApartments = apartmentMaterials(buildingProfiles.apartments);
  const towerVisualization = data.region === 'jamsil-leel' ? apartmentMaterials({
    wall: '#bec5cb', glass: '#344a60', trim: '#84919e', roof: '#777e87', accent: '#556173',
  }) : null;
  const neighborMaterials = [...(appearance?.neighborApartments ?? [])].map(([name, style]) =>
    [name, apartmentMaterials(style)] as const);
  const pitchedRoofMaterial = new T.MeshStandardMaterial({ color: '#845a48', roughness: 0.96 });
  const estimatedGeometry = new Map<T.Material, T.BufferGeometry[]>();
  function addEstimatedGeometry(material: T.Material, geometry: T.BufferGeometry) {
    const batch = estimatedGeometry.get(material) ?? [];
    batch.push(geometry);
    estimatedGeometry.set(material, batch);
  }
  const footprints = new T.MeshBasicMaterial({ color: '#a89d86' });
  const occluders: T.Mesh[] = [];
  const roofs: RoofOutline[] = [];
  const targetEdges: number[] = [];
  const retailIds = new Set(data.places.flatMap(place => place.building ? [place.building.id] : []));
  const retailOutlines = new Map<string, LineSegments2>();
  const retailMaterial = retailIds.size ? new LineMaterial({
    color: '#c68a56', linewidth: 3, depthWrite: false, depthTest: false, toneMapped: false,
  }) : undefined;
  const anchors: { point: T.Vector3; building: Building; displayHeight: number }[] = [];
  const ground = (x: number, z: number) => terrainSurface(data.ground, x, z);

  for (const building of data.buildings) {
    const retailEdges = retailIds.has(building.id) ? [] as number[] : undefined;
    const { use, profile, sourceHeight, displayHeight, pitchedRoof } = buildingProfile(building);
    const kind = buildingFacadeKind(building.bd_code_type, building.category);
    const explicitSchool = schoolLevel(building.category) ?? schoolLevel(building.label);
    const campus = !building.dong && kind === 'unknown' && !explicitSchool
      ? data.schoolCampuses.find(({ outline }) => {
        const exterior = building.shapes[0][0];
        return inShape(outlineCenter(exterior), outline) && exterior.filter(point => inShape(point, outline)).length >= exterior.length * 0.7;
      }) : undefined;
    const grade = !building.dong && kind === 'unknown' ? explicitSchool ?? campus?.level : undefined;
    const apartment = kind === 'apartment';
    const lowRise = kind !== 'apartment' && kind !== 'unknown' ? kind : null;
    const pavilion = appearance?.roofPavilions?.get(building.id);
    const roofRise = sourceHeight && pavilion ? pavilion.roofRiseM : 0;
    const wallHeight = (displayHeight ?? 0) - roofRise;
    const floorHeight = building.levels ? wallHeight / building.levels : profile.floorM;
    const neighborApartment = apartment && !building.dong;
    const recordedFinish = neighborApartment && neighborMaterials.find(([name]) => building.label.startsWith(name));
    const materials = grade && displayHeight !== null ? materialsForSchool(grade) : apartment
      ? (building.dong && towerVisualization) || (recordedFinish && recordedFinish[1]) || defaultApartments
      : lowRise && displayHeight !== null ? materialsForLowRise(lowRise, building.id) : plainMaterials.get(use)!;
    const roof = pitchedRoof && kind !== 'detached' ? pitchedRoofMaterial : materials.roof;
    for (const [index, rings] of building.shapes.entries()) {
      if (displayHeight === null) {
        scene.add(new T.Mesh(groundPolygon(rings, ground), footprints));
        if (building.dong) appendOutline(targetEdges, rings[0], point => ground(point.x, point.z) + 0.25);
        if (retailEdges) appendOutline(retailEdges, rings[0], point => ground(point.x, point.z) + 0.55);
        continue;
      }
      const position = outlineCenter(rings[0]);
      const verticalBase = ground(position.x, position.z);
      const skirt = Math.max(1.15, ...rings[0].map(p => verticalBase - ground(p.x, p.z) + 0.75));
      const shape = shapeFrom(rings);
      const genericFloorHeight = building.levels ? floorHeight : displayHeight / Math.max(1, Math.round(displayHeight / profile.floorM));
      const apartmentOutline = apartment && rings.length === 1 ? rings[0] : undefined;
      const houseRoof = kind === 'detached' && !roofRise ? detachedRoofGeometry(rings, verticalBase, displayHeight) : null;
      const bodyHeight = houseRoof && !sourceHeight ? houseRoof.wallHeight : displayHeight;
      const geometry = new T.ExtrudeGeometry(shape, {
        depth: bodyHeight + skirt, bevelEnabled: false,
        UVGenerator: grade ? facadeUV(buildingProfiles.civic.bayM, genericFloorHeight, skirt)
          : lowRise ? lowRiseFacadeUV(lowRise, rings[0], genericFloorHeight * bodyHeight / displayHeight, skirt)
          : apartment ? facadeUV(profile.bayM, genericFloorHeight, skirt, apartmentOutline) : undefined,
      });
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, verticalBase - skirt, 0);
      if (building.dong) appendOutline(targetEdges, rings[0], () => verticalBase + displayHeight + 0.18);
      if (retailEdges) appendOutline(retailEdges, rings[0], () => verticalBase + displayHeight + 0.28);
      if (building.dong && index === 0 && (sourceHeight || building.visualHeight)) {
        anchors.push({ building, displayHeight, point: new T.Vector3(position.x, verticalBase + displayHeight + 7, position.z) });
      }
      if (!sourceHeight) {
        addEstimatedGeometry(roof, houseRoof?.geometry ?? splitMaterialGroup(geometry, 0));
        addEstimatedGeometry(materials.wall, splitMaterialGroup(geometry, 1));
        geometry.dispose();
        continue;
      }
      const streetFacade = apartment && index === 0 ? appearance?.streetFacades?.get(building.id) : null;
      const streetExterior = streetFacade ? addStreetExterior(streetFacade, building, data, rings[0], verticalBase, sourceHeight, scene) : null;
      const mesh = new T.Mesh(geometry, streetExterior ?? (apartment && building.dong
        ? [apartmentRoof, materials.wall] : [roof, materials.wall]));
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.name = data.region === 'opo' && building.dong ? `오포 포레스트 ${building.dong}` : building.label;
      scene.add(mesh);
      occluders.push(mesh);
      if (houseRoof) {
        // Keep the original volume for the existing sunlight and sightline analyses.
        mesh.visible = false;
        const exterior = new T.ExtrudeGeometry(shape, {
          depth: houseRoof.wallHeight + skirt, bevelEnabled: false,
          UVGenerator: lowRiseFacadeUV('detached', rings[0], genericFloorHeight * houseRoof.wallHeight / displayHeight, skirt),
        });
        exterior.rotateX(-Math.PI / 2).translate(0, verticalBase - skirt, 0);
        const walls = new T.Mesh(splitMaterialGroup(exterior, 1), materials.wall);
        const cap = new T.Mesh(houseRoof.geometry, roof);
        exterior.dispose();
        walls.castShadow = walls.receiveShadow = cap.castShadow = cap.receiveShadow = true;
        scene.add(walls, cap);
      }
      const towerCladding = index === 0 ? appearance?.towerCladding?.get(building.id) : null;
      if (apartment && claddingMaterials && towerCladding && building.dong) {
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
        const exterior = new T.ExtrudeGeometry(shape, {
          depth: wallHeight + skirt, bevelEnabled: false,
          UVGenerator: facadeUV(profile.bayM, genericFloorHeight, skirt, apartmentOutline),
        });
        exterior.rotateX(-Math.PI / 2).translate(0, verticalBase - skirt, 0);
        const facadeMesh = new T.Mesh(exterior, [apartmentRoof, materials.wall]);
        facadeMesh.name = `${mesh.name} 외관`;
        facadeMesh.castShadow = facadeMesh.receiveShadow = true;
        scene.add(facadeMesh);
        apartmentRoofScene(rings, pavilion.coreFaces.map(face => face.map(data.project)),
          { base: verticalBase, eave: verticalBase + wallHeight, top: verticalBase + displayHeight,
            levels: building.levels ?? 15, mainRoofRiseM: pavilion.mainRoofRiseM },
          { roof: apartmentRoof, wall: pavilionWall }, scene);
      }
      roofs.push({ rings, elevation: verticalBase + sourceHeight, label: mesh.name });
    }
    if (retailEdges?.length && retailMaterial) {
      const outline = new LineSegments2(new LineSegmentsGeometry().setPositions(retailEdges), retailMaterial);
      outline.name = `상업시설 연결 · ${building.id}`;
      outline.visible = false;
      outline.renderOrder = 4;
      retailOutlines.set(building.id, outline);
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
  const targetOutline = targetEdges.length ? new LineSegments2(
    new LineSegmentsGeometry().setPositions(targetEdges),
    new LineMaterial({ color: '#b28254', linewidth: 2.5, depthWrite: false, toneMapped: false }),
  ) : null;
  if (targetOutline) {
    targetOutline.name = '임장 대상 건물 외곽선';
    targetOutline.renderOrder = 6;
    scene.add(targetOutline);
  }
  return { occluders, anchors, roofs, targetOutline, retailOutlines };
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

export function addEnvironment(data: OpoData, scene: T.Scene, terrain: ReturnType<typeof createTerrainProjection> | undefined,
    finish?: TourMaterials, paved?: (p: Point) => boolean,
    forest?: TreeCover, sidewalkTrees?: ReadonlyMap<string, number>) {
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
  const clearOfWater = (point: Point) => !waterAreas.some(shape => inShape(point, shape))
    && !waterways.some(({ points, width }) => nearestOnLine(point, [points]).distance <= width / 2);
  const canPlant = (point: Point) => !paved?.(point) && clearOfWater(point);
  const riverbanks: Point[] = [];
  const surfaceOverlays = new T.Group();
  const landCoverOverlays = new T.Group();
  const vegetation = new T.Group();
  surfaceOverlays.add(landCoverOverlays);
  scene.add(surfaceOverlays, vegetation);
  const surface = (x: number, z: number) => terrainSurface(data.ground, x, z);
  for (const rings of data.neighborhoodPlanting) {
    // Keep the survey base below detailed park, courtyard and pavement surfaces.
    const geometry = terrain ? terrain.area(rings, 0.012) : groundPolygon(rings, surface, 12, 0.012);
    if (!geometry.getAttribute('position')?.count) {
      geometry.dispose();
      continue;
    }
    if (finish) surfaceUV(geometry, 'grass');
    const mesh = new T.Mesh(geometry, materials.grass);
    mesh.receiveShadow = true;
    landCoverOverlays.add(mesh);
    greens.push(rings);
  }
  let seed = 48961;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (const feature of data.features) {
    if (feature.brunnel === 'tunnel' || feature.kind === 'road') continue;
    const key = feature.kind === 'green' ? feature.category as 'wood' | 'grass' | 'farmland' : feature.kind;
    for (const shape of feature.shapes) {
      const groundCover = feature.kind === 'green' || feature.kind === 'facility';
      const geometry = groundCover && terrain ? terrain.area(shape, 0.024) : groundPolygon(shape, surface);
      if (geometry.getAttribute('position').count) {
        if (finish && (key === 'wood' || key === 'grass' || key === 'farmland')) surfaceUV(geometry, landCover[key]);
        if (waterNormal && key === 'water') surfaceUV(geometry, 'water');
        const mesh = new T.Mesh(geometry, materials[key]);
        mesh.receiveShadow = true;
        (feature.kind === 'green' ? landCoverOverlays : surfaceOverlays).add(mesh);
      } else geometry.dispose();
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
    if (point.kind !== 'tree') continue;
    const sidewalkHeight = sidewalkTrees?.get(point.id);
    if (sidewalkHeight === undefined ? canPlant(point.position) : clearOfWater(point.position)) {
      trees.push({ ...point.position, mapped: true, form: point.treeForm, species: point.treeSpecies, sidewalkHeight });
    }
  }
  addLandscapeTrees(vegetation, trees, surface, Boolean(finish), Boolean(forest));
  addReeds(surfaceOverlays, riverbanks, surface, random);
  return { greens, waters, surfaceOverlays, landCoverOverlays, vegetation, waterNormal, grassTexture: materials.grass.map };
}
