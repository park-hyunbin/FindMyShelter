import type { OpoData, Point } from './opo-data';
import { songpaRouteElevation, type SurveyedRoute } from './data/songpa-route-elevation';

export const routeTerrainStep = 50;
export type RouteTerrainSample = {
  distance: number; position: Point; elevation: number; spread?: number; bearing: number;
  nearestInputM?: number; contourM?: number;
  gradient: number | null; gradientDistance: number;
};
export type RouteTerrainProfile = {
  length: number;
  samples: RouteTerrainSample[];
  survey?: SurveyedRoute;
  steepest?: { start: number; end: number; gradient: number; index: number };
};

export function routeTerrainProfile(
  data: Pick<OpoData, 'elevationAt' | 'spreadAt' | 'northOffset'>,
  lines: Point[][],
  survey?: SurveyedRoute,
): RouteTerrainProfile {
  let length = 0;
  const edges = lines.flatMap(line => line.slice(1).flatMap((b, index) => {
    const a = line[index];
    const distance = Math.hypot(b.x - a.x, b.z - a.z);
    if (!distance) return [];
    const start = length;
    length += distance;
    return [{ a, b, start, end: length, distance }];
  }));
  if (!edges.length) return { length: 0, samples: [] };

  const samples: RouteTerrainSample[] = [];
  let edgeIndex = 0;
  const distances = survey?.samples.map(sample => Math.min(sample.distanceM, length))
    ?? Array.from({ length: Math.ceil(length / routeTerrainStep) + 1 }, (_, index) => Math.min(index * routeTerrainStep, length));
  for (const [index, distance] of distances.entries()) {
    while (edgeIndex < edges.length - 1 && distance > edges[edgeIndex].end) edgeIndex++;
    const edge = edges[edgeIndex];
    const fraction = (distance - edge.start) / edge.distance;
    const position = {
      x: edge.a.x + (edge.b.x - edge.a.x) * fraction,
      z: edge.a.z + (edge.b.z - edge.a.z) * fraction,
    };
    const bearing = Math.atan2(edge.b.x - edge.a.x, edge.a.z - edge.b.z) * 180 / Math.PI
      - data.northOffset * 180 / Math.PI;
    const reference = survey?.samples[index];
    samples.push({
      distance, position, bearing, gradient: null, gradientDistance: 0,
      ...(reference ? { elevation: reference.elevationM, nearestInputM: reference.nearestInputM, contourM: reference.contourM }
        : { elevation: data.elevationAt(position.x, position.z), spread: data.spreadAt(position.x, position.z) }),
    });
  }
  if (survey) return { length, samples, survey, steepest: summarizeSurveyedSlope(length, samples) };
  for (const [index, sample] of samples.entries()) {
    const before = samples[Math.max(0, index - 1)];
    const after = samples[Math.min(samples.length - 1, index + 1)];
    sample.gradientDistance = after.distance - before.distance;
    // Use a window of at least 50m for this coarse terrain model.
    if (sample.gradientDistance >= routeTerrainStep) {
      sample.gradient = (after.elevation - before.elevation) / sample.gradientDistance * 100;
    }
  }
  return { length, samples };
}

function summarizeSurveyedSlope(length: number, samples: RouteTerrainSample[]) {
  const window = songpaRouteElevation.gradeWindowM;
  const heightAt = (distance: number) => {
    const next = samples.findIndex(point => point.distance >= distance);
    if (next <= 0) return samples[next === 0 ? 0 : samples.length - 1].elevation;
    const a = samples[next - 1], b = samples[next];
    return a.elevation + (b.elevation - a.elevation) * (distance - a.distance) / (b.distance - a.distance);
  };
  for (const sample of samples) {
    if (length < window) break;
    const start = Math.max(0, Math.min(length - window, sample.distance - window / 2));
    sample.gradientDistance = window;
    sample.gradient = (heightAt(start + window) - heightAt(start)) / window * 100;
  }
  let steepest: RouteTerrainProfile['steepest'];
  for (const start of samples.flatMap(({ distance }) => [distance, distance - window])) {
    const end = start + window;
    if (start < 0 || end > length) continue;
    const gradient = (heightAt(end) - heightAt(start)) / window * 100;
    if (gradient <= (steepest?.gradient ?? 0)) continue;
    const index = samples.findIndex(point => point.distance >= start);
    steepest = { start, end, gradient, index };
  }
  return steepest;
}
