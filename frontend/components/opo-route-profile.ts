import type { OpoData, Point } from './opo-data';
import { songpaRouteElevation, type SurveyedRoute } from './data/songpa-route-elevation';

export const routeTerrainStep = 50;
export type RouteTerrainSample = {
  distance: number; position: Point; elevation: number; spread?: number; bearing: number;
  nearestInputM?: number; contourM?: number;
  gradient: number | null; gradientDistance: number;
};
type RouteEdge = { a: Point; b: Point; start: number; end: number; distance: number };
type SlopeRange = { start: number; end: number; gradient: number; index: number };
export type RouteSlopeDirection = 'outbound' | 'returning';
type RouteSlope = SlopeRange & {
  lines: Point[][];
  view: Pick<RouteTerrainSample, 'position' | 'bearing'>;
};
export type RouteTerrainProfile = {
  length: number;
  samples: RouteTerrainSample[];
  survey?: SurveyedRoute;
  steepest?: RouteSlope;
  returnSteepest?: RouteSlope;
};

export function routeAscent(profile: RouteTerrainProfile) {
  let outbound = 0, returning = 0;
  for (const [index, point] of profile.samples.slice(1).entries()) {
    const difference = point.elevation - profile.samples[index].elevation;
    outbound += Math.max(0, difference);
    returning += Math.max(0, -difference);
  }
  return { outbound, returning };
}

export function routeTerrainProfile(
  data: Pick<OpoData, 'elevationAt' | 'spreadAt' | 'northOffset'>,
  lines: Point[][],
  survey?: SurveyedRoute,
): RouteTerrainProfile {
  let length = 0;
  const edges: RouteEdge[] = lines.flatMap(line => line.slice(1).flatMap((b, index) => {
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
    const position = onEdge(edge, distance);
    const bearing = routeBearing(edge.a, edge.b, data.northOffset);
    const reference = survey?.samples[index];
    samples.push({
      distance, position, bearing, gradient: null, gradientDistance: 0,
      ...(reference ? { elevation: reference.elevationM, nearestInputM: reference.nearestInputM, contourM: reference.contourM }
        : { elevation: data.elevationAt(position.x, position.z), spread: data.spreadAt(position.x, position.z) }),
    });
  }
  if (survey) {
    const { steepest, returnSteepest } = summarizeSurveyedSlope(length, samples);
    return { length, samples, survey,
      steepest: steepest && locateSlope(edges, steepest, data.northOffset, false),
      returnSteepest: returnSteepest && locateSlope(edges, returnSteepest, data.northOffset, true) };
  }
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

function onEdge(edge: RouteEdge, distance: number) {
  if (distance <= edge.start) return edge.a;
  if (distance >= edge.end) return edge.b;
  const t = (distance - edge.start) / edge.distance;
  return { x: edge.a.x + (edge.b.x - edge.a.x) * t, z: edge.a.z + (edge.b.z - edge.a.z) * t };
}

function routeBearing(from: Point, to: Point, northOffset: number) {
  return (Math.atan2(to.x - from.x, from.z - to.z) - northOffset) * 180 / Math.PI;
}

function locateSlope(edges: RouteEdge[], range: SlopeRange, northOffset: number, returning: boolean): RouteSlope {
  const lines: Point[][] = [];
  for (const edge of edges) {
    const from = Math.max(edge.start, range.start), to = Math.min(edge.end, range.end);
    if (to <= from) continue;
    const start = onEdge(edge, from), end = onEdge(edge, to);
    const run = lines.at(-1);
    const previous = run?.at(-1);
    if (previous?.x === start.x && previous.z === start.z) run.push(end);
    else lines.push([start, end]);
  }
  if (returning) {
    lines.reverse();
    lines.forEach(line => line.reverse());
  }
  const [position, ahead] = lines[0];
  return { ...range, lines, view: { position, bearing: routeBearing(position, ahead, northOffset) } };
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
  let steepest: SlopeRange | undefined;
  let returnSteepest: SlopeRange | undefined;
  for (const start of samples.flatMap(({ distance }) => [distance, distance - window])) {
    const end = start + window;
    if (start < 0 || end > length) continue;
    const gradient = (heightAt(end) - heightAt(start)) / window * 100;
    if (gradient > (steepest?.gradient ?? 0)) {
      const index = samples.findIndex(point => point.distance >= start);
      steepest = { start, end, gradient, index };
    }
    if (-gradient > (returnSteepest?.gradient ?? 0)) {
      const index = samples.findLastIndex(point => point.distance <= end);
      returnSteepest = { start, end, gradient: -gradient, index };
    }
  }
  return { steepest, returnSteepest };
}
