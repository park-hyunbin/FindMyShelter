import { readFile, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { fromUrl } from 'geotiff';
import { PNG } from 'pngjs';
import proj4 from 'proj4';

const sources = [
  ['S2B_52SCG_20251222_0_L2A', 'winter-capture.png'],
  ['S2C_52SCG_20260106_0_L2A', 'winter-capture-2026-01-06.png'],
  ['S2B_52SCG_20260220_0_L2A', 'winter-capture-2026-02-20.png'],
];
const { values: { check } } = parseArgs({ options: { check: { type: 'boolean' } } });
const root = new URL('../public/datasets/regions/songpa/', import.meta.url);
const projection = 'EPSG:32652';
const resolutionM = 10;
// Hold the same native crop and outdoor sample cells fixed across acquisition dates.
const bounds = [333410, 4151680, 333610, 4151870];
const width = (bounds[2] - bounds[0]) / resolutionM;
const height = (bounds[3] - bounds[1]) / resolutionM;
const toUtm = proj4('WGS84', '+proj=utm +zone=52 +datum=WGS84 +units=m +no_defs');
const points = [
  { id: 'winter-capture-a', label: '101동 남서쪽 실외', pixel: [7, 6] },
  { id: 'winter-capture-b', label: '단지 중앙 포장로', pixel: [10, 13] },
].map(point => {
  const [x, y] = point.pixel;
  return { ...point, coordinate: toUtm.inverse([
    bounds[0] + (x + 0.5) * resolutionM, bounds[3] - (y + 0.5) * resolutionM,
  ]) };
});

async function readCapture([itemId, image]) {
  const source = `https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/${itemId}`;
  const response = await fetch(source, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Earth Search returned ${response.status}`);
  const item = await response.json();
  if (item.id !== itemId || item.properties['proj:epsg'] !== 32652) throw new Error('Unexpected Sentinel-2 item or CRS');

  const raster = item.assets.visual.href;
  const sceneMask = item.assets.scl.href;
  const [tci, scl] = await Promise.all([raster, sceneMask].map(async url => {
    const file = await fromUrl(url, { allowFullFile: false, blockSize: 65_536, maxRanges: 0 });
    return file.getImage();
  }));
  const [east, north] = tci.getOrigin();
  const [cellX, cellY] = tci.getResolution();
  const [maskEast, maskNorth] = scl.getOrigin();
  const [maskX, maskY] = scl.getResolution();
  if (cellX !== resolutionM || cellY !== -resolutionM || maskX !== 20 || maskY !== -20 || maskEast !== east || maskNorth !== north) {
    throw new Error('Expected aligned 10m RGB and 20m classification grids');
  }

  const [left, top, right, bottom] = [(bounds[0] - east) / cellX, (bounds[3] - north) / cellY,
    (bounds[2] - east) / cellX, (bounds[1] - north) / cellY];
  if (![left, top, right, bottom].every(Number.isInteger) || left < 0 || top < 0
      || right > tci.getWidth() || bottom > tci.getHeight()) throw new Error('Invalid native crop');
  const [maskLeft, maskTop, maskRight, maskBottom] = [Math.floor(left / 2), Math.floor(top / 2),
    Math.ceil(right / 2), Math.ceil(bottom / 2)];
  const [rgb, classification] = await Promise.all([
    tci.readRGB({ window: [left, top, right, bottom], interleave: true }),
    scl.readRasters({ window: [maskLeft, maskTop, maskRight, maskBottom], interleave: true }),
  ]);
  const png = new PNG({ width, height });
  for (let index = 0; index < width * height; index++) {
    png.data.set(rgb.subarray(index * 3, index * 3 + 3), index * 4);
    png.data[index * 4 + 3] = 255;
  }

  const observations = Object.fromEntries(points.map(({ id, pixel: [x, y] }) => {
    const maskColumn = Math.floor((left + x) / 2) - maskLeft;
    const maskRow = Math.floor((top + y) / 2) - maskTop;
    const sceneClass = classification[maskRow * (maskRight - maskLeft) + maskColumn];
    if (sceneClass !== 5) throw new Error(`Expected the non-vegetated class at ${id} for ${itemId}; found ${sceneClass}`);
    const index = (y * width + x) * 3;
    return [id, { sceneClass, rgb: Array.from(rgb.subarray(index, index + 3)) }];
  }));
  const acquiredAt = item.properties.datetime;
  return { capture: { acquiredAt, source, raster, sceneMask, image,
    attribution: `Contains modified Copernicus Sentinel data ${acquiredAt.slice(0, 4)}`, observations }, png: PNG.sync.write(png) };
}

const prepared = await Promise.all(sources.map(readCapture));
const result = { resolutionM, projection, bounds, width, height, points, captures: prepared.map(item => item.capture) };
const manifest = new URL('winter-capture.json', root);
if (check) {
  const current = JSON.parse(await readFile(manifest, 'utf8'));
  if (!isDeepStrictEqual(current, result)) throw new Error('Winter capture metadata or sample colors differ from the source.');
  await Promise.all(prepared.map(async ({ capture, png }) => {
    const path = new URL(capture.image, root);
    const actual = PNG.sync.read(await readFile(path));
    const expected = PNG.sync.read(png);
    if (actual.width !== expected.width || actual.height !== expected.height || !actual.data.equals(expected.data)) {
      throw new Error(`Winter capture pixels differ from the source: ${capture.image}`);
    }
  }));
} else {
  await Promise.all(prepared.map(({ capture, png }) => writeFile(new URL(capture.image, root), png)));
  await writeFile(manifest, JSON.stringify(result, null, 2) + '\n');
}
console.log(`${check ? 'Verified' : 'Wrote'} ${width}×${height} native RGB crops for ${prepared.length} dates with the same sample coordinates.`);
