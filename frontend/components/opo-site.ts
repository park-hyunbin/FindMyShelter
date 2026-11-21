import * as T from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { inShape, nearestOnLine, splitLineAt, type CrossingLanding, type OpoData, type Point } from './opo-data';
import { groundPolygon, ribbon, type createTerrainProjection } from './opo-meshes';
import { surfaceUV, type TourMaterials } from './opo-materials';
import { routeTerrainProfile, type RouteSlopeDirection } from './opo-route-profile';
import { pavedRoute } from './opo-paved-route';
import { songpaHomeLinks, songpaHospital, songpaStationAccess, songpaStationCrossings, songpaStationRouteId, visitRoutes } from './data/visit-routes';
import { siteSurfaces } from './data/site-surfaces';
import { songpaCourtyard, songpaGrounds, songpaPlayground } from './data/songpa-grounds';
import { songpaEntrance } from './data/songpa-entrance';
import { ambientArchive, ambientStops, yangjaeRoad } from './data/songpa-ambient';
import { songpaSchool } from './data/songpa-school';
import { songiPark, songiParkApproach, songiParkSurvey } from './data/songi-park';
import { surveyedRoute } from './data/songpa-route-elevation';
import { addParkingCanopy } from './opo-songpa-entrance';
import { addSongpaCourtyard } from './opo-songpa-courtyard';
import { addSiteSurfaces } from './opo-site-surfaces';
import type { createSidewalkSeams } from './opo-curb-walk';
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
  roadClearance: (point: Point) => number, insideBuilding: (point: Point) => boolean,
  terrain?: ReturnType<typeof createTerrainProjection>, sidewalkSeams?: ReturnType<typeof createSidewalkSeams>) {
  const surfaces = siteSurfaces[data.region];
  const paving = surfaces && addSiteSurfaces(data, scene, grade, finish, surfaces.layout, roadClearance, insideBuilding,
    terrain, sidewalkSeams);
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

  const frontage = paving?.sidewalkCenterlines.get(songpaEntrance.frontage.id);
  const gateView = frontage?.length ? nearestOnLine(data.project(songpaEntrance.frontage.gateView), [frontage]).point : undefined;
  return { overlay, paving, frontage, gateView };
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
  site: ReturnType<typeof addSiteDetails>, insideBuilding: (point: Point) => boolean, standingSurface?: OpoData['ground']) {
  const recorded = new LineMaterial({ color: data.region === 'songpa' ? '#148b80' : '#286e58', linewidth: 4.3 });
  const unconfirmed = new LineMaterial({ color: '#bf763a', linewidth: 4.3, dashed: true, dashSize: 9, gapSize: 5 });
  const aerialTrace = data.region === 'songpa' ? new LineMaterial({ color: '#8e69d5', linewidth: 4.3 }) : null;
  const sharedPaving = data.region === 'songpa' ? new LineMaterial({ color: '#37b9db', linewidth: 4.3 }) : null;
  const shortConnection = data.region === 'songpa'
    ? new LineMaterial({ color: '#e09d55', linewidth: 4.3, dashed: true, dashSize: 1.1, gapSize: 0.65 }) : null;
  const gradeLine = data.region === 'songpa'
    ? new LineMaterial({ color: '#f8d78b', linewidth: 7, depthWrite: false }) : null;
  const routes = visitRoutes[data.region].routes;
  const surveyedWalk = site.paving?.sidewalkCenterlines.get(songpaEntrance.frontage.surveyedWalkId);
  const frontageWalk = site.frontage;
  const frontage = surveyedWalk?.length && frontageWalk?.length ? [surveyedWalk[0], ...frontageWalk] : null;
  const lengthOf = (points: Point[]) => points.slice(1).reduce((sum, point, i) =>
    sum + Math.hypot(point.x - points[i].x, point.z - points[i].z), 0);
  const bearingTo = (from: Point, to: Point) =>
    T.MathUtils.radToDeg(Math.atan2(to.x - from.x, from.z - to.z) - data.northOffset);
  const inner = songpaGrounds.points.find(point => point.id === 'inner-paving');
  const garden = songpaCourtyard.views.find(point => point.id === 'west-garden');
  const arrival = inner && data.project(inner.coordinate);
  const gardenPosition = garden && data.project(garden.viewFrom ?? garden.coordinate);
  const paving = site.paving;
  const gardenWalk = sharedPaving && paving && arrival && gardenPosition ? (() => {
    const surfaces = paving.walkableSurfaces();
    const surfaceAt = (point: Point) => {
      if (!inShape(point, [data.siteOutline]) || insideBuilding(point) || paving.fenced(point) || paving.parked(point)) return;
      return surfaces.at(point) ?? 'gap';
    };
    const exact = pavedRoute(arrival, gardenPosition, point => {
      const surface = surfaceAt(point);
      return surface === 'gap' ? undefined : surface;
    });
    const route = exact ?? pavedRoute(arrival, gardenPosition, surfaceAt);
    surfaces.clear();
    if (!route) return;
    const distances = route.reduce((totals, leg) => {
      totals[leg.surface] += lengthOf(leg.points);
      return totals;
    }, { walk: 0, shared: 0, gap: 0 });
    if (distances.walk <= 0) return;
    const longestGap = route.filter(leg => leg.surface === 'gap').reduce<typeof route[number] | undefined>(
      (longest, leg) => !longest || lengthOf(leg.points) > lengthOf(longest.points) ? leg : longest, undefined);
    return { route, distances, longestGap };
  })() : undefined;
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
    const stationTrace = route.id === songpaStationRouteId ? songpaStationCrossings : undefined;
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
    function addLine(points: Point[], style: LineMaterial, surface?: (point: Point) => number,
      destination = surface ? pavingGuides : lines) {
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
      destination.add(line);
      return line;
    }
    const traceLift = 0.10;
    const surfaceGuide = ({ x, z }: Point) => (standingSurface?.(x, z) ?? grade(x, z)) + traceLift;
    const slopeLines: Partial<Record<RouteSlopeDirection, T.Group>> = {};
    if (gradeLine && profile?.survey) {
      const windows = { outbound: profile.steepest, returning: profile.returnSteepest } as const;
      for (const direction of ['outbound', 'returning'] as const) {
        const slope = windows[direction];
        if (!slope) continue;
        const highlight = new T.Group();
        highlight.visible = false;
        for (const line of slope.lines) {
          const segment = addLine(line, gradeLine, point => surfaceGuide(point) + 0.09, highlight);
          if (segment) segment.renderOrder = 4;
        }
        slopeLines[direction] = highlight;
        group.add(highlight);
      }
    }
    const parkGuide = route.parkEntrance && shortConnection;
    function addRouteLeg(points: Point[], style: LineMaterial) {
      if (stationTrace && shortConnection && points.length > 1) {
        const from = data.project(stationTrace.from);
        const to = data.project(stationTrace.to);
        const start = splitLineAt(points, from);
        const end = splitLineAt(start.after, to);
        if (lengthOf([from, start.point]) <= 0.2 && lengthOf([to, end.point]) <= 0.2) {
          addLine([...start.before.slice(0, -1), from], style, surfaceGuide);
          for (const leg of stationTrace.legs) {
            const legend = leg.surface === 'survey' ? recorded : leg.surface === 'aerial' ? aerialTrace ?? recorded : shortConnection;
            addLine(leg.coordinates.map(data.project), legend, surfaceGuide);
          }
          addLine([to, ...end.after.slice(1)], style, surfaceGuide);
          return;
        }
      }
      addLine(points, style);
    }
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
        addRouteLeg(line, style);
        return;
      }
      const start = splitLineAt(line, surveyedWalk[0]);
      const end = splitLineAt(start.after, surveyedWalk[surveyedWalk.length - 1]);
      if (!frontage) addLine([...start.before, surveyedWalk[0]], shortConnection);
      addLine(surveyedWalk, recorded, surfaceGuide);
      addLine([surveyedWalk[surveyedWalk.length - 1], end.point], shortConnection, stationTrace ? surfaceGuide : undefined);
      addRouteLeg(end.after, style);
    });
    if (route.stopView && shortConnection) addLine(songpaHomeLinks.gateApproach.coordinates.map(data.project), shortConnection, surfaceGuide);
    const driveway = site.paving?.drivewayCenterline;
    const homeWalk = aerialTrace && shortConnection && driveway && driveway.length >= 2
      && stationRoute ? (() => {
      const nearStation = songpaHomeLinks.stationExit.coordinates.map(data.project);
      const nearGate = songpaHomeLinks.gateApproach.coordinates.map(data.project);
      if (!inner || !arrival) return null;
      // Follow the same sampled curve used for the visible driveway.
      const join = driveway.slice(1).reduce((best, end, index) => {
        const candidate = nearestOnLine(arrival, [[driveway[index], end]]);
        return candidate.distance < best.distance ? { index, ...candidate } : best;
      }, { index: 0, point: driveway[0], distance: Infinity });
      const gateLink = frontage ? [frontage.at(-1)!, ...songpaGrounds.gateWalkLink.map(data.project)] : nearGate;
      const gate = gateLink.at(-1)!;
      const inside = frontage ? [gate, arrival] : [gate, ...driveway.slice(0, join.index + 1), join.point, arrival];
      const gateLinkM = Math.round(lengthOf(gateLink));
      const frontageFocus = frontage?.find(point => Math.hypot(point.x - frontage[0].x, point.z - frontage[0].z) >= 4);
      addLine(nearStation, recorded, surfaceGuide);
      if (frontage) addLine(frontage, aerialTrace, surfaceGuide);
      addLine(gateLink, shortConnection, surfaceGuide);
      addLine(inside, aerialTrace, surfaceGuide);
      if (gardenWalk && sharedPaving) for (const leg of gardenWalk.route) {
        const styles = { walk: aerialTrace, shared: sharedPaving, gap: shortConnection };
        addLine(leg.points, styles[leg.surface], surfaceGuide);
      }
      const at = (id: string, name: string, evidence: string, position: Point, toward: Point) => ({
        id, name, evidence, position,
        bearing: bearingTo(position, toward),
      });
      const uphill = profile?.returnSteepest;
      const elevator = data.project(songpaStationAccess.elevatorLocation.coordinate);
      const elevatorFrom = data.project(songpaStationAccess.elevatorLocation.viewFrom);
      const signalArchive = stationTrace ? data.pedestrianSignals : null;
      const signalCrossings = signalArchive?.crossings.filter(record =>
        stationTrace?.crossings.some(({ ufid }) => ufid === record.ufid)) ?? [];
      const signalView = signalCrossings.find(record => record.returnView && record.heads.length)?.returnView;
      const crossingLandings = stationTrace?.crossings.map(({ ufid }) => signalCrossings.find(record => record.ufid === ufid)?.landings) ?? [];
      const longestGap = crossingLandings.flatMap(pair => pair ?? []).reduce<CrossingLanding | undefined>((best, landing) =>
        landing.view && landing.gapM !== null && landing.gapM > (best?.gapM ?? 0) ? landing : best, undefined);
      const intermediate = [];
      if (uphill) intermediate.push({
        distance: uphill.end,
        id: 'return-uphill', name: '귀갓길에서 가장 가파른 30m', evidence: `서울시 표고 기반 모델 · 약 ${uphill.gradient.toFixed(1)}%`,
        ...uphill.view,
      });
      if (stationTrace) {
        const view = signalView ?? stationTrace.view;
        const position = data.project(view.position);
        intermediate.push({
          distance: signalView ? lengthOf(splitLineAt(projected.flat(), position).before) : stationTrace.view.distance,
          ...at('yangjae-crossing', '양재대로 횡단보도', signalView
            ? '교통섬 양쪽 보행등 위치는 서울시 자료 · 설치 모형 · 실제 신호 타이밍과 턱은 현장 확인'
            : '교통섬 2곳은 서울시 도형 · 섬 안 보행로는 항공영상 기준 · 신호와 턱은 현장 확인',
            position, data.project(view.toward)),
        });
      }
      if (longestGap?.view && longestGap.gapM !== null) {
        const position = data.project(longestGap.view.position);
        intermediate.push({
          distance: lengthOf(splitLineAt(projected.flat(), position).before),
          ...at('crossing-landing-gap', '양재대로 도색과 보도 경계',
            `도색 끝에서 ${longestGap.surface === 'island' ? '교통섬' : '보도'} 시작까지 경로상 약 ${longestGap.gapM.toFixed(1)}m · 턱과 경사로는 현장 확인`,
            position, data.project(longestGap.view.toward)),
        });
      }
      intermediate.sort((a, b) => b.distance - a.distance);
      return {
        insideM: Math.round(lengthOf(inside)),
        gardenDistances: gardenWalk?.distances ?? null,
        frontageM: frontage ? Math.round(lengthOf(frontage)) : null,
        gateLinkM,
        crossingLandings: crossingLandings.some(Boolean) ? {
          pairs: crossingLandings, rangeM: signalArchive?.landingRangeM ?? 6, hasView: Boolean(longestGap?.view),
        } : null,
        crossingSignals: signalArchive && signalCrossings.length > 0 ? {
          installed: signalCrossings.filter(record => record.installed === true).length,
          absent: signalCrossings.filter(record => record.installed === false).length,
          unknown: signalCrossings.filter(record => record.installed === null).length,
          heads: signalCrossings.reduce((total, record) => total + record.heads.length, 0),
          inventorySource: signalArchive.inventorySource,
          inventoryRecorded: signalArchive.inventoryRecorded,
          poleSource: signalArchive.poleSource,
          poleFileUpdated: signalArchive.poleFileUpdated,
          viewReady: Boolean(signalView),
        } : null,
        elevator: {
          position: elevatorFrom, bearing: bearingTo(elevatorFrom, elevator),
          target: new T.Vector3(elevator.x, surfaceGuide(elevator) + 2.2, elevator.z),
        },
        stops: [
          at('station-exit', '송파역 2번 출구 위치', `역 안내도상 계단 · 출구 앞 약 ${songpaHomeLinks.stationExit.lengthM}m는 서울시 보도면 안 · 실제 턱과 통행 폭은 현장 확인`,
            nearStation[0], nearStation[1]),
          ...intermediate,
          frontage ? at('front-junction', '단지 앞 교차점 보도',
            `${songpaEntrance.capturedIn} 로드뷰에서 정문 블록 포장까지 보도 확인 · 실제 폭과 턱 높이는 현장 확인`,
            frontage[0], frontageFocus ?? frontage.at(-1)!)
            : at('front-junction', '단지 앞 교차점', `정문 방향 약 ${gateLinkM}m · 보도 연결과 단차 미확인`, nearGate[0], nearGate[1]),
          at('main-gate', '정문 접근로', '차단기 옆 포장은 영상으로 확인했어요. 실제 보행 동선과 개방 여부는 현장 확인이 필요해요.',
            site.gateView ?? data.project(songpaEntrance.main.position), data.project(songpaEntrance.main.lookAt)),
          at(inner.id, inner.name, '항공영상 기반 포장 공간 근사 · 차량 통행과 단차는 현장 확인',
            arrival, gardenWalk?.route[0]?.points[4] ?? data.project(inner.lookAt)),
          ...(gardenWalk?.longestGap ? [
            at('courtyard-gap', '산책로 접속 확인 지점',
              `이 앞 약 ${Math.round(lengthOf(gardenWalk.longestGap.points))}m는 포장·보행 연결 미확인 · 안내선은 두 포장 사이의 모델상 연결`,
              gardenWalk.longestGap.points[0], gardenWalk.longestGap.points.at(-1)!),
          ] : []),
          ...(gardenWalk && garden && gardenPosition ? [
            at('courtyard-walk', garden.name, '서울시 도형과 항공영상에 근거한 산책로 · 동 출입문, 차량 통행과 단차는 현장 확인',
              gardenPosition, data.project(garden.lookAt)),
          ] : []),
        ],
      };
    })() : null;
    for (const crossing of route.crossings ?? []) {
      const parkCrossing = parkGuide && (crossing.wayId === 544143915 ? songiParkSurvey.crosswalks[0]
        : crossing.wayId === 544143913 ? songiParkSurvey.crosswalks[1] : undefined);
      const surveyedCrossing = stationTrace?.crossings.find(item => item.wayId === crossing.wayId) || parkCrossing;
      const a = data.project(surveyedCrossing ? surveyedCrossing.start : crossing.coordinate);
      const b = surveyedCrossing ? data.project(surveyedCrossing.end) : a;
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
    return { id: route.id, name: route.name, group, lines, pavingGuides, slopeLines, bounds, endpoint, entranceLabel, entranceView, routePoints, profile,
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
    mark(id: string | null, index: number, direction: RouteSlopeDirection | null) {
      const layer = layers.find(layer => layer.id === id);
      const sample = layer?.profile?.samples[index];
      for (const item of layers) {
        for (const [key, highlight] of Object.entries(item.slopeLines)) {
          highlight.visible = item === layer && item.group.visible && key === direction;
        }
      }
      const interval = direction === 'outbound' ? layer?.profile?.steepest
        : direction === 'returning' ? layer?.profile?.returnSteepest : undefined;
      const position = interval?.view.position ?? sample?.position;
      marker.visible = Boolean(layer?.group.visible && position);
      if (!position || !marker.visible) return;
      const { x, z } = position;
      marker.position.set(x, data.ground(x, z) + 1.6, z);
      markerLabelPoint.copy(marker.position).add(new T.Vector3(0, 24, 0));
      return interval;
    },
    show(id: string | null) {
      for (const layer of layers) layer.group.visible = layer.id === id;
      marker.visible = false;
      return layers.find(layer => layer.id === id);
    },
  };
}
