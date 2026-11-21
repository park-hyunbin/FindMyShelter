import * as T from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { drainageStops, floodDepth, floodDistance, floodForecast, floodHistory, type DrainageDistances, type FloodView } from './data/songpa-flood';
import { inShape, nearestOnLine, type OpoData, type Point } from './opo-data';
import { groundPolygon } from './opo-meshes';
import { terrainFallAt } from './opo-terrain-fall';

export function addSongpaFloodMap(data: OpoData, scene: T.Scene, grade: OpoData['ground']) {
  const group = new T.Group();
  group.visible = false;
  scene.add(group);

  const siteStroke = new LineMaterial({ color: '#84967e', linewidth: 4, depthTest: false, depthWrite: false });
  const traceStroke = new LineMaterial({ color: '#c19b67', linewidth: 2.6, depthTest: false, depthWrite: false });
  const distanceStroke = new LineMaterial({
    color: '#fff3cf', linewidth: 2.3, dashed: true, dashSize: 6, gapSize: 4, depthTest: false, depthWrite: false,
  });
  const traceFill = new T.MeshBasicMaterial({
    color: '#dc772e', opacity: 0.35, transparent: true, side: T.DoubleSide, depthTest: false, depthWrite: false,
  });
  const pointAt = ({ x, z }: Point, lift = 1.2) => new T.Vector3(x, grade(x, z) + lift, z);
  const projectRings = (polygon: number[][][]) => polygon.map(ring => ring.slice(0, -1).map(data.project));
  const stops = drainageStops.map(stop => ({ ...stop, position: data.project(stop.coordinate) }));
  function distancesFromStops(polygons: Point[][][]) {
    const edges = polygons.flatMap(rings => rings.map(ring => [...ring, ring[0]]));
    return Object.fromEntries(stops.map(({ position, id }) => {
      const distance = polygons.some(rings => inShape(position, rings)) ? 0 : nearestOnLine(position, edges).distance;
      return [id, Number.isFinite(distance) ? distance : null];
    }));
  }
  function drawOutline(target: T.Group, points: Point[], material: LineMaterial, renderOrder: number) {
    const positions = points.map(p => pointAt(p));
    const line = new Line2(new LineGeometry().setPositions(positions.flatMap(p => p.toArray())), material);
    if (material.dashed) line.computeLineDistances();
    line.renderOrder = renderOrder;
    target.add(line);
    return positions;
  }

  const site = drawOutline(group, data.siteOutline, siteStroke, 13);
  const years = new Map(Object.entries(floodHistory.years).map(([year, record]) => {
    const traces = new T.Group();
    traces.visible = false;
    group.add(traces);
    const polygons = record.polygons.map(projectRings);
    const frames = polygons.flatMap(rings => {
      const fill = new T.Mesh(groundPolygon(rings, grade, 8, 0.95), traceFill);
      fill.renderOrder = 11;
      traces.add(fill);
      return rings.flatMap(ring => drawOutline(traces, [...ring, ring[0]], traceStroke, 12));
    });
    const nearest = record.nearest ? pointAt(data.project(record.nearest)) : null;
    const boundary = record.nearestSite && !record.overlap ? pointAt(data.project(record.nearestSite)) : null;
    if (record.nearest && record.nearestSite && boundary) {
      drawOutline(traces, [data.project(record.nearestSite), data.project(record.nearest)], distanceStroke, 13);
    }
    return [year, { traces, frames, nearest, boundary, distance: record.nearestM, stops: distancesFromStops(polygons) }];
  }));

  const pinGeometry = new T.SphereGeometry(4, 12, 9);
  const forecastLayer = new T.Group();
  const forecastPolygons: Point[][][] = [];
  forecastLayer.visible = false;
  group.add(forecastLayer);
  for (const { stage, polygons } of floodForecast.stages) {
    const { color } = floodDepth[stage - 1];
    const fill = new T.MeshBasicMaterial({ color, opacity: 0.42, transparent: true, side: T.DoubleSide, depthWrite: false });
    const outline = new LineMaterial({ color, linewidth: 2, depthWrite: false });
    for (const polygon of polygons) {
      const rings = projectRings(polygon);
      forecastPolygons.push(rings);
      const mesh = new T.Mesh(groundPolygon(rings, grade, 8, 0.69), fill);
      mesh.renderOrder = 11 + stage / 10;
      forecastLayer.add(mesh);
      for (const ring of rings) drawOutline(forecastLayer, [...ring, ring[0]], outline, 12);
    }
  }
  const forecastDepth = floodDepth[floodForecast.nearest.stage - 1];
  const forecastMarker = new T.Mesh(pinGeometry, new T.MeshBasicMaterial({
    color: forecastDepth.color, depthTest: false, depthWrite: false,
  }));
  forecastMarker.position.copy(pointAt(data.project(floodForecast.nearest.point)));
  forecastMarker.scale.setScalar(0.6);
  forecastMarker.renderOrder = 14;
  forecastLayer.add(forecastMarker);
  const forecastLabel = {
    text: `100mm/시간 가정 · ${forecastDepth.label}`,
    point: forecastMarker.position.clone().add(new T.Vector3(0, 7, 0)),
    kind: 'forecast',
    enabled: () => forecastLayer.visible,
  };
  const nearestMarker = new T.Mesh(pinGeometry, new T.MeshBasicMaterial({ color: '#f7bf66', depthTest: false, depthWrite: false }));
  nearestMarker.scale.setScalar(0.65);
  nearestMarker.renderOrder = 14;
  const boundaryMarker = new T.Mesh(pinGeometry, new T.MeshBasicMaterial({ color: '#84967e', depthTest: false, depthWrite: false }));
  boundaryMarker.scale.setScalar(0.5);
  boundaryMarker.renderOrder = 14;
  group.add(nearestMarker, boundaryMarker);
  const labelPoint = new T.Vector3();
  const waterMaterial = new T.MeshBasicMaterial({ color: '#9bb4be', depthTest: false, depthWrite: false });
  const water = Object.fromEntries(Object.entries(floodHistory.water).map(([key, record]) => {
    const layer = new T.Group();
    const pin = new T.Mesh(pinGeometry, waterMaterial);
    pin.position.copy(pointAt(data.project(record.point)));
    pin.renderOrder = 14;
    layer.add(pin);
    drawOutline(layer, [data.project(record.sitePoint), data.project(record.point)], distanceStroke, 13);
    group.add(layer);
    return [key, {
      layer, pin,
      boundary: pointAt(data.project(record.sitePoint)),
      text: `${record.name} · ${floodDistance(record.distanceM)}`,
    }];
  }));
  const traceLabel = { text: '가장 가까운 침수 기록', point: labelPoint, kind: 'trace', enabled: () => nearestMarker.visible };
  const drainageMaterial = new T.MeshBasicMaterial({ color: '#e6efc1', depthTest: false, depthWrite: false });
  const drainagePins = stops.map((stop, index) => {
    const pin = new T.Mesh(pinGeometry, drainageMaterial);
    pin.visible = false;
    pin.renderOrder = 15;
    const label = { text: stop.pin, point: new T.Vector3(), kind: 'drainage', enabled: () => pin.visible };
    scene.add(pin);
    return { ...stop, number: String(index + 1), mesh: pin, label };
  });
  const gradeLayer = new T.Group();
  group.add(gradeLayer);
  const terrainFalls = data.localTerrain ? Object.fromEntries(stops.map(stop => [
    stop.id, terrainFallAt(stop.position, data.ground, data.northOffset),
  ])) : null;
  for (const stop of stops) {
    const fall = terrainFalls?.[stop.id];
    if (!fall) continue;
    const start = pointAt(stop.position, 2.6);
    const arrow = new T.ArrowHelper(new T.Vector3(fall.axis.x, 0, fall.axis.z), start, 13, '#8ee5c9', 4.6, 4.3);
    arrow.line.renderOrder = arrow.cone.renderOrder = 16;
    gradeLayer.add(arrow);
  }
  const distances: DrainageDistances = {
    forecast: distancesFromStops(forecastPolygons),
    history: Object.fromEntries([...years.entries()].map(([year, layer]) => [year, layer.stops])),
  };
  const labels = [
    traceLabel,
    forecastLabel,
    ...drainagePins.map(stop => stop.label),
    ...Object.values(water).map(({ layer, pin, text }) => ({
      text,
      point: pin.position.clone().add(new T.Vector3(0, 9, 0)), kind: 'water', enabled: () => layer.visible,
    })),
  ];
  return {
    group,
    distances,
    terrainFalls,
    labels,
    show(year: string | null, view: FloodView, eyeStop: string | null) {
      group.visible = year !== null;
      const traceView = view === 'closest' || view === 'area';
      const forecastView = view === 'forecast';
      const gradeView = view === 'slope';
      gradeLayer.visible = year !== null && gradeView;
      for (const stop of drainagePins) {
        const atEyeLevel = eyeStop === stop.id;
        stop.mesh.visible = atEyeLevel || (year !== null && (traceView || forecastView || gradeView));
        if (!stop.mesh.visible) continue;
        stop.mesh.position.copy(pointAt(stop.position, atEyeLevel ? 0.6 : 2));
        stop.mesh.scale.setScalar(atEyeLevel ? 0.07 : 0.34);
        stop.label.text = atEyeLevel ? stop.pin : stop.number;
        stop.label.point.copy(stop.mesh.position).add(new T.Vector3(0, atEyeLevel ? 1.15 : 3, 0));
      }
      forecastLayer.visible = year !== null && forecastView;
      for (const [value, layer] of years) layer.traces.visible = traceView && year === value;
      for (const [key, { layer }] of Object.entries(water)) layer.visible = year !== null && view === key;
      const selected = year === null ? undefined : years.get(year);
      const nearest = selected?.nearest;
      const boundary = traceView ? selected?.boundary : forecastView || gradeView ? null : water[view].boundary;
      boundaryMarker.visible = year !== null && Boolean(boundary);
      if (boundary) boundaryMarker.position.copy(boundary);
      nearestMarker.visible = traceView && Boolean(nearest);
      if (!selected) return [];
      if (gradeView) return [...site, ...drainagePins.map(stop => stop.mesh.position)];
      if (forecastView) return [...site, forecastLabel.point];
      if (nearest && traceView) {
        nearestMarker.position.copy(nearest);
        labelPoint.copy(nearestMarker.position).add(new T.Vector3(0, 10, 0));
        const distance = selected.distance;
        traceLabel.text = boundary && distance !== null ? `침수 기록 · ${floodDistance(distance)}` : '단지 경계와 겹치는 침수 기록';
      }
      if (view === 'closest') return nearest ? [...site, labelPoint] : site;
      if (view === 'area') return [...site, ...selected.frames];
      return [...site, water[view].pin.position];
    },
  };
}
