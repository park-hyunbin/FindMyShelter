import { readFile, writeFile } from 'node:fs/promises';
import { fromUrl } from 'geotiff';
import { PNG } from 'pngjs';
import proj4 from 'proj4';

const catalog = 'https://zenodo.org/records/15689805';
const directory = 'https://s3.opengeohub.org/global/edtm/';
const sources = Object.fromEntries(['m', 'std'].map(key => [key,
  `${directory}gedtm_rf_${key}_30m_s_20060101_20151231_go_epsg.4326.3855_v20250611.tif`,
]));
const root = new URL('../public/', import.meta.url);
const load = async file => JSON.parse(await readFile(new URL(file, root), 'utf8'));
const buildings = await load('sample-buildings.geojson');
const [easting, northing] = buildings.metadata.local_origin_xy;
const local = '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs';
const projection = proj4(local, 'WGS84');
const span = 1300;
const step = 25;
const size = span * 2 / step + 1;
const coordinates = [];
for (let z = -span; z <= span; z += step) for (let x = -span; x <= span; x += step) {
  coordinates.push(projection.forward([easting + x, northing - z]));
}

async function crop(url, divisor, limits) {
  const image = await (await fromUrl(url, { allowFullFile: false, blockSize: 16384, maxRanges: 0 })).getImage();
  const [west, north] = image.getOrigin();
  const [dx, dy] = image.getResolution();
  const nativePixels = coordinates.map(([lng, lat]) => [(lng - west) / dx - 0.5, (lat - north) / dy - 0.5]);
  const left = Math.floor(Math.min(...nativePixels.map(([x]) => x)));
  const top = Math.floor(Math.min(...nativePixels.map(([, y]) => y)));
  const right = Math.ceil(Math.max(...nativePixels.map(([x]) => x))) + 1;
  const bottom = Math.ceil(Math.max(...nativePixels.map(([, y]) => y))) + 1;
  const width = right - left;
  const raster = await image.readRasters({ window: [left, top, right, bottom], samples: [0], interleave: true });
  const nodata = image.getGDALNoData();
  const decode = (x, y) => {
    const raw = raster[(y - top) * width + x - left];
    const value = raw / divisor;
    if (raw === nodata || !Number.isFinite(value) || value < limits[0] || value > limits[1]) {
      throw new Error(`Missing or invalid source value at ${x}, ${y} in ${url}`);
    }
    return value;
  };
  return nativePixels.map(([x, y]) => {
    const i = Math.floor(x), j = Math.floor(y), a = x - i, b = y - j;
    const height = (decode(i, j) * (1 - a) + decode(i + 1, j) * a) * (1 - b)
      + (decode(i, j + 1) * (1 - a) + decode(i + 1, j + 1) * a) * b;
    return Number(height.toFixed(2));
  });
}

const [elevation, spread] = await Promise.all([crop(sources.m, 10, [-20, 700]), crop(sources.std, 100, [0, 100])]);

// Compare relative heights because the earlier VWorld crop has an unconfirmed vertical datum.
const legacy = await load('dem/manifest.json');
const tileSize = legacy.tile_size;
const zoom = legacy.maxzoom;
const tilePosition = ([lng, lat]) => {
  const tiles = 2 ** zoom;
  return [(lng + 180) / 360 * tiles, (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * tiles];
};
const legacyTiles = new Map();
async function oldPixel(column, row) {
  const x = Math.floor(column / tileSize), y = Math.floor(row / tileSize);
  const key = `${x}/${y}`;
  if (!legacyTiles.has(key)) {
    legacyTiles.set(key, readFile(new URL(`dem/${zoom}/${key}.png`, root)).then(file => PNG.sync.read(file)));
  }
  const { data } = await legacyTiles.get(key);
  const i = ((row % tileSize) * tileSize + column % tileSize) * 4;
  return (data[i] * 65536 + data[i + 1] * 256 + data[i + 2]) / 10 - 10000;
}
const oldElevations = await Promise.all(coordinates.map(async point => {
  const [x, y] = tilePosition(point).map(value => value * tileSize - 0.5);
  const i = Math.floor(x), j = Math.floor(y), a = x - i, b = y - j;
  const [nw, ne, sw, se] = await Promise.all([oldPixel(i, j), oldPixel(i + 1, j), oldPixel(i, j + 1), oldPixel(i + 1, j + 1)]);
  return (nw * (1 - a) + ne * a) * (1 - b) + (sw * (1 - a) + se * a) * b;
}));
const center = Math.floor(elevation.length / 2);
const differences = elevation.map((height, i) => Math.abs(height - elevation[center] - oldElevations[i] + oldElevations[center]));
const meanDifference = differences.reduce((total, value) => total + value, 0) / differences.length;
const output = {
  source: 'GEDTM30 v1.1 · Ho & Hengl', catalog, license: 'https://creativecommons.org/licenses/by/4.0/',
  sources, nativeResolutionM: 30, verticalDatum: 'EGM2008 (EPSG:3855)',
  originEPSG5186: [easting, northing], extentM: span, spacingM: step, size,
  sourceEpoch: '2006–2015', processing: 'Subset and bilinear interpolation onto an EPSG:5186 grid; no new native detail.',
  meanRelativeDifferenceFrom90M: Number(meanDifference.toFixed(1)),
  elevation, spread,
};
await writeFile(new URL('opo-terrain.json', root), JSON.stringify(output) + '\n');
console.log(JSON.stringify({ samples: elevation.length, min: Math.min(...elevation), max: Math.max(...elevation),
  centerHeight: elevation[center], centerSpread: spread[center], meanRelativeDifferenceFrom90M: output.meanRelativeDifferenceFrom90M }));
