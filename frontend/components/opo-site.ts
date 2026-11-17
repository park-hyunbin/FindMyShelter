import * as T from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { nearestOnLine, type OpoData, type Point } from './opo-data';
import { ribbon } from './opo-meshes';
import greenAccess from '../public/opo-green-access.json';

export const approach = [127.165458, 37.351201];
export const approachHeading = -2.72;
export const playgroundReference = [127.1650128, 37.350598];

export function addSiteDetails(data: OpoData, scene: T.Scene) {
  const roads = data.siteRoads.map(road => road.points);
  const bridges = data.siteRoads.filter(road => road.bridge).map(road => road.points);
  const bridgeMaterial = new T.MeshStandardMaterial({ color: '#9a9584', roughness: 0.95, side: T.DoubleSide });

  function bridgeLift(x: number, z: number) {
    const p = { x, z };
    const nearest = nearestOnLine(p, bridges);
    if (nearest.distance > 3.2) return 0;
    // Grade is an illustrative ramp. The source has bridge geometry in plan, without deck heights.
    for (const line of bridges) {
      const local = nearestOnLine(p, [line]);
      if (local.distance !== nearest.distance) continue;
      const start = line[0], end = line[line.length - 1];
      const length = Math.hypot(end.x - start.x, end.z - start.z);
      const t = Math.min(1, Math.hypot(local.point.x - start.x, local.point.z - start.z) / length);
      return 4 * t * (1 - t) * 0.82;
    }
    return 0;
  }

  for (const points of bridges) {
    const deck = new T.Mesh(ribbon(points, 5.2, (x, z) => data.ground(x, z) + bridgeLift(x, z) + 0.5), bridgeMaterial);
    deck.receiveShadow = true;
    scene.add(deck);
  }

  const overlay = new T.Group();
  overlay.visible = false;
  scene.add(overlay);
  if (data.siteOutline.length) {
    const positions = data.siteOutline.map(p => new T.Vector3(p.x, data.ground(p.x, p.z) + 0.9, p.z));
    const line = new T.Line(new T.BufferGeometry().setFromPoints(positions), new T.LineDashedMaterial({
      color: '#436a59', dashSize: 4, gapSize: 2.5, transparent: true, opacity: 0.88,
    }));
    line.computeLineDistances();
    overlay.add(line);
  }
  const routeMaterial = new T.MeshBasicMaterial({ color: '#b78b47', side: T.DoubleSide });
  for (const road of data.siteRoads) {
    overlay.add(new T.Mesh(ribbon(road.points, 1.05, (x, z) => data.ground(x, z) + bridgeLift(x, z) + 0.68), routeMaterial));
  }

  return {
    overlay,
    grade(x: number, z: number) { return data.ground(x, z) + bridgeLift(x, z); },
    driveTo(proposed: Point) {
      const { distance, point } = nearestOnLine(proposed, roads);
      if (distance > 4) return null;
      if (distance <= 2.15) return proposed;
      return { x: point.x + (proposed.x - point.x) * 2.15 / distance,
        z: point.z + (proposed.z - point.z) * 2.15 / distance };
    },
  };
}

export function addGreenAccess(data: OpoData, scene: T.Scene) {
  const recorded = new LineMaterial({ color: '#286e58', linewidth: 4.3 });
  const unconfirmed = new LineMaterial({ color: '#bf763a', linewidth: 4.3, dashed: true, dashSize: 9, gapSize: 5 });
  const layers = greenAccess.routes.map(route => {
    const group = new T.Group();
    const bounds = new T.Box3();
    const routePoints: T.Vector3[] = [];
    group.visible = false;
    for (const segment of route.segments) {
      const points = segment.coordinates.map(data.project);
      const vertices: number[] = [];
      function vertex(x: number, z: number) {
        const y = data.ground(x, z) + 1.6;
        const position = new T.Vector3(x, y, z);
        bounds.expandByPoint(position);
        routePoints.push(position);
        vertices.push(x, y, z);
      }
      vertex(points[0].x, points[0].z);
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 8));
        for (let j = 1; j <= count; j++) vertex(a.x + (b.x - a.x) * j / count, a.z + (b.z - a.z) * j / count);
      }
      const line = new Line2(new LineGeometry().setPositions(vertices), segment.mappedWalkway ? recorded : unconfirmed);
      line.computeLineDistances();
      group.add(line);
    }
    scene.add(group);
    const endpoint = data.project(route.end);
    return { id: route.id, name: route.name, group, bounds, endpoint, routePoints };
  });
  return {
    layers,
    show(id: string | null) {
      for (const layer of layers) layer.group.visible = layer.id === id;
      return layers.find(layer => layer.id === id);
    },
  };
}
