import { writeFile } from 'node:fs/promises';
import proj4 from 'proj4';

const bounds = [127.1510, 37.3390, 127.1820, 37.3615];
const source = `https://www.openstreetmap.org/api/0.6/map.json?bbox=${bounds.join(',')}`;
const response = await fetch(source, {
  headers: { 'User-Agent': 'FindMyShelter-OpoResearch/0.1 (mapped access preparation)' },
  signal: AbortSignal.timeout(25000),
});
if (!response.ok) throw new Error(`OpenStreetMap returned ${response.status}`);

const { elements } = await response.json();
const nodes = new Map(elements.filter(element => element.type === 'node').map(node => [node.id, [node.lon, node.lat]]));
const ways = new Map(elements.filter(element => element.type === 'way').map(way => [way.id, way]));
const mainland = '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs';
const projection = proj4('WGS84', mainland);
const projected = new Map([...nodes].map(([id, point]) => [id, projection.forward(point)]));
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const start = ways.get(835658906)?.nodes.find(id => ways.get(836821229)?.nodes.includes(id));
if (!start) throw new Error('Apartment access does not share a node with Suresil-gil');

const destinations = [
  {
    id: 'ssamji', name: '능평3통 쌈지공원', node: 4599596807, endLabel: '공원 인근 교량 남단',
    reference: [127.1721509, 37.3488409],
    referenceSource: 'https://platformdodam.com/children-play-facilities/10830',
  },
  {
    id: 'sports', name: '능평8통 체육공원', node: 7802629261, endLabel: '공원 경계 인근 연결 도로',
    referenceSource: 'https://www.openstreetmap.org/way/1266958183',
  },
];

const ordinary = new Set(['residential', 'service', 'living_street', 'unclassified', 'secondary', 'tertiary']);
const walkways = new Set(['footway', 'path', 'pedestrian', 'steps']);
const sidewalk = new Set(['yes', 'both', 'left', 'right']);
const footAllowed = new Set(['yes', 'designated', 'permissive']);
const restricted = new Set(['no', 'private', 'destination', 'customers']);
const graph = new Map();
for (const way of ways.values()) {
  const { highway, foot, access, expressway, motorroad, sidewalk: pavement } = way.tags ?? {};
  if (restricted.has(foot) || (restricted.has(access) && !footAllowed.has(foot)) || expressway === 'yes' || motorroad === 'yes') continue;
  const mappedWalkway = walkways.has(highway) || sidewalk.has(pavement);
  if (!highway || !(mappedWalkway || ordinary.has(highway) || footAllowed.has(foot))) continue;
  for (let i = 1; i < way.nodes.length; i++) {
    const a = way.nodes[i - 1], b = way.nodes[i];
    if (!projected.has(a) || !projected.has(b)) continue;
    const length = distance(projected.get(a), projected.get(b));
    if (length === 0) continue;
    for (const [from, to] of [[a, b], [b, a]]) {
      if (!graph.has(from)) graph.set(from, []);
      graph.get(from).push({ to, length, way: way.id, mappedWalkway });
    }
  }
}

const lengths = new Map([[start, 0]]), previous = new Map(), pending = new Set([start]);
const wanted = new Set(destinations.map(item => item.node));
while (pending.size && wanted.size) {
  let next;
  for (const node of pending) if (next === undefined || lengths.get(node) < lengths.get(next)) next = node;
  pending.delete(next);
  wanted.delete(next);
  for (const edge of graph.get(next) ?? []) {
    const cost = lengths.get(next) + edge.length;
    if (cost >= (lengths.get(edge.to) ?? Infinity)) continue;
    lengths.set(edge.to, cost);
    previous.set(edge.to, { ...edge, from: next });
    pending.add(edge.to);
  }
}

const routes = destinations.map(({ node, reference, ...destination }) => {
  if (wanted.has(node)) throw new Error(`No connected road to ${destination.name}`);
  const edges = [];
  for (let pointer = node; pointer !== start;) {
    const edge = previous.get(pointer);
    edges.unshift(edge);
    pointer = edge.from;
  }
  const segments = [];
  for (const edge of edges) {
    const last = segments.at(-1);
    if (last?.mappedWalkway === edge.mappedWalkway) last.coordinates.push(nodes.get(edge.to));
    else segments.push({ mappedWalkway: edge.mappedWalkway, coordinates: [nodes.get(edge.from), nodes.get(edge.to)] });
  }
  return { ...destination, end: nodes.get(node), segments,
    lengthM: Math.round(lengths.get(node)),
    walkwayM: Math.round(edges.filter(edge => edge.mappedWalkway).reduce((sum, edge) => sum + edge.length, 0)),
    gapM: reference ? Math.round(distance(projection.forward(reference), projected.get(node))) : null,
    wayIds: [...new Set(edges.map(edge => edge.way))],
  };
});

await writeFile(new URL('../public/opo-green-access.json', import.meta.url), JSON.stringify({
  source, start: nodes.get(start), routes,
  attribution: '© OpenStreetMap contributors', license: 'https://www.openstreetmap.org/copyright',
}) + '\n');
for (const route of routes) console.log(`${route.id}: ${route.lengthM}m connected, ${route.walkwayM}m mapped sidewalk or footway`);
