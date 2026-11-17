import { writeFile } from 'node:fs/promises';

const bounds = [127.1555, 37.3440, 127.1730, 37.3576];
const source = `https://www.openstreetmap.org/api/0.6/map.json?bbox=${bounds.join(',')}`;
const response = await fetch(source, {
  headers: { 'User-Agent': 'FindMyShelter-OpoResearch/0.1 (building coverage preparation)' },
  signal: AbortSignal.timeout(25000),
});
if (!response.ok) throw new Error(`OpenStreetMap returned ${response.status}`);

const { elements } = await response.json();
const nodes = new Map(elements.filter(element => element.type === 'node').map(node => [node.id, [node.lon, node.lat]]));
const features = [];
for (const way of elements) {
  if (way.type !== 'way' || !way.tags?.building || ['no', 'roof', 'construction'].includes(way.tags.building)) continue;
  if (way.nodes.length < 4 || way.nodes[0] !== way.nodes[way.nodes.length - 1]) continue;
  const coordinates = way.nodes.map(node => nodes.get(node));
  if (coordinates.some(point => !point)) continue;
  const explicitMeters = /^(\d+(?:\.\d+)?)\s*(?:m)?$/i.exec(way.tags.height ?? '');
  const height = explicitMeters && Number(explicitMeters[1]) > 0 ? Number(explicitMeters[1]) : null;
  features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coordinates] },
    properties: { id: `osm-${way.id}`, name: way.tags.name ?? null, height_m: height, dong: null } });
}
if (!features.length) throw new Error('No valid closed building ways in the response');

await writeFile(new URL('../public/opo-osm-buildings.geojson', import.meta.url), JSON.stringify({
  type: 'FeatureCollection', features,
  metadata: { bounds, source, attribution: '© OpenStreetMap contributors', license: 'https://www.openstreetmap.org/copyright' },
}) + '\n');
console.log(`Saved ${features.length} mapped building outlines, ${features.filter(feature => feature.properties.height_m).length} with height in metres.`);
