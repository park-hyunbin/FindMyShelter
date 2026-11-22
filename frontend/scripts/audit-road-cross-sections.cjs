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
const { makeGround, groundPolygon, createTerrainProjection, paintRibbon, ribbon } = fromTour('./components/opo-meshes.ts');
const { addStreets, inferredRoadSection, surveyedDashSegments } = fromTour('./components/opo-streets.ts');
const { alignShadowTarget } = fromTour('./components/opo-contact-shadows.ts');
const { addSiteDetails } = fromTour('./components/opo-site.ts');
const { createSidewalkSeams } = fromTour('./components/opo-curb-walk.ts');
const { createSurfaceClipper } = require('../components/opo-surface-clip.ts');
const { crossingSupport, fitCrosswalkToMeasuredRoad, surveyedCrosswalkArea, surveyedCrosswalkFrame, surveyedLandingFrame } = require('../components/opo-crosswalks.ts');
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
    : mesh.name === '고가 보행로' ? 'bridgeWalk'
    : ['주차 포장', '부지 안 포장', '차량 통행 제한 포장'].includes(mesh.name) ? 'adjoiningPaving'
      : mesh.material.userData?.auditSurface;
  const surface = masks[kind];
  surface?.addSurface(mesh.geometry);
}

function surveyedSurface(areas, exclusions, surface = createSurfaceClipper()) {
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
  const compact = rectangle(-3.88, 3.88, -3, 3);
  const compactPaint = surveyedSurface([compact]);
  const landingFrame = surveyedLandingFrame(compact[0], road, walks, compactPaint);
  assert.equal(Math.abs(landingFrame.direction.z), 1, 'Measured landings resolve a compact crossing with inset paint');
  assert.equal(surveyedLandingFrame(compact[0], road, oneSide, compactPaint), undefined);
  compactPaint.clear();
  const edgeAligned = rectangle(-4.87, 4.87, -3.35, 3.35);
  const edgePaint = surveyedSurface([edgeAligned]);
  assert.equal(crossingSupport(area(9.74), road, oneSide, edgePaint), 'no_landing');
  const edgeFrame = surveyedLandingFrame(edgeAligned[0], road, oneSide, edgePaint);
  assert.equal(Math.abs(edgeFrame.direction.z), 1, 'Both measured road edges and one landing establish direction');
  edgePaint.clear();
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
  const stripe = paintRibbon([{ x: 2, z: -1 }, { x: 2, z: 5 }], 2);
  const projected = pavement.clipOnce(stripe, 0.02);
  const clipped = pavement.clip(projected, 0.04);
  const outside = pavement.subtract(stripe);
  for (const mesh of [projected, clipped, outside]) {
    const vertices = mesh.getAttribute('position');
    const paint = mesh.getAttribute('paintCoordinates');
    assert.ok(vertices.count > 0);
    assert.equal(paint.count, vertices.count);
    for (let i = 0; i < vertices.count; i++) {
      assert.ok(Math.abs(paint.getX(i) - (vertices.getX(i) - 2) / 2) < 1e-6);
      assert.ok(Math.abs(paint.getY(i) - (vertices.getZ(i) + 1) / 6) < 1e-6);
    }
  }
  [stripe, projected, clipped, outside].forEach(geometry => geometry.dispose());
  pavement.clear();

  const steep = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute([
    -258, 0, 815.9679, -257, 0, 815.9679, -258, 0.6, 815.9691,
  ], 3));
  const narrowStripe = paintRibbon([{ x: -257.77, z: 815.6 }, { x: -257.77, z: 816.4 }], 0.14);
  pavement.addSurface(steep);
  const steepPaint = pavement.clipOnce(narrowStripe, 0.018);
  const surface = steep.getAttribute('position');
  const painted = steepPaint.getAttribute('position');
  assert.ok(painted.count > 0);
  for (let i = 0; i < painted.count; i++) {
    const t = (painted.getZ(i) - surface.getZ(0)) / (surface.getZ(2) - surface.getZ(0));
    const height = surface.getY(2) * t + 0.018;
    assert.ok(Math.abs(painted.getY(i) - height) < 0.002, 'Paint height drifted after Float32 rounding');
  }
  [steep, narrowStripe, steepPaint].forEach(geometry => geometry.dispose());
  pavement.clear();
}

function testGuideDashes() {
  const along = x => ({ x, z: 0 });
  const pattern = (from, to, distance = 0, style = 'white-guide-dash') =>
    surveyedDashSegments([along(from), along(to)], style, false, distance)
      .map(stroke => [stroke[0].x, stroke.at(-1).x].map(x => Math.round(x * 1000) / 1000));
  assert.deepEqual(pattern(0, 5), [[0, 0.75], [1.5, 2.25], [3, 3.75], [4.5, 5]]);
  assert.deepEqual(pattern(0.4, 2.5, 0.4), [[0.4, 0.75], [1.5, 2.25]]);
  assert.deepEqual(pattern(1.1, 3, 1.1), [[1.5, 2.25]]);
  assert.deepEqual(pattern(0, 5, 0, 'white-dash'), [[0, 4]]);
}

function testInferredRoadBoundary() {
  const rectangle = (left, right) => [[
    { x: left, z: -8 }, { x: right, z: -8 }, { x: right, z: 8 }, { x: left, z: 8 },
  ]];
  const surveyed = surveyedSurface([rectangle(1, 1.5), rectangle(3, 4)]);
  const centerline = [{ x: 0, z: -6 }, { x: 0, z: 6 }];
  const deck = ribbon(centerline, 8, () => 0, Infinity, 3, (point, normal, half) =>
    inferredRoadSection(surveyed.section(point, normal, half), half));
  const positions = deck.getAttribute('position');
  const edges = Array.from({ length: positions.count }, (_, index) => positions.getX(index));
  assert.equal(Math.max(...edges), 1);
  assert.equal(Math.min(...edges), -4);
  assert.deepEqual(inferredRoadSection([[-1, 1.5], [2, 3]], 4), [-1, 1.5]);
  deck.dispose();
  surveyed.clear();

  const join = { x: 0, z: 0 };
  const endNormal = point => point === join ? { x: 0, z: 1 } : undefined;
  const incoming = ribbon([{ x: -8, z: -2 }, join], 6, () => 0, Infinity, 3, undefined, endNormal);
  const outgoing = ribbon([join, { x: 9, z: -2 }], 6, () => 0, Infinity, 3, undefined, endNormal);
  const incomingPositions = incoming.getAttribute('position');
  const outgoingPositions = outgoing.getAttribute('position');
  const edge = (positions, start) => [start, start + 1]
    .map(i => [positions.getX(i), positions.getZ(i)]).sort((a, b) => a[1] - b[1]);
  assert.deepEqual(edge(incomingPositions, incomingPositions.count - 2), [[0, -3], [0, 3]]);
  assert.deepEqual(edge(outgoingPositions, 0), [[0, -3], [0, 3]]);
  incoming.dispose();
  outgoing.dispose();
}

function testShadowGrid() {
  const light = new T.DirectionalLight();
  const direction = new T.Vector3(-200, 300, 100).normalize();
  const landmark = new T.Vector3(123, 16, -64);
  const targets = [new T.Vector3(100.1, 20, -43.3), new T.Vector3(124.8, 19.4, -66.9)];
  for (const [radius, resolution] of [[78, 1024], [94, 2048], [270, 2048]]) {
    Object.assign(light.shadow.camera, { left: -radius, right: radius, bottom: -radius, top: radius });
    light.shadow.camera.updateProjectionMatrix();
    const result = targets.map(center => {
      light.target.position.copy(alignShadowTarget(center, direction, 2 * radius / resolution));
      light.position.copy(direction).multiplyScalar(660).add(light.target.position);
      light.target.updateMatrixWorld();
      light.updateMatrixWorld();
      light.shadow.updateMatrices(light);
      return landmark.clone().applyMatrix4(light.shadow.matrix).multiplyScalar(resolution);
    });
    const shift = result[1].sub(result[0]);
    for (const axis of ['x', 'y']) {
      assert.ok(Math.abs(shift[axis] - Math.round(shift[axis])) < 1e-8,
        'Shadow filtering moved within a texel after the light followed the viewer');
    }
  }
  light.dispose();
}

function verifyElevatedPaint(data, scene) {
  const expected = data.roadMarkings?.elevatedMarkings?.records.length ?? 0;
  const paint = scene.children.filter(mesh => mesh.isMesh && mesh.name === '고가 노면표시');
  assert.equal(paint.length > 0, expected > 0, `Missing or unexpected elevated paint in ${data.region}`);
  const dividers = (data.pavement?.elevatedRoads ?? []).flatMap(deck => deck.dividers);
  const renderedDividers = scene.children.filter(mesh => mesh.isMesh && mesh.name === '고가 분리 경계');
  assert.equal(renderedDividers.length > 0, dividers.length > 0, `Missing or unexpected elevated divider in ${data.region}`);
  if (!expected && !dividers.length) return;
  const decks = createSurfaceClipper();
  for (const mesh of scene.children) {
    if (mesh.isMesh && mesh.name === '고가 차도') decks.addSurface(mesh.geometry);
  }
  let triangles = 0;
  for (const mesh of paint) {
    const vertices = mesh.geometry.getAttribute('position');
    for (let i = 0; i < vertices.count; i += 3) {
      const average = component => (vertices.getComponent(i, component) + vertices.getComponent(i + 1, component)
        + vertices.getComponent(i + 2, component)) / 3;
      const point = { x: average(0), z: average(2) };
      const y = average(1);
      const deck = decks.heightAt(point);
      assert.ok(deck !== undefined && Math.abs(y - deck - 0.018) < 0.005,
        `Elevated paint misses its rendered deck in ${data.region} at ${JSON.stringify(point)}`);
      triangles++;
    }
  }
  const dividerSurface = createSurfaceClipper();
  renderedDividers.forEach(mesh => dividerSurface.addSurface(mesh.geometry));
  function coveredArea(outline, surface) {
    const clipped = surface.clipOnce(outline, 0);
    const position = clipped.getAttribute('position');
    let area = 0;
    for (let i = 0; i < position.count; i += 3) {
      const x = position.getX(i), z = position.getZ(i);
      area += Math.abs((position.getX(i + 1) - x) * (position.getZ(i + 2) - z)
        - (position.getX(i + 2) - x) * (position.getZ(i + 1) - z)) / 2;
    }
    clipped.dispose();
    return area;
  }
  const boundaries = dividers.map(({ managementId, shapes }) => {
    const survey = surveyedSurface(shapes);
    let total = 0, visible = 0, asphaltOverlap = 0;
    for (const rings of shapes) {
      const outline = groundPolygon(rings, () => 0, 28, 0);
      total += coveredArea(outline, survey);
      visible += coveredArea(outline, dividerSurface);
      asphaltOverlap += coveredArea(outline, decks);
      outline.dispose();
    }
    survey.clear();
    assert.ok(total > 0 && visible >= total * 0.99 && asphaltOverlap < 0.5,
      `Elevated divider ${managementId} in ${data.region}: ${visible}/${total} m² visible, ${asphaltOverlap} m² of asphalt overlaps`);
    return { managementId, surveyedM2: round(total), renderedM2: round(visible), asphaltOverlapM2: round(asphaltOverlap) };
  });
  const cheonggye = ['seoul-a13305006', 'seoul-a13381608'].includes(data.region) && verifyCheonggyeCarriageway(data, decks);
  decks.clear();
  dividerSurface.clear();
  return { records: expected, triangles, boundaries, ...(cheonggye ? { cheonggyeCarriageway: cheonggye } : {}) };
}

function verifyCheonggyeCarriageway(data, rendered) {
  const deck = data.pavement.elevatedRoads.find(({ sourceId }) => sourceId === '1000377051791A00910000000000000002');
  const road = data.streets.find(({ id }) => id === 203491741);
  assert.ok(deck && road, `Missing Cheonggye carriageway survey in ${data.region}`);
  const index = road.nodeIds.indexOf(2135060826);
  assert.equal(road.nodeIds[index + 1], 2135060909);
  const [a, b] = road.points.slice(index, index + 2);
  const dx = b.x - a.x, dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  const station = data.project([127.038186991, 37.572148272]);
  const dividers = surveyedSurface(deck.dividers.flatMap(divider => divider.shapes));
  const carriageway = surveyedSurface(deck.shapes, dividers);
  const section = crossSection(station, { x: -dz / length, z: dx / length }, carriageway, rendered);
  assert.ok(section.status === 'compared' && section.maxEdgeErrorM <= 0.5,
    `Inferred pavement is widening the surveyed Cheonggye carriageway in ${data.region}: ${JSON.stringify(section)}`);
  dividers.clear();
  carriageway.clear();
  return section;
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

function crossSection(station, normal, surveyed, surface, pavement, adjoiningPaving, coverage, offset = 0) {
  const contains = ([start, end]) => start <= offset && end >= offset;
  const reference = mergeIntervals(surveyed.section(station, normal, radius)).find(contains);
  if (!reference) return { status: 'outside_source' };
  if (coverage && reference.some(distance => {
    const x = station.x + normal.x * distance, z = station.z + normal.z * distance;
    return Math.min(x - coverage.west, coverage.east - x, z - coverage.north, coverage.south - z) < 0.05;
  })) return { status: 'coverage_boundary' };
  if (reference.some(side => Math.abs(side) >= radius)) return { status: 'open_section' };
  const visible = visibleIntervals(station, normal, surface, pavement, adjoiningPaving).find(contains) ?? [offset, offset];
  const maxEdgeError = Math.max(...reference.map((side, index) => Math.abs(side - visible[index])));
  return {
    status: 'compared',
    referenceM: round(reference[1] - reference[0]),
    renderedM: round(visible[1] - visible[0]),
    maxEdgeErrorM: round(maxEdgeError),
  };
}

function testGradeSeparatedWidths() {
  const ground = createSurfaceClipper();
  const walks = createSurfaceClipper();
  const bridgeWalk = createSurfaceClipper();
  const strip = (left, right, height) => groundPolygon([[
    { x: left, z: -4 }, { x: right, z: -4 }, { x: right, z: 4 }, { x: left, z: 4 },
  ]], () => height, 28, 0);
  const asphalt = strip(-6, 6, 0);
  const raised = strip(3, 4, 1.05);
  const curb = strip(5, 8, 0.15);
  const pavers = new T.MeshStandardMaterial();
  pavers.userData.auditSurface = 'pavers';
  const elevated = new T.Mesh(raised, pavers);
  elevated.name = '고가 보행로';
  const masks = { pavers: walks, bridgeWalk };
  ground.addSurface(asphalt);
  getSurface(elevated, masks);
  assert.equal(bridgeWalk.heightAt({ x: 3.5, z: 0 }), Math.fround(1.05));
  const width = () => crossSection({ x: 0, z: 0 }, { x: 1, z: 0 }, ground, ground, walks).renderedM;
  assert.equal(width(), 12);
  getSurface(new T.Mesh(curb, pavers), masks);
  assert.equal(width(), 11);
  for (const geometry of [asphalt, raised, curb]) geometry.dispose();
  for (const surface of [ground, walks, bridgeWalk]) surface.clear();
  pavers.dispose();
}

function auditDividerSection(station, normal, decks, bridge, coverage) {
  for (const { boundary, carriageway } of decks) {
    if (boundary.heightAt(station) === undefined) continue;
    const island = mergeIntervals(boundary.section(station, normal, radius)).find(([a, b]) => a <= 0 && b >= 0);
    if (!island) continue;
    const [left, right] = island;
    const across = mergeIntervals(carriageway.section(station, normal, radius));
    const adjacent = across.filter(([a, b]) => Math.abs(left - b) < 0.05 || Math.abs(right - a) < 0.05);
    return {
      dividerM: round(right - left),
      sides: adjacent.map(([a, b]) => crossSection(station, normal, carriageway, bridge, undefined, undefined, coverage, (a + b) / 2)),
    };
  }
}

async function audit(region, crossingsOnly, elevatedOnly) {
  const data = await loadOpoData(new AbortController().signal, region);
  if (!crossingsOnly && !elevatedOnly && (!data.pavement || !data.roadMarkings?.roadDataset)) throw new Error(`No paired pavement in ${region}`);
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
  scene.traverse(mesh => {
    if (!mesh.isMesh || !mesh.geometry.hasAttribute('paintWidth')) return;
    const vertices = mesh.geometry.getAttribute('position').count;
    const coordinates = mesh.geometry.getAttribute('paintCoordinates');
    assert.equal(mesh.geometry.getIndex(), null, `Paint triangles must be unindexed in ${region}`);
    assert.equal(coordinates?.count, vertices, `Missing paint coordinates in ${region}`);
    assert.ok(coordinates.normalized && coordinates.array instanceof Uint16Array, `Invalid paint coordinates in ${region}`);
    const shader = { vertexShader: '#include <project_vertex>', fragmentShader: '#include <alphatest_fragment>', uniforms: {} };
    mesh.material.onBeforeCompile(shader);
    const texture = shader.uniforms.paintGradients.value.image;
    assert.ok(texture.data instanceof Uint16Array && texture.width % 2 === 0);
    assert.ok(texture.width * texture.height >= vertices / 3 * 2, `Missing paint gradients in ${region}`);
  });
  if (elevatedOnly) {
    const elevated = verifyElevatedPaint(data, scene);
    ground.geometry.dispose();
    scene.traverse(object => { if (object.isMesh) object.geometry.dispose(); });
    return { region, elevated };
  }

  if (crossingsOnly) {
    if (region === 'songpa') {
      assertGarakCrosswalk(scene, data.project, checks);
      assertGarakDriveway(data, scene.children.slice(detailLayerStart));
      assertCurrentCrosswalk(scene, data, checks, '06-0000052539');
    }
    if (region === 'jamsil-leel') {
      assertCurrentCrosswalk(scene, data, checks, '06-0000051103');
      assertCurrentCrosswalk(scene, data, checks, '06-0000009350');
      assertCurrentCrosswalk(scene, data, checks, '06-0000030331');
    }
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
  const elevated = createSurfaceClipper();
  const dividedDecks = new Map();
  for (const { roadIds, shapes, dividers } of data.pavement.elevatedRoads ?? []) {
    if (!dividers.length) {
      surveyedSurface(shapes, undefined, elevated);
      continue;
    }
    const boundary = surveyedSurface(dividers.flatMap(divider => divider.shapes));
    surveyedSurface(shapes, boundary, elevated);
    const deck = { boundary, carriageway: surveyedSurface(shapes, boundary) };
    for (const roadId of roadIds) {
      if (!dividedDecks.has(roadId)) dividedDecks.set(roadId, []);
      dividedDecks.get(roadId).push(deck);
    }
  }
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
  const dividerSections = [];
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
        const divided = dividedDecks.get(road.id);
        const dividerSection = divided && auditDividerSection(station, normal, divided, bridge, coverage);
        if (dividerSection) {
          dividerSections.push({ road: road.name ?? road.id, roadId: road.id,
            node: road.nodeIds[i - 1], endNode: road.nodeIds[i], atM: round(t * length), ...dividerSection });
          continue;
        }
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
  for (const { boundary, carriageway } of new Set([...dividedDecks.values()].flat())) {
    boundary.clear();
    carriageway.clear();
  }
  ground.geometry.dispose();
  scene.traverse(object => { if (object.isMesh) object.geometry.dispose(); });
  return { region, ...statistics, overpasses, ...(dividerSections.length ? { dividerSections } : {}),
    ...(gate.length ? { garakGate: gate, gates } : {}) };
}

(async () => {
  const args = process.argv.slice(2);
  const verifyCrossings = args.includes('--verify-crossings');
  const crossingsOnly = verifyCrossings || args.includes('--crossings-only');
  const elevatedOnly = args.includes('--verify-elevated');
  const requested = args.filter(arg => !['--crossings-only', '--verify-crossings', '--verify-elevated'].includes(arg));
  const regions = ['songpa', 'jamsil-leel', ...scenes.map(scene => scene.id)];
  if (crossingsOnly) {
    testCrossingSupport();
    testPaintProjection();
    testGuideDashes();
    testInferredRoadBoundary();
    testGradeSeparatedWidths();
    testShadowGrid();
    regions.push('opo');
  }
  const selected = requested.length ? requested : verifyCrossings ? ['songpa', 'jamsil-leel'] : regions;
  for (const region of selected) {
    const report = await audit(region, crossingsOnly, elevatedOnly);
    if (verifyCrossings) console.log(`Crosswalk verification passed for ${region}`);
    else console.log(JSON.stringify(report));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
