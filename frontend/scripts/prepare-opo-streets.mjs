import { readFile, writeFile } from 'node:fs/promises';

const [firstArg, snapshotArg] = process.argv.slice(2);
const songpa = firstArg === '--songpa';
const bounds = songpa ? [127.1024, 37.4862, 127.1313, 37.5094] : [127.1497, 37.3392, 127.1788, 37.3624];
const source = `https://www.openstreetmap.org/api/0.6/map.json?bbox=${bounds.join(',')}`;
const suppliedSnapshot = songpa ? snapshotArg : firstArg;
const raw = suppliedSnapshot ? JSON.parse(await readFile(suppliedSnapshot, 'utf8')) : await download();

async function download() {
  const response = await fetch(source, {
    headers: { 'User-Agent': 'FindMyShelter/1.0 (neighborhood street geometry)' },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`OpenStreetMap returned ${response.status}`);
  return response.json();
}

const motorClasses = new Set(['trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary',
  'tertiary_link', 'unclassified', 'residential', 'living_street', 'service', 'track']);
if (songpa) for (const category of ['motorway', 'motorway_link']) motorClasses.add(category);
const walkingClasses = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway']);
const nodes = new Map(raw.elements.filter(element => element.type === 'node').map(element => [element.id, element]));
const roads = [], points = [], parking = [], buildings = [];
const lineCoordinates = way => way.nodes.map(id => {
  const node = nodes.get(id);
  return node && [node.lon, node.lat];
});
const numericTag = tag => {
  const value = /^\s*(\d+(?:\.\d+)?)\s*(?:m)?\s*$/i.exec(tag ?? '');
  return value && Number(value[1]) > 0 ? Number(value[1]) : null;
};

function kindOf(tags) {
  if (tags.highway === 'bus_stop') return 'bus';
  if (tags.highway === 'crossing' && tags.crossing !== 'unmarked' && tags['crossing:markings'] !== 'no'
    && (!songpa || tags['crossing:markings'] || ['marked', 'traffic_signals'].includes(tags.crossing))) return 'crossing';
  if (tags.highway === 'street_lamp') return 'lamp';
  if (tags.highway === 'traffic_signals') return 'signal';
  if (tags.natural === 'tree') return 'tree';
  if (tags.amenity === 'bench') return 'bench';
  if (!tags.name) return null;
  if (tags.shop || tags.amenity || tags.leisure || tags.tourism) return 'place';
  return null;
}

for (const item of raw.elements) {
  const tags = item.tags;
  if (!tags) continue;
  const kind = kindOf(tags);
  if (item.type === 'node') {
    if (kind && (!songpa || kind !== 'place')) points.push({ id: `n${item.id}`, kind, name: tags.name ?? null, coordinates: [item.lon, item.lat] });
    continue;
  }
  if (item.type !== 'way' || !item.nodes || item.nodes.length < 2) continue;
  const coordinates = lineCoordinates(item);
  if (coordinates.some(point => !point)) continue;
  const closed = coordinates.length >= 4 && item.nodes[0] === item.nodes.at(-1);
  if (closed && tags.building && !['no', 'roof', 'construction', 'demolished'].includes(tags.building)) {
    buildings.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coordinates] },
      properties: { id: `osm-${item.id}`, name: tags.name ?? null, dong: null,
        height_m: numericTag(tags.height), levels: numericTag(tags['building:levels']), building: tags.building,
        roof: tags['roof:shape'] ?? null } });
  }
  if (closed && tags.amenity === 'parking' && !['underground', 'multi-storey'].includes(tags.parking)) {
    parking.push({ id: item.id, coordinates });
  }
  if (!songpa && closed && kind === 'place') {
    const ring = coordinates.slice(0, -1);
    const center = ring.reduce((sum, point) => [sum[0] + point[0] / ring.length, sum[1] + point[1] / ring.length], [0, 0]);
    points.push({ id: `w${item.id}`, kind, name: tags.name, coordinates: center });
  }
  if (tags.area === 'yes' || (tags.tunnel && tags.tunnel !== 'no') || tags.location === 'underground') continue;
  const category = tags.highway;
  const motor = motorClasses.has(category);
  if (!motor && !walkingClasses.has(category)) continue;
  const sidewalk = (side) => {
    const specific = tags[`sidewalk:${side}`] ?? tags['sidewalk:both'];
    if (specific) return specific === 'yes';
    return ['both', side].includes(tags.sidewalk) || (songpa && tags.sidewalk === 'yes');
  };
  const access = tags.motor_vehicle ?? tags.motorcar ?? tags.vehicle ?? tags.access;
  const forward = songpa ? numericTag(tags['lanes:forward']) : null;
  const backward = songpa ? numericTag(tags['lanes:backward']) : null;
  roads.push({
    id: item.id, category, coordinates, nodeIds: item.nodes, name: tags.name ?? null,
    motor: motor && !['no', 'private', 'agricultural', 'forestry'].includes(access),
    width: numericTag(tags.width), lanes: numericTag(tags.lanes) ?? (forward && backward ? forward + backward : null), surface: tags.surface ?? null,
    ...(forward ? { forwardLanes: forward } : {}), ...(backward ? { backwardLanes: backward } : {}),
    bridge: Boolean(tags.bridge && tags.bridge !== 'no'), unpaved: ['unpaved','dirt','gravel','ground','fine_gravel','sand'].includes(tags.surface),
    sidewalks: [sidewalk('left'), sidewalk('right')], markings: tags.lane_markings !== 'no',
    oneWay: tags.oneway === '-1' ? -1 : tags.oneway === 'yes' || tags.junction === 'roundabout'
      || (songpa && category === 'motorway' && tags.oneway !== 'no') ? 1 : 0,
  });
}

const metadata = { bounds, source, attribution: '© OpenStreetMap contributors', license: 'https://www.openstreetmap.org/copyright' };
const coreWays = songpa ? [169916276, 169916279, 1175929595] : [836821229, 835658906, 835665646, 835665645, 835658907, 835658913, 835658914];
if ((!songpa && buildings.length < 500) || roads.length < 100 || !coreWays.every(id => roads.some(road => road.id === id))) {
  throw new Error('The snapshot is missing neighborhood roads or the mapped complex approach.');
}
const streetFile = songpa ? '../public/datasets/regions/songpa/streets.json' : '../public/opo-streets.json';
await writeFile(new URL(streetFile, import.meta.url), JSON.stringify({ metadata, roads, points, parking }) + '\n');
if (!songpa) await writeFile(new URL('../public/opo-osm-buildings.geojson', import.meta.url),
  JSON.stringify({ type: 'FeatureCollection', features: buildings, metadata }) + '\n');
console.log(`${roads.length} road/path ways, ${points.length} mapped points, ${parking.length} parking polygons, ${buildings.length} building outlines.`);
