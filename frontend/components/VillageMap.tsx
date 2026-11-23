import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import mapAreas from './data/tour-map-areas.generated.json';
import type { RegionId } from './data/regions';

export const tourMapAreas = mapAreas;
export type TourMapArea = typeof tourMapAreas[number];
export type MapComplexId = RegionId | `gwangju-a${string}`;

type MapData = {
  width: number;
  height: number;
  metresPerUnit: number;
  markers: Record<string, [number, number]>;
  layers: Record<'green' | 'water' | 'stream' | 'minor' | 'major' | 'sites', string>;
  sitesByRegion?: Record<string, string>;
  footprintsByRegion?: Record<string, string>;
};

export default function VillageMap({ area, selected, onSelect }: {
  area: TourMapArea;
  selected: MapComplexId;
  onSelect: (id: MapComplexId) => void;
}) {
  const [map, setMap] = useState<MapData | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [viewportRatio, setViewportRatio] = useState<number | null>(null);
  const viewport = useRef<HTMLDivElement>(null);

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

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => {
      const { clientWidth, clientHeight } = element;
      if (clientWidth && clientHeight) setViewportRatio(clientWidth / clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [map]);

  if (!map) return <div className="village-map-loading" role="status">
    {failed ? '지도를 불러오지 못했어요. 임장 단지 목록에서 선택할 수 있어요.' : '지역 지도를 불러오는 중…'}
  </div>;

  const ratio = viewportRatio ?? map.width / map.height;
  const fitWidth = Math.min(map.width, map.height * ratio);
  const fitHeight = fitWidth / ratio;
  const mapCenter: [number, number] = [map.width / 2, map.height / 2];
  // Keep all complex pins visible at the initial zoom without stretching the map.
  const zoomToFitPins = Math.max(1, ...Object.values(map.markers).map(([x, y]) => Math.max(
    Math.min(map.width, 2 * Math.abs(x - mapCenter[0]) + map.width * 0.12) / fitWidth,
    Math.min(map.height, 2 * Math.abs(y - mapCenter[1]) + map.height * 0.12) / fitHeight,
  )));
  const width = fitWidth * zoomToFitPins / zoom;
  const height = fitHeight * zoomToFitPins / zoom;
  const [centerX, centerY] = zoom === 1 ? mapCenter : map.markers[selected] ?? mapCenter;
  const left = width >= map.width ? (map.width - width) / 2 : Math.max(0, Math.min(map.width - width, centerX - width / 2));
  const top = height >= map.height ? (map.height - height) / 2 : Math.max(0, Math.min(map.height - height, centerY - height / 2));
  const visibleMetres = width * map.metresPerUnit;
  const scale = visibleMetres >= 2500 ? 500 : visibleMetres >= 1000 ? 200 : 100;

  return <div className="village-map-and-legend">
    <div ref={viewport} className="village-map" style={{ aspectRatio: map.width + ' / ' + map.height }} role="group" aria-label={area.name + ' 단지 위치 지도'}>
      <svg className="village-map-geography" viewBox={[left, top, width, height].join(' ')} aria-hidden="true">
        <path className="village-layer-green" d={map.layers.green} fillRule="evenodd" />
        <path className="village-layer-water" d={map.layers.water} fillRule="evenodd" />
        <path className="village-layer-stream" d={map.layers.stream} />
        <path className="village-layer-minor" d={map.layers.minor} />
        <path className="village-layer-major-casing" d={map.layers.major} />
        <path className="village-layer-major" d={map.layers.major} />
        <path className="village-layer-sites" d={map.layers.sites} fillRule="evenodd" />
        {map.footprintsByRegion?.[selected] && <path className="village-layer-footprints"
          d={map.footprintsByRegion[selected]} fillRule="evenodd" />}
        {map.sitesByRegion?.[selected] && <path className="village-layer-selected-site"
          d={map.sitesByRegion[selected]} fillRule="evenodd" />}
      </svg>
      <div className="village-map-pins" role="group" aria-label="지도에서 단지 선택" data-dense={area.id === 'opo' || undefined}>
        {area.villages.map(village => {
          const marker = map.markers[village.id];
          if (!marker) return null;
          const x = (marker[0] - left) / width * 100;
          const y = (marker[1] - top) / height * 100;
          if (x < 0 || x > 100 || y < 0 || y > 100) return null;
          return <button key={village.id} type="button" className="village-map-pin"
            style={{ left: x + '%', top: y + '%' }} data-side={x > 59 ? 'left' : 'right'}
            aria-label={village.label} aria-pressed={selected === village.id} aria-controls="village-details"
            onClick={() => onSelect(village.id as MapComplexId)}>
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
