import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';

type Properties = { id: string; name: string | null; dong: string | null; height_m: number | null };
type Buildings = FeatureCollection<Polygon | MultiPolygon, Properties>;
type Manifest = {
  schema_version: number;
  version: string;
  count: number;
  metadata: { center_lnglat: [number, number]; local_origin_xy: [number, number]; radius_m: number };
  chunks: { url: string; count: number; bytes: number; bounds: number[] }[];
};

// Content-addressed chunks use the normal HTTP cache; only four requests run at once.
// GPKG/SHP and QGIS evidence are never fetched by the browser.
export async function loadBuildingDataset(region: string, signal: AbortSignal) {
  if (!/^[a-zA-Z0-9_-]+$/.test(region)) throw new Error('잘못된 지역 코드입니다.');
  const base = `/datasets/buildings/${region}/`;
  const read = async <T,>(url: string, cache: RequestCache = 'default'): Promise<T> => {
    const response = await fetch(url, { signal, cache });
    if (!response.ok) throw new Error(`건물 자료를 불러오지 못했어요 (${response.status})`);
    return response.json();
  };
  const manifest = await read<Manifest>(`${base}manifest.json`, 'no-cache');
  if (manifest.schema_version !== 1) throw new Error('지원하지 않는 건물 데이터 버전입니다.');
  const results: Buildings[] = new Array(manifest.chunks.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, manifest.chunks.length) }, async () => {
    while (cursor < manifest.chunks.length) {
      const index = cursor++;
      const chunk = manifest.chunks[index];
      if (!/^chunks\/[a-f0-9]{64}\.geojson$/.test(chunk.url)) throw new Error('잘못된 데이터 경로입니다.');
      const file = await read<Buildings>(base + chunk.url);
      if (file.features.length !== chunk.count) throw new Error('건물 조각의 개수가 일치하지 않습니다.');
      results[index] = file;
    }
  }));
  const features = results.flatMap(file => file.features);
  if (features.length !== manifest.count || new Set(features.map(f => f.properties.id)).size !== manifest.count) {
    throw new Error('건물 데이터가 중복되거나 누락되었습니다.');
  }
  return { type: 'FeatureCollection' as const, features, metadata: manifest.metadata, version: manifest.version };
}
