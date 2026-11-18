import { readFile, writeFile } from 'node:fs/promises';
import { fromUrl } from 'geotiff';
import proj4 from 'proj4';

const root = new URL('../public/', import.meta.url);
const { originEPSG5186 } = JSON.parse(await readFile(new URL('opo-terrain.json', root), 'utf8'));
const [east, north] = originEPSG5186;
const extentM = 1250;
const cellM = 10;
const size = 2 * extentM / cellM;
const year = 2025;
const treeClass = 2;
const source = `https://lulctimeseries.blob.core.windows.net/lulctimeseriesv003/lc${year}/52S_${year}0101-${year}1231.tif`;
const image = await (await fromUrl(source, { allowFullFile: false, blockSize: 65536 })).getImage();
const [sourceEast, sourceNorth] = image.getOrigin();
const [dx, dy] = image.getResolution();
if (image.getGeoKeys().ProjectedCSTypeGeoKey !== 32652 || dx !== cellM || dy !== -cellM) {
  throw new Error('Unexpected source grid for the UTM zone 52 north tile');
}

const epsg5186 = '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs';
const toSource = proj4(epsg5186, 'EPSG:32652');
const pixels = [];
let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
// Sample categorical data at each destination cell center using nearest-neighbor resampling.
for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
  const [x, y] = toSource.forward([east - extentM + (column + 0.5) * cellM, north + extentM - (row + 0.5) * cellM]);
  const i = Math.floor((x - sourceEast) / dx), j = Math.floor((y - sourceNorth) / dy);
  left = Math.min(left, i);
  top = Math.min(top, j);
  right = Math.max(right, i + 1);
  bottom = Math.max(bottom, j + 1);
  pixels.push([i, j]);
}
if (left < 0 || top < 0 || right > image.getWidth() || bottom > image.getHeight()) {
  throw new Error('Tour area falls outside the source tile');
}
const cells = await image.readRasters({ window: [left, top, right, bottom], samples: [0], interleave: true });
const knownClasses = new Set([1, 2, 4, 5, 7, 8, 9, 10, 11]);
const mask = Buffer.alloc(Math.ceil(pixels.length / 8));
let treeCells = 0;
for (const [index, [i, j]] of pixels.entries()) {
  const cover = cells[(j - top) * (right - left) + i - left];
  if (!knownClasses.has(cover)) throw new Error(`Unexpected land cover class ${cover} at index ${index}`);
  if (cover !== treeClass) continue;
  mask[index >> 3] |= 1 << (index % 8);
  treeCells++;
}
if (!treeCells) throw new Error('Land cover crop has no tree cells');

const result = {
  source: 'Esri, Impact Observatory, Microsoft',
  catalog: 'https://www.arcgis.com/home/item.html?id=cfcb7609de5f478eb7666240902d4d3d',
  data: source,
  license: 'https://creativecommons.org/licenses/by/4.0/',
  year, originEPSG5186, extentM, cellM, size, treeClass, treeCells,
  encoding: 'Rows run north to south, columns west to east. Base64 bitset, least significant bit first.',
  mask: mask.toString('base64'),
};
await writeFile(new URL('opo-tree-cover.json', root), JSON.stringify(result, null, 2) + '\n');
console.log(`${treeCells} tree-cover cells of ${pixels.length} in the ${size} by ${size} grid`);
