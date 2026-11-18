import type { RegionId } from './regions';
import opo from '../../public/opo-green-access.json';
import songpa from '../../public/datasets/regions/songpa/access.json';
import hospital from '../../public/datasets/regions/songpa/hospital-entrance.json';

export const songpaHospital = hospital;
export const songpaHomeLinks = songpa.homeLinks;
export const songpaStationRouteId = 'songpa-station';

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
