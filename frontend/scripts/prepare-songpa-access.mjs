import { readFile, writeFile } from 'node:fs/promises';
import proj4 from 'proj4';

const hospital = JSON.parse(await readFile(new URL('../public/datasets/regions/songpa/hospital-entrance.json', import.meta.url), 'utf8'));
const busStop = JSON.parse(await readFile(new URL('../public/datasets/regions/songpa/bus-stop.json', import.meta.url), 'utf8'));
const bounds = [127.1090, 37.4947, 127.1231, 37.5024];
const source = `https://www.openstreetmap.org/api/0.6/map.json?bbox=${bounds.join(',')}`;
const snapshotPath = process.argv[2];
const retrieved = process.argv[3] ?? new Date().toISOString().slice(0, 10);
async function fetchSnapshot() {
  const response = await fetch(source, {
    headers: { Accept: 'application/json', 'User-Agent': 'FindMyShelter/1.0 (mapped Songpa walking routes)' },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`OpenStreetMap returned ${response.status}`);
  return response.json();
}

const { elements } = snapshotPath ? JSON.parse(await readFile(snapshotPath, 'utf8')) : await fetchSnapshot();
const nodes = new Map(elements.filter(item => item.type === 'node').map(item => [item.id, [item.lon, item.lat]]));
const ways = new Map(elements.filter(item => item.type === 'way').map(item => [item.id, item]));
const epsg5186 = '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs';
const project = proj4('WGS84', epsg5186);
const projected = new Map([...nodes].map(([id, point]) => [id, project.forward(point)]));
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// This junction is outside the mapped residential outline. Unit-to-gate paths need their own verification.
const start = 1810741885;
const gateApproachNode = 1810741895;
const destinations = [
  {
    id: 'songpa-station', name: '송파역 2번 출구 인근', node: 10911566248, reference: 3401171608,
    endLabel: '출구 인근 보행 겸용로 · 출구까지 마지막 연결 미확인',
    referenceSource: 'https://www.openstreetmap.org/node/3401171608',
  },
  {
    id: 'songi-park', name: '송이공원', node: 10657507155, park: 169803431, entrance: 5260056644,
    endLabel: '공원 남쪽 진입부를 지나 공원 안 보행로까지',
    referenceSource: 'https://www.openstreetmap.org/way/1145100664',
  },
  {
    id: 'singa-school', name: '서울신가초 방향', node: 5260056163, approachCrossing: 544143915,
    endLabel: '송이로 횡단보도 학교 쪽 보행로 · 교문까지의 연결은 현장 확인',
    referenceSource: 'https://www.openstreetmap.org/way/544143915',
  },
  {
    id: hospital.routeId, name: `${hospital.facility} 방향`, node: 1810741871,
    endLabel: '송이로14길과 송이로가 만나는 지도상 도로 지점',
    referenceSource: 'https://www.openstreetmap.org/way/169916267',
  },
];
const gateStreet = ways.get(169916279);
if (!gateStreet?.nodes.includes(start) || !gateStreet.nodes.includes(gateApproachNode) || !ways.get(169916276)?.nodes.includes(start)) {
  throw new Error('The public-road junction is missing from the map extract');
}
const station = elements.find(item => item.type === 'node' && item.id === destinations[0].reference);
if (station?.tags?.railway !== 'subway_entrance' || station.tags.ref !== '2') {
  throw new Error('Expected the mapped Songpa station exit 2');
}
const park = ways.get(destinations[1].park);
const parkFootway = ways.get(1145100664);
if (park?.tags?.name !== '송이공원' || parkFootway?.tags?.highway !== 'footway'
    || parkFootway.nodes[0] !== destinations[1].entrance || parkFootway.nodes[1] !== destinations[1].node) {
  throw new Error('The park or its mapped southern footway is missing');
}
const schoolCrossing = ways.get(destinations[2].approachCrossing);
if (ways.get(418397238)?.tags?.amenity !== 'school' || schoolCrossing?.tags?.footway !== 'crossing'
    || !schoolCrossing.nodes.includes(destinations[2].node) || !schoolCrossing.nodes.includes(10926471872)
    || ways.get(1175929591)?.tags?.name !== '송이로' || !ways.get(1175929591).nodes.includes(10926471872)) {
  throw new Error('The school or the mapped Songi-ro crossing has changed');
}
const hospitalApproach = ways.get(169916267);
if (hospitalApproach?.tags?.name !== '송이로14길' || !hospitalApproach.nodes.includes(destinations[3].node)) {
  throw new Error('The mapped Songi-ro 14-gil approach has changed');
}

const pedestrian = new Set(['footway', 'path', 'pedestrian', 'steps']);
const localRoad = new Set(['residential', 'living_street', 'unclassified', 'tertiary', 'service']);
const restricted = new Set(['no', 'private', 'customers', 'destination', 'delivery']);
const walkAllowed = new Set(['yes', 'designated', 'permissive']);
const pavement = new Set(['both', 'yes', 'left', 'right']);
const graph = new Map();

for (const { id, tags, nodes: wayNodes } of ways.values()) {
  if (!tags?.highway || restricted.has(tags.foot) || (restricted.has(tags.access) && !walkAllowed.has(tags.foot))
      || tags.motorroad === 'yes' || tags.expressway === 'yes') continue;
  const designatedFootway = tags.highway === 'cycleway' && tags.foot === 'designated'
    && tags.segregated === 'yes' && tags.name !== '자전거 전용';
  const mappedWalkway = pedestrian.has(tags.highway) || pavement.has(tags.sidewalk) || designatedFootway;
  if (!mappedWalkway && !localRoad.has(tags.highway)) continue;
  if (tags.highway === 'service' && ['parking_aisle', 'driveway'].includes(tags.service)
      && !mappedWalkway && !walkAllowed.has(tags.foot)) continue;

  for (let index = 1; index < wayNodes.length; index++) {
    const a = wayNodes[index - 1], b = wayNodes[index];
    if (!projected.has(a) || !projected.has(b)) continue;
    const length = distance(projected.get(a), projected.get(b));
    if (!length) continue;
    for (const [from, to] of [[a, b], [b, a]]) {
      if (!graph.has(from)) graph.set(from, []);
      graph.get(from).push({ from, to, id, length, mappedWalkway,
        crossing: tags.footway === 'crossing' || tags.crossing === 'marked', steps: tags.highway === 'steps' });
    }
  }
}

function shortestPaths(targets, costOf) {
  const costs = new Map([[start, 0]]);
  const previous = new Map();
  const pending = new Set([start]);
  const wanted = new Set(targets);
  while (pending.size && wanted.size) {
    let current;
    for (const id of pending) if (current === undefined || costs.get(id) < costs.get(current)) current = id;
    pending.delete(current);
    wanted.delete(current);
    for (const edge of graph.get(current) ?? []) {
      const cost = costs.get(current) + costOf(edge);
      if (cost >= (costs.get(edge.to) ?? Infinity)) continue;
      costs.set(edge.to, cost);
      previous.set(edge.to, edge);
      pending.add(edge.to);
    }
  }
  return node => {
    if (!previous.has(node) || wanted.has(node)) throw new Error(`No mapped connection to node ${node}`);
    const edges = [];
    for (let next = node; next !== start;) {
      const edge = previous.get(next);
      edges.unshift(edge);
      next = edge.from;
    }
    return edges;
  };
}

function describeRoute({ node, reference, park, entrance, approachCrossing, ...destination }, edges) {
  const hospitalRoute = destination.id === hospital.routeId;
  if (hospitalRoute && (edges.at(-1)?.id !== hospitalApproach.id || edges.some(edge => edge.id === 1175929591))) {
    throw new Error('The hospital approach must end at the local street without following the Songi-ro centerline');
  }
  const segments = [];
  const crossings = new Map();
  for (const edge of edges) {
    const last = segments.at(-1);
    if (last?.mappedWalkway === edge.mappedWalkway) last.coordinates.push(nodes.get(edge.to));
    else segments.push({ mappedWalkway: edge.mappedWalkway, coordinates: [nodes.get(edge.from), nodes.get(edge.to)] });
    if (edge.crossing && !crossings.has(edge.id)) {
      const a = nodes.get(edge.from), b = nodes.get(edge.to);
      crossings.set(edge.id, { wayId: edge.id, coordinate: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] });
    }
  }
  const crossingEdges = approachCrossing ? edges.filter(edge => edge.id === approachCrossing && edge.crossing) : [];
  if (approachCrossing && !crossingEdges.length) throw new Error('The school route missed the named crossing');
  const lastEdge = edges.at(-1);
  if (entrance && (lastEdge?.from !== entrance || lastEdge.id !== parkFootway.id)) {
    throw new Error('The park route must follow the documented last leg through the south entrance');
  }
  const length = edges.reduce((sum, edge) => sum + edge.length, 0);
  return {
    ...destination, end: nodes.get(node), segments,
    lengthM: Math.round(length),
    walkwayM: Math.round(edges.filter(edge => edge.mappedWalkway).reduce((sum, edge) => sum + edge.length, 0)),
    gapM: hospitalRoute ? Math.round(distance(projected.get(node), project.forward(hospital.coordinate)))
      : reference ? Math.round(distance(projected.get(node), projected.get(reference))) : null,
    crossings: [...crossings.values()],
    ...(crossingEdges.length && {
      crossingView: { position: nodes.get(crossingEdges[0].from), toward: nodes.get(crossingEdges.at(-1).to) },
    }),
    ...(entrance && {
      parkEntrance: { routeM: Math.round(length - lastEdge.length), directM: Math.round(distance(projected.get(start), projected.get(entrance))) },
    }),
    stepWays: new Set(edges.filter(edge => edge.steps).map(edge => edge.id)).size,
    wayIds: [...new Set(edges.map(edge => edge.id))],
  };
}

// Keep the existing paths, preferring mapped pedestrian links over unclassified streets.
const primary = shortestPaths(destinations.map(item => item.node), edge => edge.length * (edge.mappedWalkway ? 1 : 1.45));
const routes = destinations.map(destination => describeRoute(destination, primary(destination.node)));
const [stationRoute, parkRoute] = destinations;
const stationDetour = shortestPaths([stationRoute.node], edge =>
  edge.mappedWalkway && !edge.steps && edge.id !== 1487965505 ? edge.length : Infinity)(stationRoute.node);
const parkDistanceRoute = shortestPaths([parkRoute.node], edge => edge.length)(parkRoute.node);
if (!stationDetour.some(edge => edge.id === 1174305297) || !parkDistanceRoute.some(edge => edge.id === 169916267)) {
  throw new Error('A reviewed alternative changed in the map extract');
}
routes.push(describeRoute({ ...stationRoute, id: 'songpa-station-detour', variantOf: stationRoute.id,
  comparisonLabel: '북쪽 보행로 경유' }, stationDetour));
routes.push(describeRoute({ ...parkRoute, id: 'songi-park-distance', variantOf: parkRoute.id,
  comparisonLabel: '송이로14길 경유' }, parkDistanceRoute));

// The city stop coordinates align with the southern footway already reviewed for the school route.
const schoolEdges = primary(destinations[2].node);
const stopPosition = project.forward(busStop.coordinate);
const approach = schoolEdges.flatMap((edge, index) => {
  if (edge.id !== 1175929597 || !edge.mappedWalkway) return [];
  const [ax, ay] = projected.get(edge.from);
  const [bx, by] = projected.get(edge.to);
  const dx = bx - ax, dy = by - ay;
  const fraction = Math.max(0, Math.min(1, ((stopPosition[0] - ax) * dx + (stopPosition[1] - ay) * dy) / edge.length ** 2));
  const alongEdge = fraction * edge.length;
  const point = [ax + dx * fraction, ay + dy * fraction];
  const viewFraction = Math.max(0, alongEdge - 9) / edge.length;
  const view = [ax + dx * viewFraction, ay + dy * viewFraction];
  return [{ edge, index, point, view, alongEdge, gap: distance(point, stopPosition) }];
}).sort((a, b) => a.gap - b.gap)[0];
if (!approach || approach.gap > 1 || approach.alongEdge < 3) {
  throw new Error('The city stop no longer matches the reviewed Yangjae-daero footway and approach.');
}
nodes.set(busStop.routeId, project.inverse(approach.point));
routes.push(describeRoute({
  id: busStop.routeId, name: `${busStop.name} 정류소`, node: busStop.routeId,
  endLabel: '양재대로 남쪽 보행로 · 서울시 정류소 위치 인근',
  referenceSource: busStop.source,
  stopView: { position: project.inverse(approach.view), toward: busStop.coordinate },
}, [...schoolEdges.slice(0, approach.index), { ...approach.edge, to: busStop.routeId, length: approach.alongEdge }]));

const streetStart = gateStreet.nodes.indexOf(start);
const streetEnd = gateStreet.nodes.indexOf(gateApproachNode);
const approachNodes = gateStreet.nodes.slice(Math.min(streetStart, streetEnd), Math.max(streetStart, streetEnd) + 1);
if (streetStart > streetEnd) approachNodes.reverse();
function referenceLink(ids, linkSource) {
  const coordinates = ids.map(id => nodes.get(id));
  const lengthM = Math.round(ids.slice(1).reduce((sum, id, index) => sum + distance(projected.get(ids[index]), projected.get(id)), 0));
  return { coordinates, lengthM, source: linkSource };
}
const homeLinks = {
  stationExit: referenceLink([station.id, stationRoute.node], stationRoute.referenceSource),
  gateApproach: referenceLink(approachNodes, `https://www.openstreetmap.org/way/${gateStreet.id}`),
};

await writeFile(new URL('../public/datasets/regions/songpa/access.json', import.meta.url), JSON.stringify({
  source, retrieved, start: nodes.get(start), startNode: start, routes, homeLinks,
  attribution: '© OpenStreetMap contributors', license: 'https://www.openstreetmap.org/copyright',
}) + '\n');
for (const route of routes) {
  console.log(`${route.name}: ${route.lengthM}m mapped, ${route.walkwayM}m with a footway/sidewalk tag, ${route.crossings.length} crossing ways, gap ${route.gapM ?? '—'}m`);
}
