import proj4 from 'proj4';
import type { FeatureCollection, LineString, MultiLineString, MultiPolygon, Polygon, Position } from 'geojson';

export type Point = { x: number; z: number };
export type Shape = Point[][];
export type Building = { id: string; label: string; dong: string | null; height: number | null; shapes: Shape[] };
type BuildingProperties = { id: string; name: string | null; dong: string | null; height_m: number | null };
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
  elevation: number[]; spread: number[]; meanRelativeDifferenceFrom90M: number;
};
type SiteFile = FeatureCollection<LineString | Polygon, { id: number; kind: 'road' | 'boundary'; bridge: boolean }>;

export type Environment = EnvironmentProperties & { lines: Point[][]; shapes: Shape[] };
export type OpoData = Awaited<ReturnType<typeof loadOpoData>>;
export const extent = 1250;
export const precinct = 330;
const epsg5186 = '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs';

async function json<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error(`자료를 불러오지 못했어요 (${response.status})`);
  return response.json();
}

export function terrainSample(grid: TerrainFile, values: number[], x: number, z: number) {
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

export async function loadOpoData(signal: AbortSignal) {
  const [source, environment, dem, site, surrounding] = await Promise.all([
    json<BuildingFile>('/sample-buildings.geojson', signal),
    json<EnvironmentFile>('/opo-environment.geojson', signal),
    json<TerrainFile>('/opo-terrain.json', signal),
    json<SiteFile>('/opo-site.geojson', signal),
    json<OsmBuildingFile>('/opo-osm-buildings.geojson', signal),
  ]);
  const { center_lnglat: center, local_origin_xy: origin, radius_m: buildingRadius } = source.metadata;
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
  const elevationAt = (x: number, z: number) => terrainSample(dem, dem.elevation, x, z);
  const spreadAt = (x: number, z: number) => terrainSample(dem, dem.spread, x, z);
  const base = elevationAt(0, 0);
  const ground = (x: number, z: number) => elevationAt(x, z) - base;
  const toShape = (rings: Position[][]) => rings.map(ring => ring.slice(0, -1).map(project));

  const toBuilding = ({ geometry, properties }: BuildingFile['features'][number]): Building => ({
    id: properties.id,
    label: [properties.name ?? '주변 건물', properties.dong === properties.name ? null : properties.dong].filter(Boolean).join(' '),
    dong: properties.name === '오포 롯데캐슬 포레스트' ? properties.dong : null,
    height: properties.height_m,
    shapes: (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates).map(toShape),
  });
  const buildings = source.features.map(toBuilding);
  const outlineCenter = (ring: Point[]) => ring.reduce((sum, point) => ({
    x: sum.x + point.x / ring.length, z: sum.z + point.z / ring.length,
  }), { x: 0, z: 0 });
  const existing = buildings.flatMap(building => building.shapes.map(shape => ({ shape, center: outlineCenter(shape[0]) })));
  const additional = surrounding.features.map(toBuilding).filter(building => {
    const shape = building.shapes[0], center = outlineCenter(shape[0]);
    return !existing.some(original => inShape(center, original.shape) || inShape(original.center, shape));
  });
  // Preserve the QGIS measurements when a building is present in both sources.
  const heightGaps = [...buildings, ...additional].filter(building => !building.height).flatMap(building => building.shapes);
  buildings.push(...additional.filter(building => building.height));
  const features: Environment[] = environment.features.map(({ geometry, properties }) => ({
    ...properties,
    lines: geometry.type === 'LineString' ? [geometry.coordinates.map(project)]
      : geometry.type === 'MultiLineString' ? geometry.coordinates.map(line => line.map(project)) : [],
    shapes: geometry.type === 'Polygon' ? [toShape(geometry.coordinates)]
      : geometry.type === 'MultiPolygon' ? geometry.coordinates.map(toShape) : [],
  }));
  const siteRoads = site.features.flatMap(({ geometry, properties }) => geometry.type === 'LineString'
    ? [{ points: geometry.coordinates.map(project), bridge: properties.bridge, id: properties.id }] : []);
  const siteOutline = site.features.flatMap(({ geometry }) => geometry.type === 'Polygon'
    ? geometry.coordinates[0].map(project) : []);
  const date = environment.metadata.tile_source.match(/\/(\d{4})(\d{2})(\d{2})_/);
  const referenceHeight = Math.max(...buildings.map(building => building.height ?? 0));
  return { center, ground, elevationAt, spreadAt, buildings, heightGaps, referenceHeight, features, siteRoads, siteOutline, project, northOffset, buildingRadius,
    terrainSource: { name: dem.source, catalog: dem.catalog, datum: dem.verticalDatum, resolution: dem.nativeResolutionM,
      epoch: dem.sourceEpoch, relativeDifference: dem.meanRelativeDifferenceFrom90M },
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
