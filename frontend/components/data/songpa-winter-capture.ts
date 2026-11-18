import proj4 from 'proj4';
import evidence from '../../public/datasets/regions/songpa/winter-capture.json';
import type { LightSample } from '../opo-sunlight';

const kst = new Date(Date.parse(evidence.acquiredAt) + 9 * 3_600_000).toISOString();
const date = kst.slice(0, 10);
const exactMinute = (Date.parse(kst) - Date.parse(`${date}T00:00:00Z`)) / 60_000;

export const songpaWinterCapture = {
  ...evidence,
  date,
  clock: kst.slice(11, 19),
  exactMinute,
  image: '/datasets/regions/songpa/winter-capture.png',
};

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
