import { writeFile } from 'node:fs/promises';
import { fromUrl } from 'geotiff';
import { PNG } from 'pngjs';
import proj4 from 'proj4';

const itemId = 'S2B_52SCG_20251222_0_L2A';
const source = `https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/${itemId}`;
const response = await fetch(source, { signal: AbortSignal.timeout(20_000) });
if (!response.ok) throw new Error(`Earth Search returned ${response.status}`);
const item = await response.json();
if (item.id !== itemId || item.properties['proj:epsg'] !== 32652) throw new Error('Unexpected Sentinel-2 item or CRS');

const raster = item.assets.visual.href;
const tci = await (await fromUrl(raster, { allowFullFile: false })).getImage();
const scl = await (await fromUrl(item.assets.scl.href, { allowFullFile: false })).getImage();
const [east, north] = tci.getOrigin();
const [cellX, cellY] = tci.getResolution();
const [maskEast, maskNorth] = scl.getOrigin();
const [maskX, maskY] = scl.getResolution();
if (cellX !== 10 || cellY !== -10 || maskX !== 20 || maskY !== -20 || maskEast !== east || maskNorth !== north) {
  throw new Error('Expected aligned 10m RGB and 20m classification grids');
}

// Crop in native UTM square metres, without resampling the RGB pixels.
const bounds = [333410, 4151680, 333610, 4151870];
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
const width = right - left;
const height = bottom - top;
const png = new PNG({ width, height });
for (let index = 0; index < width * height; index++) {
  png.data.set(rgb.subarray(index * 3, index * 3 + 3), index * 4);
  png.data[index * 4 + 3] = 255;
}

const toUtm = proj4('WGS84', '+proj=utm +zone=52 +datum=WGS84 +units=m +no_defs');
// Chosen by inspecting the winter TCI and cross-checking for building footprints and ground in aerial reference.
const points = [
  { id: 'winter-capture-a', label: '101동 남서쪽 실외', pixel: [7, 6], appearance: '영상에서 어두운 구역' },
  { id: 'winter-capture-b', label: '단지 중앙 포장로', pixel: [10, 13], appearance: '영상에서 상대적으로 밝은 구역' },
].map(point => {
  const [x, y] = point.pixel;
  const maskColumn = Math.floor((left + x) / 2) - maskLeft;
  const maskRow = Math.floor((top + y) / 2) - maskTop;
  const sceneClass = classification[maskRow * (maskRight - maskLeft) + maskColumn];
  if (sceneClass !== 5) throw new Error(`Expected bare land classification for ${point.id}; found ${sceneClass}`);
  return {
    ...point, sceneClass,
    coordinate: toUtm.inverse([bounds[0] + (x + 0.5) * cellX, bounds[3] + (y + 0.5) * cellY]),
  };
});
const root = new URL('../public/datasets/regions/songpa/', import.meta.url);
const result = { acquiredAt: item.properties.datetime, resolutionM: cellX, projection: 'EPSG:32652',
  bounds, width, height, source, raster, sceneMask: item.assets.scl.href,
  attribution: 'Contains modified Copernicus Sentinel data 2025', points };
await Promise.all([
  writeFile(new URL('winter-capture.png', root), PNG.sync.write(png)),
  writeFile(new URL('winter-capture.json', root), JSON.stringify(result, null, 2) + '\n'),
]);
console.log(`Wrote ${width}×${height} native RGB pixels and two sample coordinates for ${itemId}`);
