import archive from '../../public/datasets/regions/songpa/flood.json';

type SurveyYear = {
  polygons: number[][][][];
  nearest: number[] | null;
  nearestSite: number[] | null;
  nearestM: number | null;
  nearestMonth: number | null;
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
export type FloodView = 'closest' | 'area' | keyof typeof archive.water;
