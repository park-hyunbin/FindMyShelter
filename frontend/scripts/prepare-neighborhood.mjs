import { readFile, writeFile } from 'node:fs/promises';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

const buildings = JSON.parse(await readFile(new URL('../public/sample-buildings.geojson', import.meta.url), 'utf8'));
const [lng, lat] = buildings.metadata.center_lnglat;
const bounds = [lng - 0.018, lat - 0.015, lng + 0.018, lat + 0.015];
const headers = { 'User-Agent': 'FindMyShelter-OpoResearch/0.1 (neighborhood data preparation)' };

async function download(url) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  return response;
}

const tileInfo = await (await download('https://tiles.openfreemap.org/planet')).json();
const zoom = tileInfo.maxzoom;
const count = 2 ** zoom;
const xAt = longitude => Math.floor((longitude + 180) / 360 * count);
const yAt = latitude => Math.floor((1 - Math.asinh(Math.tan(latitude * Math.PI / 180)) / Math.PI) / 2 * count);
const coordinates = [];
for (let x = xAt(bounds[0]); x <= xAt(bounds[2]); x++) {
  for (let y = yAt(bounds[3]); y <= yAt(bounds[1]); y++) coordinates.push([x, y]);
}

function intersects(geometry) {
  let west = Infinity, east = -Infinity, north = -Infinity, south = Infinity;
  function visit(value) {
    if (typeof value[0] === 'number') {
      west = Math.min(west, value[0]); east = Math.max(east, value[0]);
      south = Math.min(south, value[1]); north = Math.max(north, value[1]);
    } else value.forEach(visit);
  }
  visit(geometry.coordinates);
  return west <= bounds[2] && east >= bounds[0] && south <= bounds[3] && north >= bounds[1];
}

const layerKinds = {
  transportation: { kind: 'road', classes: ['trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'track', 'path'] },
  landcover: { kind: 'green', classes: ['wood', 'grass', 'farmland'] },
  landuse: { kind: 'facility', classes: ['playground', 'pitch'] },
  water: { kind: 'water' },
  waterway: { kind: 'stream', classes: ['river', 'stream', 'canal'] },
};

const features = [];
for (const [x, y] of coordinates) {
  const url = tileInfo.tiles[0].replace('{z}', zoom).replace('{x}', x).replace('{y}', y);
  const buffer = await (await download(url)).arrayBuffer();
  const tile = new VectorTile(new PbfReader(new Uint8Array(buffer)));
  for (const [layerName, { kind, classes }] of Object.entries(layerKinds)) {
    const layer = tile.layers[layerName];
    if (!layer) continue;
    for (let i = 0; i < layer.length; i++) {
      const item = layer.feature(i);
      const { class: category, subclass, name, brunnel } = item.properties;
      if (classes && !classes.includes(category)) continue;
      const { geometry } = item.toGeoJSON(x, y, zoom);
      if (intersects(geometry)) features.push({
        type: 'Feature', geometry,
        properties: { kind, category, subclass, name, brunnel },
      });
    }
  }
}
if (!['road', 'green', 'stream'].every(kind => features.some(feature => feature.properties.kind === kind))) {
  throw new Error('Required road, green space or waterway data missing from tiles');
}

const snapshot = {
  type: 'FeatureCollection', features,
  metadata: {
    attribution: '© OpenStreetMap contributors · OpenFreeMap / OpenMapTiles',
    license: 'https://www.openstreetmap.org/copyright',
    tile_source: tileInfo.tiles[0], bounds,
    detail: 'Zoom 14 vector tile geometries, generalized and clipped at tile edges.',
  },
};
await writeFile(new URL('../public/opo-environment.geojson', import.meta.url), JSON.stringify(snapshot) + '\n');
console.log(`${features.length} features from ${coordinates.length} tiles`);
