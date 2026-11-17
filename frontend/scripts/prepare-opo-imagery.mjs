import { readFile, writeFile } from 'node:fs/promises';
import { fromUrl } from 'geotiff';
import { PNG } from 'pngjs';
import proj4 from 'proj4';

const item = 'S2B_52SCG_20261008_0_L2A';
const raster = `https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/52/S/CG/2026/10/${item}/TCI.tif`;
const buildings = JSON.parse(await readFile(new URL('../public/sample-buildings.geojson', import.meta.url), 'utf8'));
const [easting, northing] = buildings.metadata.local_origin_xy;
const extent = 1250;
const resolution = 10;
const dimension = extent * 2 / resolution;
const epsg5186 = '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs';
const utm52 = '+proj=utm +zone=52 +datum=WGS84 +units=m +no_defs';
const projection = proj4(epsg5186, utm52);

const tiff = await fromUrl(raster, { allowFullFile: false });
const image = await tiff.getImage();
const [originX, originY] = image.getOrigin();
const [stepX, stepY] = image.getResolution();
function pixel(x, y) {
  const [east, north] = projection.forward([easting + x, northing - y]);
  return [Math.floor((east - originX) / stepX), Math.floor((north - originY) / stepY)];
}

const corners = [-extent, extent].flatMap(x => [-extent, extent].map(y => pixel(x, y)));
const left = Math.min(...corners.map(([x]) => x)) - 1;
const top = Math.min(...corners.map(([, y]) => y)) - 1;
const right = Math.max(...corners.map(([x]) => x)) + 2;
const bottom = Math.max(...corners.map(([, y]) => y)) + 2;
if (left < 0 || top < 0 || right > image.getWidth() || bottom > image.getHeight()) throw new Error('Image does not cover the neighborhood');
const rgb = await image.readRGB({ window: [left, top, right, bottom], interleave: true });
const output = new PNG({ width: dimension, height: dimension });
for (let y = 0; y < dimension; y++) for (let x = 0; x < dimension; x++) {
  const [column, row] = pixel(-extent + (x + 0.5) * resolution, -extent + (y + 0.5) * resolution);
  const from = ((row - top) * (right - left) + (column - left)) * 3;
  const to = (y * dimension + x) * 4;
  output.data.set(rgb.subarray(from, from + 3), to);
  output.data[to + 3] = 255;
}
await writeFile(new URL('../public/opo-sentinel.png', import.meta.url), PNG.sync.write(output));
await writeFile(new URL('../public/opo-sentinel.json', import.meta.url), JSON.stringify({
  item, acquired: '2026-10-08', acquired_at: '2026-10-08T02:27:12.132000Z',
  source_item: `https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/${item}`,
  source_raster: raster, resolution_m: resolution, projection: 'EPSG:5186',
  bounds: [easting - extent, northing - extent, easting + extent, northing + extent],
  attribution: 'Contains modified Copernicus Sentinel data 2026',
}, null, 2) + '\n');
console.log(`Wrote a ${dimension}×${dimension} imagery crop for ${item}`);
