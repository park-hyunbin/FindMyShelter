import * as T from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { floodDistance, floodHistory, type FloodView } from './data/songpa-flood';
import type { OpoData, Point } from './opo-data';
import { groundPolygon } from './opo-meshes';

export function addSongpaFloodMap(data: OpoData, scene: T.Scene, grade: OpoData['ground']) {
  const group = new T.Group();
  group.visible = false;
  scene.add(group);

  const siteStroke = new LineMaterial({ color: '#70ead1', linewidth: 4, depthTest: false, depthWrite: false });
  const traceStroke = new LineMaterial({ color: '#f0af54', linewidth: 2.6, depthTest: false, depthWrite: false });
  const distanceStroke = new LineMaterial({
    color: '#fff3cf', linewidth: 2.3, dashed: true, dashSize: 6, gapSize: 4, depthTest: false, depthWrite: false,
  });
  const traceFill = new T.MeshBasicMaterial({
    color: '#dc772e', opacity: 0.35, transparent: true, side: T.DoubleSide, depthTest: false, depthWrite: false,
  });
  const pointAt = ({ x, z }: Point, lift = 1.2) => new T.Vector3(x, grade(x, z) + lift, z);
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
    const frames = record.polygons.flatMap(polygon => {
      const rings = polygon.map(ring => ring.slice(0, -1).map(data.project));
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
    return [year, { traces, frames, nearest, boundary, distance: record.nearestM }];
  }));

  const pinGeometry = new T.SphereGeometry(4, 12, 9);
  const nearestMarker = new T.Mesh(pinGeometry, new T.MeshBasicMaterial({ color: '#f7bf66', depthTest: false, depthWrite: false }));
  nearestMarker.scale.setScalar(0.65);
  nearestMarker.renderOrder = 14;
  const boundaryMarker = new T.Mesh(pinGeometry, new T.MeshBasicMaterial({ color: '#70ead1', depthTest: false, depthWrite: false }));
  boundaryMarker.scale.setScalar(0.5);
  boundaryMarker.renderOrder = 14;
  group.add(nearestMarker, boundaryMarker);
  const labelPoint = new T.Vector3();
  const waterMaterial = new T.MeshBasicMaterial({ color: '#8fe4ff', depthTest: false, depthWrite: false });
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
  const labels = [
    traceLabel,
    ...Object.values(water).map(({ layer, pin, text }) => ({
      text,
      point: pin.position.clone().add(new T.Vector3(0, 9, 0)), kind: 'water', enabled: () => layer.visible,
    })),
  ];
  return {
    group,
    labels,
    show(year: string | null, view: FloodView) {
      group.visible = year !== null;
      const traceView = view === 'closest' || view === 'area';
      for (const [value, layer] of years) layer.traces.visible = traceView && year === value;
      for (const [key, { layer }] of Object.entries(water)) layer.visible = year !== null && view === key;
      const selected = year === null ? undefined : years.get(year);
      const nearest = selected?.nearest;
      const boundary = traceView ? selected?.boundary : water[view].boundary;
      boundaryMarker.visible = year !== null && Boolean(boundary);
      if (boundary) boundaryMarker.position.copy(boundary);
      nearestMarker.visible = traceView && Boolean(nearest);
      if (!selected) return [];
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
