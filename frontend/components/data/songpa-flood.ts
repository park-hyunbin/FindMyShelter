import archive from '../../public/datasets/regions/songpa/flood.json';
import forecast from './songpa-flood-forecast.json';
import { songpaEntrance } from './songpa-entrance';
import { songpaGrounds } from './songpa-grounds';

type SurveyYear = {
  polygons: number[][][][];
  nearest: number[] | null;
  nearestSite: number[] | null;
  nearestM: number | null;
  nearestMonth: number | null;
  nearestPeriods: { start: string; end: string | null }[];
  overlap: boolean;
};

export const floodHistory: {
  checkedOn: string;
  radiusM: number;
  years: Record<string, SurveyYear>;
  water: typeof archive.water;
} = archive;

export const floodYears = Object.keys(floodHistory.years).reverse();
export const latestLocalFloodYear = floodYears.find(year => floodHistory.years[year].nearestM != null) ?? floodYears[0];
export const floodSource = 'https://data.seoul.go.kr/dataList/OA-15636/F/1/datasetView.do';
export const floodWaterSource = {
  pond: 'https://www.openstreetmap.org/way/691611266',
  river: 'https://www.openstreetmap.org/way/768407483',
};
export const floodForecast = forecast;
export const floodDepth = [
  { label: '0.5m 이하', color: '#62b9ff' },
  { label: '0.5~1.0m', color: '#7a92ff' },
  { label: '1.0~1.5m', color: '#b288ff' },
  { label: '1.5~2.0m', color: '#d082df' },
  { label: '2.0~3.0m', color: '#d976b5' },
  { label: '3.0m 이상', color: '#f58b9b' },
];
export type FloodView = 'closest' | 'area' | 'forecast' | keyof typeof archive.water;
export type DrainageDistances = {
  forecast: Record<string, number | null>;
  history: Record<string, Record<string, number | null>>;
};

const midpoint = ([a, b]: [number[], number[]]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
export const drainageStops = [
  { id: songpaEntrance.main.id, name: songpaEntrance.main.name, pin: '정문 차단기',
    coordinate: midpoint(songpaEntrance.main.island.axis), check: '보도 가장자리의 빗물받이와 물이 고인 흔적을 확인해요.' },
  { id: songpaGrounds.points[1].id, name: songpaGrounds.points[1].name, pin: '동 사이 포장 공간',
    coordinate: songpaGrounds.points[1].coordinate, check: '포장 경사가 향하는 쪽과 물이 모이는 곳을 확인해요.' },
  { id: songpaEntrance.garage.id, name: '102동 지하주차장 입구 주변', pin: '102동 주차장 덮개 남쪽 끝',
    coordinate: midpoint(songpaEntrance.garage.canopy.sections.at(-1)!), check: '덮개 아래 진입부의 배수로와 차수 시설을 확인해요.' },
];

export function floodDistance(distanceM: number) {
  return `약 ${Math.round(distanceM / 10) * 10}m`;
}
