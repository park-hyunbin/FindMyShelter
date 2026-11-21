import { useEffect, useState } from 'react';
import mapAreas from './data/tour-map-areas.generated.json';
import type { RegionId } from './data/regions';

export const tourMapAreas = mapAreas;
export type TourMapArea = typeof tourMapAreas[number];

type MapData = {
  width: number;
  height: number;
  metresPerUnit: number;
  markers: Record<string, [number, number]>;
  layers: Record<'green' | 'water' | 'stream' | 'minor' | 'major' | 'sites', string>;
};

export default function VillageMap({ area, selected, onSelect }: {
  area: TourMapArea;
  selected: RegionId;
  onSelect: (id: RegionId) => void;
}) {
  const [map, setMap] = useState<MapData | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/datasets/tour-maps/' + area.id + '.json', { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error('Map data unavailable');
        return response.json() as Promise<MapData>;
      })
      .then(data => setMap(data))
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [area.id]);

  if (!map) return <div className="village-map-loading" role="status">
    {failed ? '지도를 불러오지 못했어요. 임장 단지 목록에서 선택할 수 있어요.' : '지역 지도를 불러오는 중…'}
  </div>;

  const width = map.width / zoom;
  const height = map.height / zoom;
  const [centerX, centerY] = map.markers[selected] ?? [map.width / 2, map.height / 2];
  const left = Math.max(0, Math.min(map.width - width, centerX - width / 2));
  const top = Math.max(0, Math.min(map.height - height, centerY - height / 2));
  const visibleMetres = width * map.metresPerUnit;
  const scale = visibleMetres >= 2500 ? 500 : visibleMetres >= 1000 ? 200 : 100;

  return <div className="village-map-and-legend">
    <div className="village-map" style={{ aspectRatio: map.width + ' / ' + map.height }} role="group" aria-label={area.name + ' 단지 위치 지도'}>
      <svg className="village-map-geography" viewBox={[left, top, width, height].join(' ')} aria-hidden="true">
        <path className="village-layer-green" d={map.layers.green} fillRule="evenodd" />
        <path className="village-layer-water" d={map.layers.water} fillRule="evenodd" />
        <path className="village-layer-stream" d={map.layers.stream} />
        <path className="village-layer-minor" d={map.layers.minor} />
        <path className="village-layer-major-casing" d={map.layers.major} />
        <path className="village-layer-major" d={map.layers.major} />
        <path className="village-layer-sites" d={map.layers.sites} />
      </svg>
      <div className="village-map-pins" role="group" aria-label="지도에서 단지 선택">
        {area.villages.map(village => {
          const marker = map.markers[village.id];
          if (!marker) return null;
          const x = (marker[0] - left) / width * 100;
          const y = (marker[1] - top) / height * 100;
          if (x < 0 || x > 100 || y < 0 || y > 100) return null;
          return <button key={village.id} type="button" className="village-map-pin"
            style={{ left: x + '%', top: y + '%' }} data-side={x > 59 ? 'left' : 'right'}
            aria-pressed={selected === village.id} aria-controls="village-details"
            onClick={() => onSelect(village.id as RegionId)}>
            <span className="village-map-dot" aria-hidden="true" />
            <span className="village-map-name">{village.label}</span>
          </button>;
        })}
      </div>
      <div className="village-map-tools" role="group" aria-label="지도 확대 및 축소">
        <button type="button" onClick={() => setZoom(zoom * 2)} disabled={zoom === 4} aria-label="지도 확대">+</button>
        <button type="button" onClick={() => setZoom(zoom / 2)} disabled={zoom === 1} aria-label="지도 축소">−</button>
      </div>
      <span className="village-map-north" aria-label="북쪽이 위">↑ N</span>
      <span className="village-map-scale" style={{ width: scale / visibleMetres * 100 + '%' }}>{scale}m</span>
    </div>
    <div className="village-map-legend">
      <ul aria-label="지도 범례">
        <li data-layer="road">도로</li>
        <li data-layer="water">하천·물길</li>
        <li data-layer="green">공원·녹지</li>
      </ul>
      <span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a> · OpenFreeMap / OpenMapTiles</span>
    </div>
  </div>;
}
