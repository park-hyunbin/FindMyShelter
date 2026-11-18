import type { OpoData, Point } from './opo-data';

export const routeTerrainStep = 50;
export type RouteTerrainSample = {
  distance: number; position: Point; elevation: number; spread: number; bearing: number;
  gradient: number | null; gradientDistance: number;
};
export type RouteTerrainProfile = { length: number; samples: RouteTerrainSample[] };

export function routeTerrainProfile(
  data: Pick<OpoData, 'elevationAt' | 'spreadAt' | 'northOffset'>,
  lines: Point[][],
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
  for (let index = 0; index <= Math.ceil(length / routeTerrainStep); index++) {
    const distance = Math.min(index * routeTerrainStep, length);
    while (edgeIndex < edges.length - 1 && distance > edges[edgeIndex].end) edgeIndex++;
    const edge = edges[edgeIndex];
    const fraction = (distance - edge.start) / edge.distance;
    const position = {
      x: edge.a.x + (edge.b.x - edge.a.x) * fraction,
      z: edge.a.z + (edge.b.z - edge.a.z) * fraction,
    };
    const bearing = Math.atan2(edge.b.x - edge.a.x, edge.a.z - edge.b.z) * 180 / Math.PI
      - data.northOffset * 180 / Math.PI;
    samples.push({ distance, position, bearing,
      elevation: data.elevationAt(position.x, position.z), spread: data.spreadAt(position.x, position.z),
      gradient: null, gradientDistance: 0 });
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
