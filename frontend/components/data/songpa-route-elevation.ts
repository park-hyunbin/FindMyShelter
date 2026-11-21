import dataset from '../../public/datasets/regions/songpa/route-elevation.json';

export type SurveyedRoute = {
  path: string;
  samples: { distanceM: number; elevationM: number; nearestInputM: number; contourM?: number }[];
  checkedSpots: number;
  meanErrorM: number;
  maxErrorM: number;
  entranceSample?: number;
};

export type RouteElevationDataset = { routes: Record<string, SurveyedRoute> };
export const songpaRouteElevation = dataset;

export function surveyedRoute(id: string, coordinates: number[][], source: RouteElevationDataset) {
  const survey = source.routes[id];
  if (!survey) return undefined;
  const path = coordinates.map(([lon, lat]) => `${lon.toFixed(7)},${lat.toFixed(7)}`).join(';');
  return survey.path === path ? survey : undefined;
}
