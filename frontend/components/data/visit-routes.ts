import type { RegionId } from './regions';
import opo from '../../public/opo-green-access.json';
import songpa from '../../public/datasets/regions/songpa/access.json';
import hospital from '../../public/datasets/regions/songpa/hospital-entrance.json';
import busStop from '../../public/datasets/regions/songpa/bus-stop.json';
import stationElevator from '../../public/datasets/regions/songpa/station-elevator.json';
import stationCrossings from '../../public/datasets/regions/songpa/station-crossings.json';

export const songpaHospital = hospital;
export const songpaBusStop = busStop;
export const songpaHomeLinks = songpa.homeLinks;
export const songpaStationRouteId = 'songpa-station';
export const songpaStationCrossings = stationCrossings;
export const songpaStationAccess = {
  exit: '2번 출구',
  elevator: '1·2번 출구 사이',
  elevatorFloors: '지하 1층 대합실과 지상',
  guideDate: '2026-08-31',
  guide: '/datasets/regions/songpa/station-guide.jpg',
  guideSource: 'https://www.data.go.kr/data/15004974/fileData.do',
  elevatorDate: '2025-06-30',
  elevatorSource: 'https://www.data.go.kr/data/15041396/fileData.do',
  elevatorLocation: stationElevator,
};

type AccessRoute = {
  id: string;
  name: string;
  endLabel: string;
  referenceSource: string;
  end: number[];
  segments: { mappedWalkway: boolean; coordinates: number[][] }[];
  lengthM: number;
  walkwayM: number;
  gapM: number | null;
  crossings?: { wayId: number; coordinate: number[] }[];
  crossingView?: { position: number[]; toward: number[] };
  stopView?: { position: number[]; toward: number[] };
  parkEntrance?: { routeM: number; directM: number };
  stepWays?: number;
  variantOf?: string;
  comparisonLabel?: string;
};

type AccessDataset = { startLabel: string; routes: AccessRoute[]; retrieved?: string; source: string };

export const visitRoutes: Record<RegionId, AccessDataset> = {
  opo: { ...opo, startLabel: '단지 진입부' },
  songpa: { ...songpa, startLabel: '송파대로32길·양재대로60길 교차점' },
};
