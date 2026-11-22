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
const { crossingSupport, fitCrosswalkToMeasuredRoad, surveyedCrosswalkArea, surveyedCrosswalkFrame } = require('../components/opo-crosswalks.ts');
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
    : mesh.name === '주차 포장' || mesh.name === '부지 안 포장' ? 'adjoiningPaving' : mesh.material.userData?.auditSurface;
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
  const fullCrossing = surveyedCrosswalkArea(area(4, 1), rectangle(-6, 8, -2, 2)[0]);
  assert.equal(fullCrossing.section.width, 14);
  assert.deepEqual(fullCrossing.center, { x: 1, z: 0 });
  assert.equal(fullCrossing.depth, 4);
  const [measuredOutline] = rectangle(-5, 6, -2, 2);
  const frame = surveyedCrosswalkFrame(measuredOutline, medianRoad);
  assert.equal(frame.section.width, 11);
  assert.equal(frame.depth, 4);
  assert.equal(Math.abs(frame.direction.z), 1);
  assert.equal(surveyedCrosswalkFrame(rectangle(-4, 4, -4, 4)[0], road), undefined);
  assert.equal(surveyedCrosswalkFrame(rectangle(-5, 6, 20, 24)[0], road), undefined);
  assert.equal(surveyedCrosswalkFrame(measuredOutline, clippedPaint), undefined);
  const narrow = rectangle(-5, 5, -0.45, 0.45);
  const narrowPaint = surveyedSurface([narrow]);
  assert.equal(surveyedCrosswalkFrame(narrow[0], road), undefined);
  const onBothLandings = area => crossingSupport(area, road, walks, narrowPaint) === 'connected';
  assert.equal(surveyedCrosswalkFrame(narrow[0], road, onBothLandings).section.width, 10);
  const onOneLanding = area => crossingSupport(area, road, oneSide, narrowPaint) === 'connected';
  assert.equal(surveyedCrosswalkFrame(narrow[0], road, onOneLanding), undefined);
  for (const surface of [road, walks, oneSide, clippedPaint, medianRoad, medianWalk, narrowPaint]) surface.clear();
}

function testPaintProjection() {
  const ring = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }];
  const first = groundPolygon([ring], () => 0, 28, 0);
  const second = groundPolygon([ring], () => 0.03, 28, 0);
  const pavement = createSurfaceClipper();
  pavement.addSurface(first);
  pavement.addSurface(second);
  const placed = pavement.clipOnce(first, 0.02);
  const positions = placed.getAttribute('position');
  let area = 0;
  for (let i = 0; i < positions.count; i += 3) {
    const p = offset => new T.Vector3().fromBufferAttribute(positions, i + offset);
    const a = p(0), b = p(1), c = p(2);
    assert.ok([a, b, c].every(vertex => Math.abs(vertex.y - 0.02) < 1e-6));
    area += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  assert.ok(Math.abs(area - 16) < 1e-5, `Overlapping decks produced ${area} square metres of paint`);
  [first, second, placed].forEach(geometry => geometry.dispose());
  pavement.clear();
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
  // This surveyed crossing east of Garak was skipped when no OSM link aligned.
  const surveyed = [[127.1219087, 37.4963266], [127.1218791, 37.4963117],
    [127.1218314, 37.496365], [127.1218605, 37.4963813]].map(project);
  const recoveredOutline = groundPolygon([surveyed], () => 0, 28, 0);
  const recovered = paint.clip(recoveredOutline, 0);
  assert.ok(recovered.getAttribute('position').count > 0, 'The surveyed crossing requires paint even without an aligned OSM link');
  outline.dispose();
  overlap.dispose();
  recoveredOutline.dispose();
  recovered.dispose();
  paint.clear();
}

function assertGarakDriveway(data, objects) {
  const surfaces = objects.filter(object => object.isMesh && !object.isInstancedMesh
    && object.material.userData?.auditSurface === 'asphalt');
  const ray = new T.Raycaster(new T.Vector3(), new T.Vector3(0, -1, 0));
  for (const coordinate of [[127.116801, 37.49802], [127.116806, 37.49805]]) {
    const { x, z } = data.project(coordinate);
    ray.ray.origin.set(x, data.ground(x, z) + 2, z);
    const hits = ray.intersectObjects(surfaces, false);
    assert.ok(hits.length > 0, 'The Garak driveway requires a visible surface');
    assert.ok(hits.at(-1).distance - hits[0].distance < 0.001, 'The Garak driveway finish overlaps the asphalt at another height');
  }
}

function assertCurrentCrosswalk(scene, data, checks, id) {
  const source = data.roadMarkings.currentCrosswalks?.records.find(record => record.id === id);
  assert.ok(source, `Missing current crossing survey ${id}`);
  assert.ok(checks.some(check => check.sourceId === id && check.status === 'surveyed_outline'),
    `The renderer could not align surveyed crossing ${id}`);
  const paint = createSurfaceClipper();
  scene.traverse(mesh => {
    if (mesh.isMesh && mesh.geometry.hasAttribute('paintWidth') && mesh.material.color.getHexString() === 'eeeee4') {
      paint.addSurface(mesh.geometry);
    }
  });
  const outline = groundPolygon([source.outline.map(data.project)], () => 0, 28, 0);
  const drawn = paint.clip(outline, 0);
  assert.ok(drawn.getAttribute('position').count > 0, `No stripes rendered inside crossing ${id}`);
  outline.dispose();
  drawn.dispose();
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

function visibleIntervals(station, normal, surface, pavement, adjoiningPaving) {
  const asphalt = mergeIntervals([...surface.section(station, normal, radius),
    ...(adjoiningPaving?.section(station, normal, radius) ?? [])]);
  const sidewalks = mergeIntervals(pavement?.section(station, normal, radius) ?? []);
  for (const [start, end] of sidewalks) {
    for (let i = 0; i < asphalt.length; i++) {
      const [left, right] = asphalt[i], from = Math.max(left, start), to = Math.min(right, end);
      if (to - from <= seamTolerance) continue;
      const t = (from + to) / 2;
      const point = { x: station.x + t * normal.x, z: station.z + t * normal.z };
      const road = surface.heightAt(point) ?? adjoiningPaving?.heightAt(point);
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

function crossSection(station, normal, surveyed, surface, pavement, adjoiningPaving, coverage) {
  const center = ([start, end]) => start <= 0 && end >= 0;
  const reference = mergeIntervals(surveyed.section(station, normal, radius)).find(center);
  if (!reference) return { status: 'outside_source' };
  if (coverage && reference.some(distance => {
    const x = station.x + normal.x * distance, z = station.z + normal.z * distance;
    return Math.min(x - coverage.west, coverage.east - x, z - coverage.north, coverage.south - z) < 0.05;
  })) return { status: 'coverage_boundary' };
  if (reference.some(side => Math.abs(side) >= radius)) return { status: 'open_section' };
  const visible = visibleIntervals(station, normal, surface, pavement, adjoiningPaving).find(center) ?? [0, 0];
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
    material.userData.auditSurface = texture === 'asphalt' && material.color.getHexString() === 'ddd9cf' ? 'adjoiningPaving' : texture;
    return material;
  };
  const checks = [];
  const streets = addStreets(data, scene, finish, projection, inside, seams,
    crossingsOnly ? check => checks.push(check) : undefined);
  const detailLayerStart = scene.children.length;
  const detail = addSiteDetails(
    data, scene, streets.surface, finish, streets.streetClearance, inside, projection, seams,
    streets.municipalPaving,
  );
  seams.finish();
  streets.municipalPaving?.footprint.clear();
  streets.addSurveyedPaint(detail.paving?.asphaltDecks);
  projection.clear();

  if (crossingsOnly) {
    if (region === 'songpa') {
      assertGarakCrosswalk(scene, data.project, checks);
      assertGarakDriveway(data, scene.children.slice(detailLayerStart));
      assertCurrentCrosswalk(scene, data, checks, '06-0000052539');
    }
    if (region === 'jamsil-leel') assertCurrentCrosswalk(scene, data, checks, '06-0000051103');
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
  const pavementFile = JSON.parse(await fs.readFile(path.join(publicDir, 'datasets', 'regions', region, 'pavement.json'), 'utf8'));
  const bounds = pavementFile.roadDataset?.bounds;
  let coverage;
  if (bounds) {
    const [west, south, east, north] = bounds;
    const corners = [[west, south], [west, north], [east, south], [east, north]].map(data.project);
    coverage = {
      west: Math.min(...corners.map(point => point.x)), east: Math.max(...corners.map(point => point.x)),
      north: Math.min(...corners.map(point => point.z)), south: Math.max(...corners.map(point => point.z)),
    };
  }
  const elevated = surveyedSurface((data.pavement.elevatedRoads ?? []).flatMap(({ shapes }) => shapes));
  const asphalt = createSurfaceClipper();
  const bridge = createSurfaceClipper();
  const pavers = createSurfaceClipper();
  const adjoiningPaving = createSurfaceClipper();
  let gates = 0;
  scene.traverse(object => {
    if (object.isMesh) getSurface(object, { asphalt, bridge, pavers, adjoiningPaving });
    if (object.name === '차량 차단기') gates++;
  });

  const counts = () => ({ compared: 0, outsideSource: 0, coverageBoundary: 0, open: 0, withinHalfMetre: 0,
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
        const sample = road.bridge ? crossSection(station, normal, elevated, bridge, undefined, undefined, coverage)
          : crossSection(station, normal, survey, asphalt, pavers, undefined, coverage);
        if (sample.status === 'outside_source') { row.outsideSource++; continue; }
        if (sample.status === 'coverage_boundary') { row.coverageBoundary++; continue; }
        if (sample.status === 'open_section') { row.open++; continue; }
        row.compared++;
        if (sample.maxEdgeErrorM <= 0.5) row.withinHalfMetre++;
        if (!road.bridge && crossSection(station, normal, survey, asphalt, pavers, adjoiningPaving, coverage).maxEdgeErrorM <= 0.5) {
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

  [survey, elevated, asphalt, bridge, pavers, adjoiningPaving].forEach(surface => surface.clear());
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
    testPaintProjection();
    regions.push('opo');
  }
  const selected = requested.length ? requested : verifyCrossings ? ['songpa', 'jamsil-leel'] : regions;
  for (const region of selected) {
    const report = await audit(region, crossingsOnly);
    if (verifyCrossings) console.log(`Crosswalk verification passed for ${region}`);
    else console.log(JSON.stringify(report));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
