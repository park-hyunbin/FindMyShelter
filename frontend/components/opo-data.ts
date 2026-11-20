import proj4 from 'proj4';
import { loadBuildingDataset } from './data/building-dataset';
import { regions, songpaComplex, type RegionId } from './data/regions';
import { garakGreenStrip, songpaCourtyard, songpaFrontage, songpaGrounds } from './data/songpa-grounds';
import { songpaEntrance } from './data/songpa-entrance';
import { songiPark } from './data/songi-park';
import { songpaStationCrossings } from './data/visit-routes';
import type { FeatureCollection, LineString, MultiLineString, MultiPolygon, Polygon, Position } from 'geojson';
import register from '../public/opo-building-register.json';
import treeCover from '../public/opo-tree-cover.json';
import songpaBusStop from '../public/datasets/regions/songpa/bus-stop.json';
import songpaStreetTrees from '../public/datasets/regions/songpa/street-trees.json';
import songpaTreeInventory from '../public/datasets/regions/songpa/street-tree-inventory.json';

export type Place = { id: string; name: string; category: string; distance_m: number; point: Point };
export type Point = { x: number; z: number };
export type Shape = Point[][];
export type Building = {
  id: string; label: string; dong: string | null; height: number | null;
  levels: number | null; category: string; roof: string | null; shapes: Shape[];
};
type BuildingProperties = {
  id: string; name: string | null; dong: string | null; height_m: number | null;
  levels?: number | null; floors?: number | null; building?: string; use?: string; roof?: string | null; area_m2?: number;
};
type StreetProperties = {
  id: number; category: string; nodeIds: number[]; name: string | null; motor: boolean;
  width: number | null; lanes: number | null; surface: string | null; bridge: boolean; unpaved: boolean;
  forwardLanes?: number; backwardLanes?: number;
  sidewalks: boolean[]; markings: boolean; oneWay: -1 | 0 | 1;
};
type StreetPointProperties = { id: string; kind: 'bus' | 'crossing' | 'lamp' | 'signal' | 'tree' | 'bench' | 'place'; name: string | null };
type StreetFile = {
  metadata: { source: string }; roads: (StreetProperties & { coordinates: Position[] })[];
  points: (StreetPointProperties & { coordinates: Position })[]; parking: { id: number; coordinates: Position[] }[];
  crossingWays?: [Position, Position][];
};
export type StreetPaint = 'yellow' | 'yellow-dash' | 'yellow-double' | 'yellow-combined' | 'blue' | 'blue-dash' | 'white' | 'white-dash' | 'stop';
type StreetPaintFile = {
  lanesSource: string; crosswalksSource: string; crosswalkInventory: string;
  markingsArchiveDate: string; crosswalkInventoryDate: string;
  lanes: { style: StreetPaint; points: Position[]; edge?: boolean }[];
  crosswalks: { center: Position; inventoryMatch: boolean; surfaces: Position[][] }[];
  paintedHumps?: {
    source: string; archiveDate: string;
    records: { id: string; start: [number, number]; end: [number, number]; outline: [number, number][] }[];
  };
};
export type Street = StreetProperties & { points: Point[] };
export type StreetPoint = StreetPointProperties & {
  position: Point; treeForm?: 'broadleaf' | 'pine'; treeSpecies?: string; surveyedTree?: boolean;
};
type BuildingFile = FeatureCollection<Polygon | MultiPolygon, BuildingProperties> & {
  metadata: { center_lnglat: [number, number]; local_origin_xy: [number, number]; radius_m: number };
};
type OsmBuildingFile = FeatureCollection<Polygon, BuildingProperties>;
type EnvironmentKind = 'road' | 'green' | 'facility' | 'water' | 'stream';
type EnvironmentProperties = { kind: EnvironmentKind; category: string; subclass?: string; brunnel?: string; name?: string };
type EnvironmentFile = FeatureCollection<LineString | MultiLineString | Polygon | MultiPolygon, EnvironmentProperties> & {
  metadata: { tile_source: string };
};
type TerrainFile = {
  source: string; catalog: string; verticalDatum: string; nativeResolutionM: number; sourceEpoch: string;
  originEPSG5186: [number, number]; extentM: number; spacingM: number; size: number;
  elevation: number[]; spread: number[]; meanRelativeDifferenceFrom90M?: number;
};
type TerrainGrid = Pick<TerrainFile, 'extentM' | 'spacingM' | 'size'>;
type NeighborhoodTerrain = TerrainGrid & {
  source: string; archivePublished: string; scale: number; originEPSG5186: [number, number];
  center: [number, number]; elevation: number[]; edgeFeatherM?: number;
};
type SiteFile = FeatureCollection<LineString | Polygon, { id: number; kind: 'road' | 'boundary'; bridge: boolean }>;
type PavementFile = {
  roads: Position[][][];
  sidewalks: Position[][][];
  coveredSegments: [roadId: number, startNode: number, intervals: [from: number, to: number][]][];
};

export type Environment = EnvironmentProperties & { lines: Point[][]; shapes: Shape[] };
export type OpoData = Awaited<ReturnType<typeof loadOpoData>>;
export const extent = 1250;
export const precinct = 330;
const epsg5186 = '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs';
const positiveDimension = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

async function json<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error(`자료를 불러오지 못했어요 (${response.status})`);
  return response.json();
}

export function terrainSample(grid: TerrainGrid, values: number[], x: number, z: number) {
  const { extentM, size, spacingM } = grid;
  const column = Math.max(0, Math.min(size - 1, (x + extentM) / spacingM));
  const row = Math.max(0, Math.min(size - 1, (z + extentM) / spacingM));
  const i = Math.min(size - 2, Math.floor(column));
  const j = Math.min(size - 2, Math.floor(row));
  const a = column - i, b = row - j;
  const index = j * size + i;
  return (values[index] * (1 - a) + values[index + 1] * a) * (1 - b)
    + (values[index + size] * (1 - a) + values[index + size + 1] * a) * b;
}

function outlineArea(shapes: Shape[]) {
  return shapes.reduce((total, shape) => total + shape.reduce((area, ring, index) => {
    const twiceArea = ring.reduce((sum, point, i) => {
      const next = ring[(i + 1) % ring.length];
      return sum + point.x * next.z - next.x * point.z;
    }, 0);
    return area + Math.abs(twiceArea) / 2 * (index === 0 ? 1 : -1);
  }, 0), 0);
}

function regionalStreets(features: Environment[]): Street[] {
  const nodes = new Map<string, number>();
  const roads = features.filter(road => road.kind === 'road' && road.brunnel !== 'tunnel');
  return roads.flatMap(road => road.lines.filter(points => points.length > 1).map(points => {
    const bridge = road.brunnel === 'bridge';
    // Shared vertices join adjacent tile lines. Keep overpasses apart from surface roads.
    const nodeIds = points.map(point => {
      const key = `${Math.round(point.x * 100)},${Math.round(point.z * 100)},${bridge}`;
      const existing = nodes.get(key);
      if (existing !== undefined) return existing;
      const id = nodes.size;
      nodes.set(key, id);
      return id;
    });
    const category = road.category === 'minor' ? 'residential'
      : road.category === 'path' ? road.subclass ?? 'footway' : road.category;
    return { category, nodeIds, points, name: road.name ?? null,
      motor: road.category !== 'path' && road.category !== 'track',
      width: null, lanes: null, surface: null, bridge, unpaved: road.category === 'track',
      sidewalks: [], markings: false, oneWay: 0 as const };
  })).map((road, id) => ({ ...road, id }));
}

export async function loadOpoData(signal: AbortSignal, region: RegionId = 'opo') {
  const area = regions.find(r => r.id === region)!;
  const empty = {type: 'FeatureCollection' as const, features: []};
  const [source, environment, dem, site, surrounding, poi, neighborhood, localTerrain, roadMarkings, pavement] = await Promise.all([
    loadBuildingDataset(region, signal),
    json<EnvironmentFile>(area.environment, signal),
    json<TerrainFile>(area.terrain, signal),
    area.site ? json<SiteFile>(area.site, signal) : Promise.resolve(empty as SiteFile),
    area.surrounding ? json<OsmBuildingFile>(area.surrounding, signal) : Promise.resolve(empty as OsmBuildingFile),
    json<FeatureCollection<import('geojson').Point, Omit<Place, 'point'>>>(area.places, signal),
    area.streets ? json<StreetFile>(area.streets, signal) : Promise.resolve(null),
    area.neighborhoodTerrain ? json<NeighborhoodTerrain>(area.neighborhoodTerrain, signal) : Promise.resolve(null),
    area.roadMarkings ? json<StreetPaintFile>(area.roadMarkings, signal) : Promise.resolve(null),
    area.pavement ? json<PavementFile>(area.pavement, signal) : Promise.resolve(null),
  ]);
  const { center_lnglat: center, local_origin_xy: origin, radius_m: importedBuildingRadius } = source.metadata;
  // Import window includes edge buildings; it does not expand the original sample's analysis coverage.
  const buildingRadius = region === 'opo' ? Math.min(300, importedBuildingRadius) : importedBuildingRadius;
  const projection = proj4('WGS84', epsg5186);
  const project = ([lng, lat]: Position): Point => {
    const [east, north] = projection.forward([lng, lat]);
    return { x: east - origin[0], z: origin[1] - north };
  };
  const north = project([center[0], center[1] + 0.001]);
  const northOffset = Math.atan2(north.x, -north.z);
  if (dem.extentM < extent || dem.spacingM * (dem.size - 1) !== dem.extentM * 2
      || dem.elevation.length !== dem.size ** 2 || dem.spread.length !== dem.size ** 2
      || origin.some((value, i) => value !== dem.originEPSG5186[i])) throw new Error('건물과 고도 자료의 범위가 일치하지 않아요.');
  if (region === 'opo' && (treeCover.extentM !== extent || origin.some((value, i) => value !== treeCover.originEPSG5186[i]))) {
    throw new Error('수목 피복과 지형 자료의 범위가 일치하지 않아요.');
  }
  if (localTerrain && (localTerrain.spacingM * (localTerrain.size - 1) !== localTerrain.extentM * 2
    || localTerrain.elevation.length !== localTerrain.size ** 2
    || origin.some((value, i) => value !== localTerrain.originEPSG5186[i]))) throw new Error('송파 상세 지형의 범위가 일치하지 않아요.');
  const coarseElevation = (x: number, z: number) => terrainSample(dem, dem.elevation, x, z);
  // Interpolate the local correction separately so the two grids meet at the same coarse elevation.
  const localCorrection = localTerrain?.elevation.map((value, index) => {
    const { center, spacingM, extentM, size } = localTerrain;
    const column = index % size, row = Math.floor(index / size);
    if (column === 0 || row === 0 || column === size - 1 || row === size - 1) return 0;
    return value - coarseElevation(center[0] + column * spacingM - extentM, center[1] + row * spacingM - extentM);
  });
  const elevationAt = (x: number, z: number) => {
    const coarse = coarseElevation(x, z);
    if (!localTerrain || !localCorrection) return coarse;
    const dx = x - localTerrain.center[0], dz = z - localTerrain.center[1];
    return Math.max(Math.abs(dx), Math.abs(dz)) >= localTerrain.extentM
      ? coarse : coarse + terrainSample(localTerrain, localCorrection, dx, dz);
  };
  const spreadAt = (x: number, z: number) => terrainSample(dem, dem.spread, x, z);
  const base = elevationAt(0, 0);
  const ground = (x: number, z: number) => elevationAt(x, z) - base;
  const toShape = (rings: Position[][]) => rings.map(ring => ring.slice(0, -1).map(project));
  const trafficIslands = region === 'songpa' ? songpaStationCrossings.islands.map(island => ({
    shape: toShape(island.shape),
    paving: island.paving.map(toShape),
    planting: island.planting.map(toShape),
    trees: island.trees.map((coordinate, index) => ({ id: `island-${island.ufid}-${index}`, position: project(coordinate) })),
  })) : [];

  const officialHeights = new Map(register.towers.map(row => [row.outlineId, row]));
  const registerRows: (typeof register.towers[number] & { outlineAreaM2: number })[] = [];
  const toBuilding = ({ geometry, properties }: BuildingFile['features'][number]): Building => {
    const dong = region === 'opo' && properties.name === '오포 롯데캐슬 포레스트' ? properties.dong
      : region === 'songpa' ? songpaComplex.towers.find(tower => tower.id === properties.id)?.dong ?? null : null;
    const row = officialHeights.get(properties.id);
    const recorded = row && row.dong === dong ? row : undefined;
    const shapes = (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates).map(toShape);
    const name = properties.name ?? (region === 'songpa' && properties.id === '55781807' ? '예일아파트' : '주변 건물');
    const unit = dong ?? properties.dong;
    if (recorded) registerRows.push({ ...recorded, outlineAreaM2: properties.area_m2 ?? outlineArea(shapes) });
    return {
      id: properties.id,
      label: unit && !name.endsWith(unit) ? `${name} ${unit}` : name,
      dong,
      height: positiveDimension(recorded?.heightM ?? properties.height_m),
      levels: positiveDimension(recorded?.aboveGroundFloors ?? properties.levels ?? properties.floors),
      category: properties.use || properties.building || '',
      roof: properties.roof ?? null,
      shapes,
    };
  };
  const buildings = source.features.map(toBuilding);
  const outlineCenter = (ring: Point[]) => ring.reduce((sum, point) => ({
    x: sum.x + point.x / ring.length, z: sum.z + point.z / ring.length,
  }), { x: 0, z: 0 });
  const existing = buildings.flatMap(building => building.shapes.map(shape => ({ shape, center: outlineCenter(shape[0]) })));
  const additional = surrounding.features.map(toBuilding).filter(building => {
    const shape = building.shapes[0], center = outlineCenter(shape[0]);
    return Math.abs(center.x) < extent && Math.abs(center.z) < extent
      && !existing.some(original => inShape(center, original.shape) || inShape(original.center, shape));
  });
  // Preserve the QGIS measurements when a building is present in both sources.
  const heightGaps = [...buildings, ...additional].filter(building => !building.height).flatMap(building => building.shapes);
  buildings.push(...additional);
  const features: Environment[] = environment.features.map(({ geometry, properties }) => ({
    ...properties,
    lines: geometry.type === 'LineString' ? [geometry.coordinates.map(project)]
      : geometry.type === 'MultiLineString' ? geometry.coordinates.map(line => line.map(project)) : [],
    shapes: geometry.type === 'Polygon' ? [toShape(geometry.coordinates)]
      : geometry.type === 'MultiPolygon' ? geometry.coordinates.map(toShape) : [],
  }));
  if (region === 'songpa') {
    const parkAnchor = project(garakGreenStrip.anchor);
    const parkIndex = features.findIndex(feature => feature.kind === 'green' && feature.subclass === 'park'
      && feature.shapes.some(rings => inShape(parkAnchor, rings)));
    if (parkIndex >= 0) features.splice(parkIndex, 1);
    for (const { category, shapes } of garakGreenStrip.cover) {
      features.push({ kind: 'green', category, subclass: 'park', lines: [], shapes: shapes.map(toShape) });
    }
  }
  const siteRoads = site.features.flatMap(({ geometry, properties }) => geometry.type === 'LineString'
    ? [{ points: geometry.coordinates.map(project), bridge: properties.bridge, id: properties.id }] : []);
  const siteOutline = site.features.flatMap(({ geometry }) => geometry.type === 'Polygon'
    ? geometry.coordinates[0].map(project) : []);
  const streets: Street[] = neighborhood
    ? neighborhood.roads.map(({ coordinates, ...tags }) => ({ ...tags, points: coordinates.map(project) }))
    : regionalStreets(features);
  if (region === 'songpa') {
    const [entrance, innerPath] = songiPark.views.map(view => project(view.coordinate));
    const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z) < 1;
    // The vector tile rounds the original footway nodes by a fraction of a metre.
    const parkApproach = streets.find(road => road.category === 'footway' && road.points.length === 2
      && ((near(road.points[0], entrance) && near(road.points[1], innerPath))
        || (near(road.points[1], entrance) && near(road.points[0], innerPath))));
    if (parkApproach) parkApproach.width = songiPark.approachWidthM;
  }
  const officialStop = region === 'songpa' ? songpaBusStop : null;
  const streetPoints: StreetPoint[] = (neighborhood?.points ?? []).filter(({ id }) => id !== officialStop?.osmPointId)
    .map(({ coordinates, ...tags }) => ({ ...tags, position: project(coordinates) }))
    .filter(({ position }) => Math.abs(position.x) < extent && Math.abs(position.z) < extent);
  if (officialStop) streetPoints.push({
    id: officialStop.osmPointId, kind: 'bus', name: officialStop.name, position: project(officialStop.coordinate),
  });
  if (region === 'songpa') {
    const recordedForm = (species: string): StreetPoint['treeForm'] =>
      /소나무|향나무|잣나무|메타세쿼이아|측백|주목/.test(species) ? 'pine' : 'broadleaf';
    const matches = new Map(Object.entries(songpaTreeInventory.surveyMatches));
    const surveyed: StreetPoint[] = songpaStreetTrees.trees.map(({ id, coordinate }) => {
      const match = matches.get(id);
      return { id, kind: 'tree', name: null, treeSpecies: match?.species, position: project(coordinate), surveyedTree: true,
        treeForm: match ? recordedForm(match.species) : 'broadleaf' };
    });
    surveyed.push(...songpaTreeInventory.sidewalkTrees.map(({ row, species, coordinate }): StreetPoint => ({
      id: `seoul-tree-2026-${row}`, kind: 'tree', name: null, treeSpecies: species, position: project(coordinate),
      surveyedTree: true, treeForm: recordedForm(species),
    })));
    // Primary tree positions replace nearby lower-detail OSM tree points.
    const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
    for (let i = streetPoints.length - 1; i >= 0; i--) {
      const point = streetPoints[i];
      if (point.kind === 'tree' && surveyed.some(tree => distance(tree.position, point.position) < 2)) streetPoints.splice(i, 1);
    }
    const entranceCrowns = [...songpaGrounds.crowns, ...songpaFrontage.crowns].map(project);
    const entranceInventory = songpaTreeInventory.entranceContext.map(row => ({ ...row, point: project(row.coordinate) }));
    function entranceSpecies(position: Point) {
      if (!entranceInventory.length) return undefined;
      const closest = entranceInventory.reduce((a, b) => distance(position, a.point) <= distance(position, b.point) ? a : b);
      if (distance(position, closest.point) > 2.5) return undefined;
      const nearestCrown = entranceCrowns.reduce((a, b) => distance(closest.point, a) <= distance(closest.point, b) ? a : b);
      return nearestCrown === position ? closest.species : undefined;
    }
    for (const [index, position] of entranceCrowns.entries()) {
      if (surveyed.some(tree => distance(tree.position, position) < 2)) continue;
      const species = entranceSpecies(position);
      streetPoints.push({ id: `songpa-entrance-crown-${index}`, kind: 'tree', name: null, treeSpecies: species, position,
        treeForm: species ? recordedForm(species) : index >= songpaGrounds.crowns.length ? 'broadleaf' : undefined });
    }
    for (const [index, coordinate] of [...songpaCourtyard.crowns, ...songiPark.crowns].entries()) {
      streetPoints.push({ id: `songpa-crown-${index}`, kind: 'tree', name: null, position: project(coordinate) });
    }
    for (const [index, coordinate] of garakGreenStrip.crowns.entries()) {
      streetPoints.push({ id: `garak-green-crown-${index}`, kind: 'tree', name: null, position: project(coordinate) });
    }
    streetPoints.push(...surveyed);
  }
  for (const island of trafficIslands) {
    for (const tree of island.trees) streetPoints.push({ ...tree, kind: 'tree', name: null, treeForm: 'broadleaf' });
  }
  const parking = (neighborhood?.parking ?? []).map(({ coordinates }) => toShape([coordinates]));
  const date = environment.metadata.tile_source.match(/\/(\d{4})(\d{2})(\d{2})_/);
  const referenceHeight = Math.max(...buildings.map(building => building.height ?? 0));
  const placeOrigin = region === 'songpa'
    ? { point: project(songpaEntrance.main.position), label: songpaEntrance.main.name }
    : { point: { x: 0, z: 0 }, label: '단지 원점' };
  const places: Place[] = poi.features.map(f => {
    const point = project(f.geometry.coordinates);
    const distance_m = Math.round(Math.hypot(point.x - placeOrigin.point.x, point.z - placeOrigin.point.z));
    return { ...f.properties, point, distance_m };
  }).filter(p => Math.abs(p.point.x) < extent && Math.abs(p.point.z) < extent)
    .sort((a, b) => a.distance_m - b.distance_m || a.id.localeCompare(b.id));
  return { region, area, places, placeOrigin, center, ground, elevationAt, spreadAt, buildings, heightGaps, referenceHeight,
    features, siteRoads, siteOutline, project, northOffset, buildingRadius, streets, streetPoints, parking,
    treeCover: region === 'opo' ? treeCover : null,
    streetSource: neighborhood?.metadata.source ?? environment.metadata.tile_source,
    buildingRegister: region === 'opo' ? { ...register, towers: registerRows.sort((a, b) => a.dong.localeCompare(b.dong)) } : null,
    terrainSource: { name: dem.source, catalog: dem.catalog, datum: dem.verticalDatum, resolution: dem.nativeResolutionM,
      epoch: dem.sourceEpoch, relativeDifference: dem.meanRelativeDifferenceFrom90M },
    localTerrain: localTerrain && { source: localTerrain.source, spacing: localTerrain.spacingM, scale: localTerrain.scale,
      edgeFeatherM: localTerrain.edgeFeatherM },
    roadMarkings, crossingWays: neighborhood?.crossingWays?.map(([a, b]) => [project(a), project(b)] as const) ?? [],
    pavement: pavement && { roads: pavement.roads.map(toShape), sidewalks: pavement.sidewalks.map(toShape), trafficIslands,
      coveredSegments: pavement.coveredSegments },
    snapshot: date?.slice(1).join('-') ?? '기준일 미확인' };
}

export function inShape(point: Point, rings: Shape): boolean {
  const inside = (ring: Point[]) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.z > point.z) !== (b.z > point.z) && point.x < a.x + (b.x - a.x) * (point.z - a.z) / (b.z - a.z)) hit = !hit;
    }
    return hit;
  };
  return inside(rings[0]) && !rings.slice(1).some(inside);
}

export function buildingCollision(buildings: Building[]) {
  const cellSize = 40;
  const cells = new Map<string, Shape[]>();
  for (const building of buildings) for (const shape of building.shapes) {
    const outline = shape[0];
    const left = Math.floor(Math.min(...outline.map(p => p.x)) / cellSize);
    const right = Math.floor(Math.max(...outline.map(p => p.x)) / cellSize);
    const top = Math.floor(Math.min(...outline.map(p => p.z)) / cellSize);
    const bottom = Math.floor(Math.max(...outline.map(p => p.z)) / cellSize);
    for (let x = left; x <= right; x++) for (let z = top; z <= bottom; z++) {
      const key = `${x},${z}`;
      const cell = cells.get(key);
      if (cell) cell.push(shape);
      else cells.set(key, [shape]);
    }
  }
  return (point: Point) => {
    const key = `${Math.floor(point.x / cellSize)},${Math.floor(point.z / cellSize)}`;
    return cells.get(key)?.some(shape => inShape(point, shape)) ?? false;
  };
}

export function nearestOnLine(point: Point, lines: Point[][]) {
  let best = { distance: Infinity, point };
  for (const line of lines) for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const dx = b.x - a.x, dz = b.z - a.z;
    const lengthSquared = dx * dx + dz * dz;
    if (!lengthSquared) continue;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared));
    const candidate = { x: a.x + dx * t, z: a.z + dz * t };
    const distance = Math.hypot(point.x - candidate.x, point.z - candidate.z);
    if (distance < best.distance) best = { distance, point: candidate };
  }
  return best;
}

// Distance along a unit horizontal ray from a point inside the circular import window.
export function distanceToBuildingCoverage(origin: Point, direction: Point, radius: number) {
  const towardEdge = origin.x * direction.x + origin.z * direction.z;
  const inside = radius ** 2 - origin.x ** 2 - origin.z ** 2;
  return Math.max(0, -towardEdge + Math.sqrt(Math.max(0, towardEdge ** 2 + inside)));
}

export function splitLineAt(points: Point[], target: Point) {
  let best = { distance: Infinity, point: points[0], index: 0 };
  for (let i = 1; i < points.length; i++) {
    const candidate = nearestOnLine(target, [[points[i - 1], points[i]]]);
    if (candidate.distance < best.distance) best = { ...candidate, index: i };
  }
  const { index, point } = best;
  const before = points.slice(0, index);
  const after = points.slice(index);
  const distinct = (other?: Point) => other && Math.hypot(point.x - other.x, point.z - other.z) > 0.01;
  if (distinct(before.at(-1))) before.push(point);
  if (distinct(after[0])) after.unshift(point);
  return { before, after, point };
}
