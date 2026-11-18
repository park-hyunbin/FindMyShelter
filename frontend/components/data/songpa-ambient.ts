import archive from '../../public/datasets/regions/songpa/ambient.json';
import { songpaGrounds } from './songpa-grounds';

type Coordinate = [longitude: number, latitude: number];
type Station = {
  serial: string;
  address: string;
  coordinate: number[];
  days: Partial<Record<string, ((number | null)[] | null)[]>>;
};

export type AmbientMoment = { day: string; hour: number };
export const ambientArchive: { start: string; end: string; minute: number; stations: Station[] } = archive;
export const ambientDays = Object.keys(ambientArchive.stations[0].days);
export const defaultAmbientMoment = { day: ambientDays[5], hour: 22 };
export const ambientSources = {
  readings: 'https://data.seoul.go.kr/dataList/OA-22833/S/1/datasetView.do',
  locations: 'https://data.seoul.go.kr/dataList/OA-15969/S/1/datasetView.do',
  lamps: 'https://data.seoul.go.kr/dataList/OA-22205/F/1/datasetView.do',
  road: 'https://www.openstreetmap.org/way/1175929595',
  sidewalk: 'https://www.openstreetmap.org/way/1175929597',
};

// Consecutive OSM Yangjae-daero ways 909242353, 1175929595 and 1175929590.
export const yangjaeRoad: Coordinate[] = [
  [127.1151095, 37.4982572],
  [127.1160683, 37.4987681],
  [127.1163545, 37.4989279],
  [127.1168967, 37.4992462],
];

export const ambientStops = [
  { id: 'yangjae-footway', name: '양재대로 옆 보행로', coordinate: [127.1161724, 37.49858545], lookAt: [127.116483, 37.49899] },
  { id: 'ambient-inner', name: songpaGrounds.points[1].name, coordinate: songpaGrounds.points[1].coordinate, lookAt: [127.1161724, 37.49858545] },
] satisfies { id: string; name: string; coordinate: Coordinate; lookAt: Coordinate }[];

export function ambientTime(hour: number) {
  return `${String(hour).padStart(2, '0')}:${String(ambientArchive.minute).padStart(2, '0')}`;
}
