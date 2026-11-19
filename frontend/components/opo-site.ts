import * as T from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { nearestOnLine, splitLineAt, type OpoData, type Point } from './opo-data';
import { groundPolygon, ribbon } from './opo-meshes';
import { surfaceUV, type TourMaterials } from './opo-materials';
import { routeTerrainProfile } from './opo-route-profile';
import { songpaHomeLinks, songpaHospital, songpaStationAccess, songpaStationRouteId, visitRoutes } from './data/visit-routes';
import { siteSurfaces } from './data/site-surfaces';
import { songpaGrounds, songpaPlayground } from './data/songpa-grounds';
import { songpaEntrance } from './data/songpa-entrance';
import { ambientArchive, ambientStops, yangjaeRoad } from './data/songpa-ambient';
import { songpaSchool } from './data/songpa-school';
import { songiPark, songiParkApproach, songiParkSurvey } from './data/songi-park';
import { surveyedRoute } from './data/songpa-route-elevation';
import { addParkingCanopy } from './opo-songpa-entrance';
import { addSongpaCourtyard } from './opo-songpa-courtyard';
import { addSiteSurfaces } from './opo-site-surfaces';
import { addPlayground } from './opo-playground';

export const approach = [127.165458, 37.351201];
export const playgroundReference = [127.1650128, 37.350598];

function addSongiPark(data: OpoData, scene: T.Scene, grade: OpoData['ground'], finish: TourMaterials) {
  const surfaces = [
    { outline: songiPark.plaza, edge: 3, lift: 0.22, color: '#ded8cc', texture: 'pavers' },
    { outline: songiPark.clearing, edge: 4, lift: 0.17, color: '#d7b996', texture: 'forest' },
  ] as const;
  for (const { outline, edge, lift, color, texture } of surfaces) {
    const geometry = groundPolygon([outline.map(data.project)], grade, edge, lift);
    surfaceUV(geometry, texture);
    const material = finish(new T.MeshStandardMaterial({ color, roughness: 0.95, side: T.DoubleSide }), texture);
    const path = new T.Mesh(geometry, material);
    path.receiveShadow = true;
    scene.add(path);
  }
}

export function addSongpaSchoolMap(data: OpoData, scene: T.Scene, grade: OpoData['ground']) {
  const group = new T.Group();
  group.visible = false;
  scene.add(group);
  const pointAt = ({ x, z }: Point, lift = 2) => new T.Vector3(x, grade(x, z) + lift, z);
  const zoneStroke = new LineMaterial({ color: '#bacbff', linewidth: 3.4, depthTest: false, depthWrite: false });
  const siteStroke = new LineMaterial({ color: '#70ead1', linewidth: 4.1, depthTest: false, depthWrite: false });
  const fill = new T.MeshBasicMaterial({ color: '#697cb6', opacity: 0.16, transparent: true,
    depthTest: false, depthWrite: false, side: T.DoubleSide });
  function outline(points: T.Vector3[], material: LineMaterial) {
    const line = new Line2(new LineGeometry().setPositions(points.flatMap(p => p.toArray())), material);
    line.renderOrder = 13;
    group.add(line);
  }

  const geometry = songpaSchool.geometry;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const regionPoints = polygons.flatMap(polygon => {
    const rings = polygon.map(ring => ring.slice(0, -1).map(data.project));
    const mesh = new T.Mesh(groundPolygon(rings, grade, 32, 1.2), fill);
    mesh.renderOrder = 12;
    group.add(mesh);
    return rings.flatMap(ring => {
      const points = [...ring, ring[0]].map(p => pointAt(p));
      outline(points, zoneStroke);
      return points;
    });
  });
  const sitePoints = data.siteOutline.map(p => pointAt(p));
  outline(sitePoints, siteStroke);
  const siteCenter = new T.Box3().setFromPoints(sitePoints).getCenter(new T.Vector3());
  const labels = [{ point: siteCenter.add(new T.Vector3(0, 25, 0)), text: data.area.name, kind: 'site' }];
  const school = data.places.find(place => place.id === songpaSchool.placeId);
  if (school) {
    const pin = new T.Mesh(new T.SphereGeometry(7, 12, 9),
      new T.MeshBasicMaterial({ color: '#bacbff', depthTest: false, depthWrite: false }));
    pin.position.copy(pointAt(school.point, 28));
    pin.renderOrder = 14;
    group.add(pin);
    labels.push({ point: pin.position.clone().add(new T.Vector3(0, 15, 0)), text: songpaSchool.school, kind: 'school' });
  }
  return { group, labels, regionPoints };
}

export function addSiteDetails(data: OpoData, scene: T.Scene, grade: OpoData['ground'], finish: TourMaterials,
  roadClearance: (point: Point) => number, insideBuilding: (point: Point) => boolean) {
  const surfaces = siteSurfaces[data.region];
  const paving = surfaces && addSiteSurfaces(data, scene, grade, finish, surfaces.layout, roadClearance, insideBuilding);
  if (data.region === 'songpa') {
    addParkingCanopy(data, scene, songpaEntrance.garage.canopy,
      (x, z) => paving?.drivewayElevation({ x, z }) ?? grade(x, z));
    addSongpaCourtyard(data, scene, grade, finish);
    addPlayground(data, scene, (x, z) => paving?.elevation({ x, z }) ?? grade(x, z), songpaPlayground.layout);
    addSongiPark(data, scene, grade, finish);
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

  return { overlay, paving };
}

export function addSongpaAmbientMap(data: OpoData, scene: T.Scene, grade: OpoData['ground']) {
  const group = new T.Group();
  group.visible = false;
  scene.add(group);
  const road = yangjaeRoad.map(data.project);
  const roadMaterial = new T.MeshBasicMaterial({ color: '#e8b861', side: T.DoubleSide });
  group.add(new T.Mesh(ribbon(road, 6, (x, z) => grade(x, z) + 1.9), roadMaterial));
  const stations = ambientArchive.stations.map(station => ({
    serial: station.serial, name: `센서 · ${station.address}`, position: data.project(station.coordinate),
  }));
  const stops = ambientStops.map(stop => {
    const position = data.project(stop.coordinate);
    return { id: stop.id, name: stop.name, position, lookAt: data.project(stop.lookAt),
      roadDistanceM: nearestOnLine(position, [road]).distance,
      stationDistancesM: Object.fromEntries(stations.map(({ serial, position: sensor }) =>
        [serial, Math.hypot(sensor.x - position.x, sensor.z - position.z)])) };
  });
  const stationMaterial = new T.MeshBasicMaterial({ color: '#77e2d4', depthTest: false, depthWrite: false });
  const referenceMaterial = new T.MeshBasicMaterial({ color: '#ffe1a0', depthTest: false, depthWrite: false });
  const guideMaterial = new LineMaterial({ color: '#77e2d4', linewidth: 2.6, dashed: true,
    dashSize: 9, gapSize: 6, depthTest: false, depthWrite: false });
  const stopGeometry = new T.SphereGeometry(4, 12, 9);
  const stationGeometry = new T.SphereGeometry(7, 12, 9);
  function marker(name: string, { x, z }: Point, station: boolean) {
    const pin = new T.Mesh(station ? stationGeometry : stopGeometry, station ? stationMaterial : roadMaterial);
    pin.position.set(x, grade(x, z) + (station ? 30 : 8), z);
    pin.renderOrder = 7;
    group.add(pin);
    return { pin, name, point: pin.position.clone().add(new T.Vector3(0, station ? 16 : 9, 0)) };
  }
  const stationLabels = stations.map(({ name, serial, position }) => ({
    ...marker(name, position, true), kind: 'station' as const, serial,
  }));
  const stopLabels = stops.map(({ id, name, position }) => ({
    ...marker(name, position, false), kind: 'stop' as const, id,
  }));
  const guides = stopLabels.map(stop => {
    const lines = new T.Group();
    lines.visible = false;
    for (const station of stationLabels) {
      const line = new Line2(new LineGeometry().setPositions([...stop.pin.position.toArray(), ...station.pin.position.toArray()]),
        guideMaterial);
      line.computeLineDistances();
      line.renderOrder = 6;
      lines.add(line);
    }
    group.add(lines);
    return { stop, lines };
  });
  function selectReference(id?: string) {
    const reference = stops.find(stop => stop.id === id) ?? stops.at(-1);
    for (const { stop, lines } of guides) {
      lines.visible = stop.id === reference?.id;
      stop.pin.material = lines.visible ? referenceMaterial : roadMaterial;
    }
    return reference;
  }
  const labels = [...stopLabels, ...stationLabels];
  const frames = [...labels.map(label => label.point), ...road.map(({ x, z }) => new T.Vector3(x, grade(x, z) + 2, z))];
  return { group, stops, labels, frames, selectReference };
}

export function addGreenAccess(data: OpoData, scene: T.Scene, grade: OpoData['ground'],
  paving?: ReturnType<typeof addSiteSurfaces>, standingSurface?: OpoData['ground']) {
  const recorded = new LineMaterial({ color: data.region === 'songpa' ? '#148b80' : '#286e58', linewidth: 4.3 });
  const unconfirmed = new LineMaterial({ color: '#bf763a', linewidth: 4.3, dashed: true, dashSize: 9, gapSize: 5 });
  const aerialTrace = data.region === 'songpa' ? new LineMaterial({ color: '#8e69d5', linewidth: 4.3 }) : null;
  const shortConnection = data.region === 'songpa'
    ? new LineMaterial({ color: '#e09d55', linewidth: 4.3, dashed: true, dashSize: 1.1, gapSize: 0.65 }) : null;
  const routes = visitRoutes[data.region].routes;
  const surveyedWalk = paving?.sidewalkCenterlines.get(songpaEntrance.frontage.surveyedWalkId);
  const frontageWalk = paving?.sidewalkCenterlines.get(songpaEntrance.frontage.id);
  const frontage = surveyedWalk?.length && frontageWalk?.length ? [surveyedWalk[0], ...frontageWalk] : null;
  const lengthOf = (points: Point[]) => points.slice(1).reduce((sum, point, i) =>
    sum + Math.hypot(point.x - points[i].x, point.z - points[i].z), 0);
  const bearingTo = (from: Point, to: Point) =>
    T.MathUtils.radToDeg(Math.atan2(to.x - from.x, from.z - to.z) - data.northOffset);
  function viewPose(view?: { position: number[]; toward: number[] }) {
    if (!view) return;
    const position = data.project(view.position);
    return { position, bearing: bearingTo(position, data.project(view.toward)) };
  }
  const crossingGeometry = routes.some(route => route.crossings?.length)
    ? new T.RingGeometry(2.6, 3.9, 18).rotateX(-Math.PI / 2) : null;
  const crossingMaterial = crossingGeometry ? new T.MeshBasicMaterial({ color: '#f6dc94', side: T.DoubleSide }) : null;
  const layers = routes.map(route => {
    const projected = route.segments.map(segment => segment.coordinates.map(data.project));
    const stationRoute = route.id === songpaStationRouteId || route.variantOf === songpaStationRouteId;
    const endpoint = data.project(route.end);
    const surveyedEntrance = route.id === songpaHospital.routeId ? data.project(songpaHospital.coordinate) : null;
    const survey = data.region === 'songpa' ? surveyedRoute(route.id, route.segments.flatMap(segment => segment.coordinates)) : undefined;
    const profile = surveyedEntrance ? undefined : routeTerrainProfile(data, projected, survey);
    const group = new T.Group();
    const lines = new T.Group();
    const pavingGuides = new T.Group();
    const bounds = new T.Box3();
    const routePoints: T.Vector3[] = [];
    group.visible = false;
    group.add(lines, pavingGuides);
    function addLine(points: Point[], style: LineMaterial, surface?: (point: Point) => number) {
      if (points.length < 2) return;
      const vertices: number[] = [];
      function vertex(x: number, z: number) {
        const y = surface ? surface({ x, z }) : grade(x, z) + 0.76;
        const position = new T.Vector3(x, y, z);
        bounds.expandByPoint(position);
        routePoints.push(position);
        vertices.push(x, y, z);
      }
      vertex(points[0].x, points[0].z);
      const spacing = surface ? 0.5 : 4;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / spacing));
        for (let j = 1; j <= count; j++) vertex(a.x + (b.x - a.x) * j / count, a.z + (b.z - a.z) * j / count);
      }
      const line = new Line2(new LineGeometry().setPositions(vertices), style);
      line.computeLineDistances();
      (surface ? pavingGuides : lines).add(line);
      return line;
    }
    const traceLift = 0.10;
    const surfaceGuide = ({ x, z }: Point) => (standingSurface?.(x, z) ?? grade(x, z)) + traceLift;
    const parkGuide = route.parkEntrance && shortConnection;
    route.segments.forEach((segment, index) => {
      const line = projected[index];
      const style = segment.mappedWalkway ? recorded : unconfirmed;
      if (parkGuide && index === projected.length - 1) {
        const confirmedLegs = route.variantOf ? songiParkApproach.slice(4) : songiParkApproach;
        const first = data.project(confirmedLegs[0].coordinates[0]);
        if (route.variantOf) addLine([line[0], first], parkGuide);
        else addLine(splitLineAt(line, first).before, style);
        for (const leg of confirmedLegs) {
          addLine(leg.coordinates.map(data.project), leg.confirmed ? recorded : parkGuide, surfaceGuide);
        }
        addLine([data.project(confirmedLegs.at(-1)!.coordinates.at(-1)!), endpoint], recorded);
        return;
      }
      if (index !== 0 || !stationRoute || !shortConnection || !surveyedWalk?.length) {
        addLine(line, style);
        return;
      }
      const start = splitLineAt(line, surveyedWalk[0]);
      const end = splitLineAt(start.after, surveyedWalk[surveyedWalk.length - 1]);
      if (!frontage) addLine([...start.before, surveyedWalk[0]], shortConnection);
      addLine(surveyedWalk, recorded, surfaceGuide);
      addLine([surveyedWalk[surveyedWalk.length - 1], end.point], shortConnection);
      addLine(end.after, style);
    });
    if (route.stopView && shortConnection) addLine(songpaHomeLinks.gateApproach.coordinates.map(data.project), shortConnection, surfaceGuide);
    const driveway = paving?.drivewayCenterline;
    const homeWalk = aerialTrace && shortConnection && paving && driveway && driveway.length >= 2
      && stationRoute ? (() => {
      const nearStation = songpaHomeLinks.stationExit.coordinates.map(data.project);
      const nearGate = songpaHomeLinks.gateApproach.coordinates.map(data.project);
      const inner = songpaGrounds.points.find(point => point.id === 'inner-paving');
      if (!inner) return null;
      const arrival = data.project(inner.coordinate);
      // Follow the same sampled curve used for the visible driveway.
      const join = driveway.slice(1).reduce((best, end, index) => {
        const candidate = nearestOnLine(arrival, [[driveway[index], end]]);
        return candidate.distance < best.distance ? { index, ...candidate } : best;
      }, { index: 0, point: driveway[0], distance: Infinity });
      const gate = nearGate.at(-1)!;
      const inside = [gate, ...driveway.slice(0, join.index + 1), join.point, arrival];
      const gateLink = frontage ? [frontage.at(-1)!, gate] : nearGate;
      const gateLinkM = Math.round(lengthOf(gateLink));
      const frontageFocus = frontage?.find(point => Math.hypot(point.x - frontage[0].x, point.z - frontage[0].z) >= 4);
      addLine(nearStation, shortConnection);
      if (frontage) addLine(frontage, aerialTrace, surfaceGuide);
      addLine(gateLink, shortConnection, surfaceGuide);
      addLine(inside, aerialTrace, surfaceGuide);
      const at = (id: string, name: string, evidence: string, position: Point, toward: Point) => ({
        id, name, evidence, position,
        bearing: bearingTo(position, toward),
      });
      const uphill = profile?.returnSteepest;
      const uphillSample = uphill && profile?.samples[uphill.index];
      return {
        insideM: Math.round(lengthOf(inside)),
        frontageM: frontage ? Math.round(lengthOf(frontage)) : null,
        gateLinkM,
        stops: [
          at('station-exit', '송파역 2번 출구 위치', `역 안내도상 계단 · 지상 엘리베이터는 ${songpaStationAccess.elevator} · 출구에서 보도까지 약 ${songpaHomeLinks.stationExit.lengthM}m 연결 미확인`,
            nearStation[0], nearStation[1]),
          ...(uphill && uphillSample ? [{
            id: 'return-uphill', name: '귀갓길에서 가장 가파른 30m', evidence: `서울시 표고 기반 모델 · 약 ${uphill.gradient.toFixed(1)}%`,
            position: uphillSample.position, bearing: uphillSample.bearing + 180,
          }] : []),
          frontage ? at('front-junction', '단지 앞 교차점 보도',
            `${songpaEntrance.capturedIn} 로드뷰에 정문 방향 보도 확인 · 모형 끝에서 정문 앞까지 직선 약 ${gateLinkM}m의 연결과 실제 단차는 확인 필요`,
            frontage[0], frontageFocus ?? frontage.at(-1)!)
            : at('front-junction', '단지 앞 교차점', `정문 방향 약 ${gateLinkM}m · 보도 연결과 단차 미확인`, nearGate[0], nearGate[1]),
          at('main-gate', '정문 접근로', '항공영상의 진입 포장선 참고 · 실제 보행 연결과 개방 여부는 현장 확인',
            data.project(songpaEntrance.main.position), data.project(songpaEntrance.main.lookAt)),
          at(inner.id, inner.name, '항공영상 기반 포장 공간 근사 · 차량 통행과 단차는 현장 확인',
            arrival, data.project(inner.lookAt)),
        ],
      };
    })() : null;
    for (const crossing of route.crossings ?? []) {
      const parkCrossing = parkGuide && (crossing.wayId === 544143915 ? songiParkSurvey.crosswalks[0]
        : crossing.wayId === 544143913 ? songiParkSurvey.crosswalks[1] : undefined);
      const a = data.project(parkCrossing ? parkCrossing.start : crossing.coordinate);
      const b = parkCrossing ? data.project(parkCrossing.end) : a;
      const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
      const ring = new T.Mesh(crossingGeometry!, crossingMaterial!);
      ring.position.set(x, data.ground(x, z) + 2, z);
      group.add(ring);
    }
    let entranceLabel;
    let entranceView;
    if (surveyedEntrance) {
      const { x, z } = surveyedEntrance;
      const y = data.ground(x, z);
      const entranceDistance = addLine([endpoint, surveyedEntrance], new LineMaterial({
        color: '#ba9aeb', linewidth: 3.2, dashed: true, dashSize: 2.1, gapSize: 1.7,
        depthTest: false, depthWrite: false,
      }));
      if (entranceDistance) entranceDistance.renderOrder = 8;
      const material = new T.MeshBasicMaterial({ color: '#d8bcff', depthTest: false });
      const stem = new T.Mesh(new T.CylinderGeometry(0.5, 0.5, 12, 8), material);
      const tip = new T.Mesh(new T.SphereGeometry(2.8, 12, 8), material);
      stem.position.set(x, y + 6, z);
      tip.position.set(x, y + 12, z);
      stem.renderOrder = tip.renderOrder = 9;
      group.add(stem, tip);
      entranceLabel = new T.Vector3(x, y + 24, z);
      entranceView = {
        position: endpoint, bearing: bearingTo(endpoint, surveyedEntrance),
        target: new T.Vector3(x, grade(x, z) + 2.2, z),
        referenceYear: songpaHospital.referenceDate.slice(0, 4),
      };
      bounds.expandByPoint(entranceLabel);
      routePoints.push(entranceLabel);
    }
    scene.add(group);
    return { id: route.id, name: route.name, group, lines, pavingGuides, bounds, endpoint, entranceLabel, entranceView, routePoints, profile,
      crossingView: viewPose(route.crossingView), stopView: viewPose(route.stopView), homeWalk };
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
      const sample = layer?.profile?.samples[index];
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
