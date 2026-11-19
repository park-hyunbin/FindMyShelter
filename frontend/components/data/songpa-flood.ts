import archive from '../../public/datasets/regions/songpa/flood.json';
import forecast from './songpa-flood-forecast.json';

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

export function floodDistance(distanceM: number) {
  return `약 ${Math.round(distanceM / 10) * 10}m`;
}
