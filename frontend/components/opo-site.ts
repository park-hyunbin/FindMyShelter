import * as T from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { OpoData } from './opo-data';
import { groundPolygon, ribbon } from './opo-meshes';
import { surfaceUV, type TourMaterials } from './opo-materials';
import { routeTerrainProfile } from './opo-route-profile';
import { visitRoutes } from './data/visit-routes';
import { songpaGrounds } from './data/songpa-grounds';

export const approach = [127.165458, 37.351201];
export const playgroundReference = [127.1650128, 37.350598];

export function addSiteDetails(data: OpoData, scene: T.Scene, grade: OpoData['ground'], finish: TourMaterials) {
  if (data.region === 'songpa') {
    const pavement = new T.MeshStandardMaterial({ color: '#807771', roughness: 0.96, side: T.DoubleSide });
    const paint = new T.MeshStandardMaterial({ color: '#dedbd0', roughness: 0.92, side: T.DoubleSide });
    const paving = groundPolygon([songpaGrounds.paving.map(data.project)], grade, 3, 0.12);
    surfaceUV(paving, 'asphalt');
    const road = new T.Mesh(paving, finish(pavement, 'asphalt'));
    road.receiveShadow = true;
    scene.add(road);
    for (const { start, end } of songpaGrounds.markings) {
      const a = data.project(start);
      const b = data.project(end);
      const markingLength = Math.hypot(b.x - a.x, b.z - a.z);
      const normal = { x: (b.z - a.z) / markingLength, z: (a.x - b.x) / markingLength };
      const stripes = Math.ceil(markingLength / 0.9);
      for (let index = 0; index < stripes; index++) {
        const fraction = (index + 0.5) / stripes;
        const x = a.x + (b.x - a.x) * fraction;
        const z = a.z + (b.z - a.z) * fraction;
        const stripe = new T.Mesh(ribbon([
          { x: x - normal.x * 1.1, z: z - normal.z * 1.1 },
          { x: x + normal.x * 1.1, z: z + normal.z * 1.1 },
        ], 0.37, (x, z) => grade(x, z) + 0.15), paint);
        stripe.receiveShadow = true;
        scene.add(stripe);
      }
    }
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
    overlay.add(new T.Mesh(ribbon(road.points, 1.05, (x, z) => grade(x, z) + 0.66), routeMaterial));
  }

  return { overlay };
}

export function addGreenAccess(data: OpoData, scene: T.Scene) {
  const recorded = new LineMaterial({ color: data.region === 'songpa' ? '#148b80' : '#286e58', linewidth: 4.3 });
  const unconfirmed = new LineMaterial({ color: '#bf763a', linewidth: 4.3, dashed: true, dashSize: 9, gapSize: 5 });
  const routes = visitRoutes[data.region].routes;
  const crossingGeometry = routes.some(route => route.crossings?.length)
    ? new T.RingGeometry(2.6, 3.9, 18).rotateX(-Math.PI / 2) : null;
  const crossingMaterial = crossingGeometry ? new T.MeshBasicMaterial({ color: '#f6dc94', side: T.DoubleSide }) : null;
  const layers = routes.map(route => {
    const projected = route.segments.map(segment => segment.coordinates.map(data.project));
    const profile = routeTerrainProfile(data, projected);
    const group = new T.Group();
    const bounds = new T.Box3();
    const routePoints: T.Vector3[] = [];
    group.visible = false;
    for (const [index, segment] of route.segments.entries()) {
      const points = projected[index];
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
    for (const crossing of route.crossings ?? []) {
      const { x, z } = data.project(crossing.coordinate);
      const ring = new T.Mesh(crossingGeometry!, crossingMaterial!);
      ring.position.set(x, data.ground(x, z) + 2, z);
      group.add(ring);
    }
    scene.add(group);
    const endpoint = data.project(route.end);
    return { id: route.id, name: route.name, group, bounds, endpoint, routePoints, profile };
  });
  const marker = new T.Group();
  marker.visible = false;
  scene.add(marker);
  const markerMaterial = new T.MeshBasicMaterial({ color: '#f8d78b', depthTest: false, transparent: true, opacity: 0.9 });
  const stem = new T.Mesh(new T.CylinderGeometry(0.35, 0.35, 18, 8), markerMaterial);
  stem.position.y = 9;
  const tip = new T.Mesh(new T.SphereGeometry(2.4, 12, 8), markerMaterial);
  tip.position.y = 18;
  stem.renderOrder = tip.renderOrder = 9;
  marker.add(stem, tip);
  const markerLabelPoint = new T.Vector3();
  return {
    layers,
    marker,
    markerLabelPoint,
    mark(id: string | null, index: number) {
      const layer = layers.find(layer => layer.id === id);
      const sample = layer?.profile.samples[index];
      marker.visible = Boolean(layer?.group.visible && sample);
      if (!sample || !marker.visible) return;
      const { x, z } = sample.position;
      marker.position.set(x, data.ground(x, z) + 1.6, z);
      markerLabelPoint.copy(marker.position).add(new T.Vector3(0, 24, 0));
    },
    show(id: string | null) {
      for (const layer of layers) layer.group.visible = layer.id === id;
      marker.visible = false;
      return layers.find(layer => layer.id === id);
    },
  };
}
