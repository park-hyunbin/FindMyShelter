const fs = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const T = require('three');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const source = readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } });
  module._compile(outputText, filename);
};

const frontend = path.resolve(process.env.FMS_AUDIT_FRONTEND ?? path.join(__dirname, '..'));
const fromTour = createRequire(path.join(frontend, 'package.json'));
const { loadOpoData, buildingCollision } = fromTour('./components/opo-data.ts');
const { makeGround, groundPolygon, createTerrainProjection } = fromTour('./components/opo-meshes.ts');
const { addStreets } = fromTour('./components/opo-streets.ts');
const { addSiteDetails } = fromTour('./components/opo-site.ts');
const { createSidewalkSeams } = fromTour('./components/opo-curb-walk.ts');
const { createSurfaceClipper } = require('../components/opo-surface-clip.ts');
const scenes = fromTour('./components/data/seoul-scenes.generated.json');

// Vegetation materials need a canvas, but the road audit uses triangle positions only.
const context = new Proxy({}, { get: (target, key) => target[key] ?? (() => {}) });
global.document = { createElement: () => ({ getContext: () => context }) };
const publicDir = path.join(frontend, 'public');
global.fetch = async url => {
  const filename = path.join(publicDir, new URL(url, 'https://example.test').pathname);
  return { ok: true, json: async () => JSON.parse(await fs.readFile(filename, 'utf8')) };
};

function getSurface(mesh, masks) {
  if (!mesh.isMesh || mesh.isInstancedMesh) return;
  const kind = mesh.name === '고가 차도' ? 'bridge'
    : mesh.name === '주차 포장' ? 'parking' : mesh.material.userData?.auditSurface;
  const surface = masks[kind];
  surface?.addSurface(mesh.geometry);
}

function surveyedSurface(areas, exclusions) {
  const surface = createSurfaceClipper();
  for (const rings of areas) {
    const shape = groundPolygon(rings, () => 0, 28, 0);
    const exposed = exclusions?.subtract(shape) ?? shape;
    surface.addSurface(exposed);
    if (exposed !== shape) exposed.dispose();
    shape.dispose();
  }
  return surface;
}

const radius = 45;
const seamTolerance = 0.002;
function mergeIntervals(intervals) {
  const joined = [];
  for (const [start, end] of intervals.sort((a, b) => a[0] - b[0])) {
    const last = joined.at(-1);
    if (!last || start > last[1] + seamTolerance) joined.push([start, end]);
    else last[1] = Math.max(last[1], end);
  }
  return joined;
}

function visibleIntervals(station, normal, surface, pavement, parking) {
  const asphalt = mergeIntervals([...surface.section(station, normal, radius),
    ...(parking?.section(station, normal, radius) ?? [])]);
  const sidewalks = mergeIntervals(pavement?.section(station, normal, radius) ?? []);
  for (const [start, end] of sidewalks) {
    for (let i = 0; i < asphalt.length; i++) {
      const [left, right] = asphalt[i], from = Math.max(left, start), to = Math.min(right, end);
      if (to - from <= seamTolerance) continue;
      const t = (from + to) / 2;
      const point = { x: station.x + t * normal.x, z: station.z + t * normal.z };
      const road = surface.heightAt(point) ?? parking?.heightAt(point);
      const walk = pavement.heightAt(point);
      if (road === undefined || walk === undefined || walk < road + 0.055) continue;
      const exposed = [[left, from], [to, right]].filter(([a, b]) => b - a > seamTolerance);
      asphalt.splice(i, 1, ...exposed);
      i += exposed.length - 1;
    }
  }
  return asphalt;
}

const round = value => Math.round(value * 1000) / 1000;

function crossSection(station, normal, surveyed, surface, pavement, parking) {
  const center = ([start, end]) => start <= 0 && end >= 0;
  const reference = mergeIntervals(surveyed.section(station, normal, radius)).find(center);
  if (!reference) return { status: 'outside_source' };
  if (reference.some(side => Math.abs(side) >= radius)) return { status: 'open_section' };
  const visible = visibleIntervals(station, normal, surface, pavement, parking).find(center) ?? [0, 0];
  const maxEdgeError = Math.max(...reference.map((side, index) => Math.abs(side - visible[index])));
  return {
    status: 'compared',
    referenceM: round(reference[1] - reference[0]),
    renderedM: round(visible[1] - visible[0]),
    maxEdgeErrorM: round(maxEdgeError),
  };
}

async function audit(region) {
  const data = await loadOpoData(new AbortController().signal, region);
  if (!data.pavement || !data.roadMarkings?.roadDataset) throw new Error(`No paired pavement in ${region}`);
  const scene = new T.Scene();
  const ground = makeGround(data);
  const projection = createTerrainProjection(ground.geometry);
  const seams = createSidewalkSeams();
  const inside = buildingCollision(data.buildings);
  const finish = (material, texture) => {
    // Match the unlit v132 parking material when comparing an earlier renderer.
    material.userData.auditSurface = texture === 'asphalt' && material.color.getHexString() === 'ddd9cf' ? 'parking' : texture;
    return material;
  };
  const streets = addStreets(data, scene, finish, projection, inside, seams);
  const detail = addSiteDetails(
    data, scene, streets.surface, finish, streets.streetClearance, inside, projection, seams,
    streets.municipalPaving,
  );
  seams.finish();
  streets.municipalPaving?.footprint.clear();
  streets.addSurveyedPaint(detail.paving?.asphaltDecks);
  projection.clear();

  const islands = surveyedSurface(data.pavement.trafficIslands.map(({ shape }) => shape));
  const survey = surveyedSurface(data.pavement.roads, islands);
  islands.clear();
  const elevated = surveyedSurface((data.pavement.elevatedRoads ?? []).flatMap(({ shapes }) => shapes));
  const asphalt = createSurfaceClipper();
  const bridge = createSurfaceClipper();
  const pavers = createSurfaceClipper();
  const parking = createSurfaceClipper();
  let gates = 0;
  scene.traverse(object => {
    if (object.isMesh) getSurface(object, { asphalt, bridge, pavers, parking });
    if (object.name === '차량 차단기') gates++;
  });

  const counts = () => ({ compared: 0, outsideSource: 0, open: 0, withinHalfMetre: 0,
    visuallyWithinHalfMetre: 0, missing: 0, widthErrors: [] });
  const statistics = counts();
  const overpasses = counts();
  for (const road of data.streets) {
    if (!road.motor || road.unpaved || (road.bridge && !data.pavement.elevatedRoads)) continue;
    const row = road.bridge ? overpasses : statistics;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i];
      const dx = b.x - a.x, dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      if (length < 10) continue;
      const subdivisions = Math.ceil(length / 18);
      const normal = { x: -dz / length, z: dx / length };
      for (let j = 0; j < subdivisions; j++) {
        const t = (j + 0.5) / subdivisions;
        const station = { x: a.x + t * dx, z: a.z + t * dz };
        const sample = road.bridge ? crossSection(station, normal, elevated, bridge)
          : crossSection(station, normal, survey, asphalt, pavers);
        if (sample.status === 'outside_source') { row.outsideSource++; continue; }
        if (sample.status === 'open_section') { row.open++; continue; }
        row.compared++;
        if (sample.maxEdgeErrorM <= 0.5) row.withinHalfMetre++;
        if (!road.bridge && crossSection(station, normal, survey, asphalt, pavers, parking).maxEdgeErrorM <= 0.5) {
          row.visuallyWithinHalfMetre++;
        }
        if (sample.renderedM === 0) row.missing++;
        if (sample.maxEdgeErrorM > 0.5) {
          row.widthErrors.push({
            road: road.name ?? road.id, roadId: road.id, node: road.nodeIds[i - 1], endNode: road.nodeIds[i],
            atM: round(t * length), ...sample,
          });
        }
      }
    }
  }
  statistics.widthErrors.sort((x, y) => y.maxEdgeErrorM - x.maxEdgeErrorM);
  overpasses.widthErrors.sort((x, y) => y.maxEdgeErrorM - x.maxEdgeErrorM);

  const gate = [];
  for (const lane of data.roadMarkings?.lanes ?? []) {
    if (lane.managementId !== '11-0000104759') continue;
    const points = lane.points.map(data.project);
    const edges = points.slice(1).map((b, i) => {
      const a = points[i], dx = b.x - a.x, dz = b.z - a.z;
      return { a, dx, dz, length: Math.hypot(dx, dz) };
    });
    const length = edges.reduce((sum, edge) => sum + edge.length, 0);
    for (const fraction of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      let remaining = length * fraction;
      for (const { a, dx, dz, length: edgeLength } of edges) {
        if (!edgeLength || remaining > edgeLength) { remaining -= edgeLength; continue; }
        const t = remaining / edgeLength;
        const point = { x: a.x + t * dx, z: a.z + t * dz };
        const normal = { x: -dz / edgeLength, z: dx / edgeLength };
        gate.push({ atM: round(length * fraction), ...crossSection(point, normal, survey, asphalt, pavers) });
        break;
      }
    }
  }

  [survey, elevated, asphalt, bridge, pavers, parking].forEach(surface => surface.clear());
  ground.geometry.dispose();
  scene.traverse(object => { if (object.isMesh) object.geometry.dispose(); });
  return { region, ...statistics, overpasses, ...(gate.length ? { garakGate: gate, gates } : {}) };
}

(async () => {
  const requested = process.argv.slice(2);
  for (const region of requested.length ? requested : ['songpa', 'jamsil-leel', ...scenes.map(scene => scene.id)]) {
    console.log(JSON.stringify(await audit(region)));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
