const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
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
const { crossingSupport, fitCrosswalkToMeasuredRoad } = require('../components/opo-crosswalks.ts');
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

function testCrossingSupport() {
  const rectangle = (left, right, from = -8, to = 8) => [
    [{ x: left, z: from }, { x: right, z: from }, { x: right, z: to }, { x: left, z: to }],
  ];
  const road = surveyedSurface([rectangle(-5, 5)]);
  const walks = surveyedSurface([rectangle(-8, -5), rectangle(5, 8)]);
  const oneSide = surveyedSurface([rectangle(-8, -5), rectangle(5, 8, 1, 8)]);
  const clippedPaint = surveyedSurface([rectangle(-2, 2)]);
  const medianRoad = surveyedSurface([rectangle(-5, 0), rectangle(1, 6)]);
  const medianWalk = surveyedSurface([rectangle(-8, -5), rectangle(0, 1), rectangle(6, 8)]);
  const area = (width, x = 0) => ({ center: { x, z: 0 }, direction: { x: 0, z: 1 }, depth: 3,
    section: { width } });
  assert.equal(crossingSupport(area(10), road, walks), 'connected');
  assert.equal(crossingSupport(area(5, -2.5), medianRoad, medianWalk), 'connected');
  assert.equal(crossingSupport(area(4), road, walks), 'paint_ends_inside_road');
  assert.equal(crossingSupport(area(14), road, walks), 'paint_beyond_road');
  assert.equal(crossingSupport(area(10), road, oneSide), 'no_landing');
  assert.equal(crossingSupport(area(10), road, walks, clippedPaint), 'paint_ends_inside_road');
  assert.equal(crossingSupport(area(10, 20), road, walks), 'no_carriageway');
  const fitted = fitCrosswalkToMeasuredRoad(area(6, 1), road);
  assert.equal(fitted.center.x, 0);
  assert.equal(fitted.section.width, 10);
  assert.equal(crossingSupport(fitted, road, walks, clippedPaint), 'paint_ends_inside_road');
  for (const surface of [road, walks, oneSide, clippedPaint, medianRoad, medianWalk]) surface.clear();
}

function assertGarakCrosswalk(scene, project, checks) {
  assert.ok(checks.some(check => check.source === 'site_estimate' && check.status === 'paint_ends_inside_road'));
  const disputed = [[127.1168360, 37.4977930], [127.1168540, 37.4977770],
    [127.1168082, 37.4977411], [127.1167878, 37.4977552]].map(project);
  const paint = createSurfaceClipper();
  scene.traverse(mesh => {
    if (mesh.isMesh && mesh.geometry.hasAttribute('paintWidth')
      && ['eeeee4', 'dedbd0'].includes(mesh.material.color.getHexString())) paint.addSurface(mesh.geometry);
  });
  const outline = groundPolygon([disputed], () => 0, 28, 0);
  const overlap = paint.clip(outline, 0);
  assert.equal(overlap.getAttribute('position').count, 0, 'A crosswalk was drawn inside the disputed Garak road footprint');
  outline.dispose();
  overlap.dispose();
  paint.clear();
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

async function audit(region, crossingsOnly) {
  const data = await loadOpoData(new AbortController().signal, region);
  if (!crossingsOnly && (!data.pavement || !data.roadMarkings?.roadDataset)) throw new Error(`No paired pavement in ${region}`);
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
  const checks = [];
  const streets = addStreets(data, scene, finish, projection, inside, seams,
    crossingsOnly ? check => checks.push(check) : undefined);
  const detail = addSiteDetails(
    data, scene, streets.surface, finish, streets.streetClearance, inside, projection, seams,
    streets.municipalPaving,
  );
  seams.finish();
  streets.municipalPaving?.footprint.clear();
  streets.addSurveyedPaint(detail.paving?.asphaltDecks);
  projection.clear();

  if (crossingsOnly) {
    if (region === 'songpa') assertGarakCrosswalk(scene, data.project, checks);
    const counts = {};
    for (const { source, status } of checks) {
      const outcomes = counts[source] ??= {};
      outcomes[status] = (outcomes[status] ?? 0) + 1;
    }
    ground.geometry.dispose();
    scene.traverse(object => { if (object.isMesh) object.geometry.dispose(); });
    return { region, counts, checks };
  }

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
  const args = process.argv.slice(2);
  const verifyCrossings = args.includes('--verify-crossings');
  const crossingsOnly = verifyCrossings || args.includes('--crossings-only');
  const requested = args.filter(arg => !['--crossings-only', '--verify-crossings'].includes(arg));
  const regions = ['songpa', 'jamsil-leel', ...scenes.map(scene => scene.id)];
  if (crossingsOnly) {
    testCrossingSupport();
    regions.push('opo');
  }
  const selected = requested.length ? requested : verifyCrossings ? ['songpa'] : regions;
  for (const region of selected) {
    const report = await audit(region, crossingsOnly);
    if (verifyCrossings) console.log(`Crosswalk verification passed for ${region}`);
    else console.log(JSON.stringify(report));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
