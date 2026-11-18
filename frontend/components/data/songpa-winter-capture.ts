import proj4 from 'proj4';
import evidence from '../../public/datasets/regions/songpa/winter-capture.json';
import type { LightSample } from '../opo-sunlight';

export const winterCapturePoints = evidence.points;
export const songpaWinterCaptures = evidence.captures.map(capture => {
  const kst = new Date(Date.parse(capture.acquiredAt) + 9 * 3_600_000).toISOString();
  const date = kst.slice(0, 10);
  const observations: Record<string, { rgb: number[] }> = capture.observations;
  return {
    ...capture,
    date,
    clock: kst.slice(11, 19),
    exactMinute: (Date.parse(kst) - Date.parse(`${date}T00:00:00Z`)) / 60_000,
    image: `/datasets/regions/songpa/${capture.image}`,
    width: evidence.width,
    height: evidence.height,
    resolutionM: evidence.resolutionM,
    points: winterCapturePoints.map(point => {
      const [r, g, b] = observations[point.id].rgb;
      return { ...point, displayBrightness: Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b) };
    }),
  };
});
export type SongpaWinterCapture = (typeof songpaWinterCaptures)[number];

const gridSize = 5;
export const winterPixelSampleCount = gridSize ** 2;
const wgs84 = proj4(evidence.projection, 'WGS84');

export function sampleWinterPixel(
  [column, row]: number[],
  classify: (coordinate: number[]) => LightSample | undefined,
) {
  const counts = { sun: 0, shade: 0, unknown: 0, night: 0, excluded: 0 };
  const unknownCauses = new Set<string>();
  const [west, , , north] = evidence.bounds;
  for (let y = 0; y < gridSize; y++) for (let x = 0; x < gridSize; x++) {
    const east = west + (column + (x + 0.5) / gridSize) * evidence.resolutionM;
    const northing = north - (row + (y + 0.5) / gridSize) * evidence.resolutionM;
    const sample = classify(wgs84.forward([east, northing]));
    counts[sample?.status ?? 'excluded']++;
    if (sample?.status === 'unknown' && sample.cause) unknownCauses.add(sample.cause);
  }
  return { counts, unknownCauses: [...unknownCauses] };
}
