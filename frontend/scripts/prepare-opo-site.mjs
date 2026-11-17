import { writeFile } from 'node:fs/promises';

const bounds = '127.1638,37.3501,127.1661,37.3513';
const url = `https://www.openstreetmap.org/api/0.6/map.json?bbox=${bounds}`;
const response = await fetch(url, {
  headers: { 'User-Agent': 'FindMyShelter-OpoResearch/0.1 (site data preparation)' },
  signal: AbortSignal.timeout(20000),
});
if (!response.ok) throw new Error(`OpenStreetMap returned ${response.status}`);

const { elements } = await response.json();
// These ways form the mapped Suresil-gil approach, its bridge and the internal roads.
const roads = [836821229, 835658906, 835665646, 835665645, 835658907, 835658913, 835658914];
const boundaryId = 835658915;
const nodes = new Map(elements.filter(element => element.type === 'node').map(node => [node.id, [node.lon, node.lat]]));
const ways = new Map(elements.filter(element => element.type === 'way').map(way => [way.id, way]));

function feature(id, polygon = false) {
  const way = ways.get(id);
  if (!way) throw new Error(`OpenStreetMap way ${id} could not be found`);
  const coordinates = way.nodes.map(node => nodes.get(node));
  if (coordinates.some(point => !point)) throw new Error(`Incomplete geometry for way ${id}`);
  const geometry = polygon ? { type: 'Polygon', coordinates: [coordinates] } : { type: 'LineString', coordinates };
  return { type: 'Feature', geometry, properties: {
    id, version: way.version, name: way.tags?.name,
    kind: polygon ? 'boundary' : 'road', bridge: way.tags?.bridge === 'yes',
  } };
}

const snapshot = {
  type: 'FeatureCollection', features: [feature(boundaryId, true), ...roads.map(id => feature(id))],
  metadata: {
    source: url, license: 'https://www.openstreetmap.org/copyright', attribution: '© OpenStreetMap contributors',
    detail: 'OpenStreetMap residential land-use extent and road centre lines, not a cadastral survey.',
  },
};
await writeFile(new URL('../public/opo-site.geojson', import.meta.url), JSON.stringify(snapshot) + '\n');
