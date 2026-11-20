import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeCar } from './opo-vehicle';
import { buildingCollision, extent, inShape, nearestOnLine, precinct, splitLineAt, type OpoData, type Point } from './opo-data';
import { addCourtyard, courtyard, courtyardGarden, courtyardOpening, inCourtyardRing } from './opo-courtyard';
import { addOpoEntrance } from './opo-entrance';
import { courtyardStairs } from './opo-garden';
import { directionProfile, firstBuildingAhead } from './opo-horizon';
import { facadeViews, type FacadeView } from './opo-facades';
import { createLightPath } from './opo-light-path';
import { createTourMaterials, detailGround } from './opo-materials';
import { addEnvironment, buildMeshes, createTerrainProjection, makeGround } from './opo-meshes';
import { createTourSky } from './opo-sky';
import { createLightAnalyzer, nearSurfaceHeight, observationHeight, sunAt } from './opo-sunlight';
import { addGreenAccess, addSiteDetails, addSongpaAmbientMap, addSongpaSchoolMap, approach, playgroundReference } from './opo-site';
import { addSongpaFloodMap } from './opo-flood';
import type { FloodView } from './data/songpa-flood';
import { addStreets } from './opo-streets';
import { createSunMap, sunGridPoints, type SunMapCounts } from './opo-sun-map';
import { readTreeCover } from './opo-tree-cover';
import { createStreetOcclusion } from './opo-contact-shadows';
import { addStreetLights } from './opo-street-lights';
import { createStudyShadows } from './opo-study-shadows';
import type { TourPeer, TourPose } from './tour-live-types';
import { songpaComplex } from './data/regions';
import { songpaSchool } from './data/songpa-school';
import { songiPark } from './data/songi-park';
import { sampleWinterPixel, winterCapturePoints } from './data/songpa-winter-capture';
import { songpaCourtyard, songpaGrounds, type SongpaGroundView } from './data/songpa-grounds';
import { songpaEntrance } from './data/songpa-entrance';
import { songpaStreets } from './data/songpa-streets';
import { ambientFixtures, ambientStationDistance } from './data/songpa-ambient';

export type ViewMode = 'orbit' | 'walk' | 'drive';
export type Slot = 'A' | 'B';
export type SitePoint = Point & { id: string; label: string };
const roadEntry = [127.16554, 37.351224];
const routePlaces = ['수레실.오포롯데캐슬', '능평도서관', '용상골현대아파트', '현동빌라'];
const headingTo = (from: Point, to: Point) => Math.atan2(to.x - from.x, from.z - to.z);
const eyeFov = 60;
// The foot rests above the avatar group's origin.
const playerFootHeight = 0.16;

function makePlayer() {
  const player = new T.Group();
  const coat = new T.MeshStandardMaterial({ color: '#c07246', roughness: 0.9 });
  const pants = new T.MeshStandardMaterial({ color: '#344248', roughness: 0.95 });
  const skin = new T.MeshStandardMaterial({ color: '#deae87', roughness: 0.95 });
  const torso = new T.Mesh(new T.CapsuleGeometry(0.23, 0.37, 6, 12), coat);
  torso.position.y = 1.13;
  const head = new T.Mesh(new T.SphereGeometry(0.18, 12, 9), skin);
  head.position.y = 1.65;
  const hat = new T.Mesh(new T.SphereGeometry(0.192, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.52), pants);
  hat.position.y = 1.71;
  const backpack = new T.Mesh(new T.BoxGeometry(0.33, 0.44, 0.19), pants);
  backpack.position.set(0, 1.12, 0.23);
  const legs = [-0.12, 0.12].map(x => {
    const leg = new T.Group();
    leg.position.set(x, 0.8, 0);
    const ankle = new T.Mesh(new T.CapsuleGeometry(0.088, 0.48, 5, 8), pants);
    ankle.position.y = -0.31;
    leg.add(ankle);
    return leg;
  });
  player.add(torso, head, hat, backpack, ...legs);
  player.traverse(object => { if (object instanceof T.Mesh) object.castShadow = true; });
  return { player, legs };
}

export function openOpoWorld(host: HTMLDivElement, data: OpoData, onPick: (position: Point, source?: 'sun-grid') => void) {
  const isOpo = data.region === 'opo';
  const scene = new T.Scene();
  scene.background = new T.Color('#354D65');
  const fogDensity = isOpo ? 0.00112 : 0.00025;
  scene.fog = new T.FogExp2('#354D65', fogDensity);
  const streetNear = 0.25;
  // Give near-coplanar terrain and pavement more depth precision in the aerial view.
  const orbitNear = isOpo ? streetNear : 4;
  const camera = new T.PerspectiveCamera(49, 1, orbitNear, 8000);
  const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.65));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  renderer.domElement.setAttribute('aria-label', `${data.area.name} 3D 공간`);
  renderer.domElement.tabIndex = 0;
  renderer.domElement.dataset.world = data.region;
  host.appendChild(renderer.domElement);

  const smallScreen = window.innerWidth < 720;
  const streetOcclusion = isOpo && !smallScreen ? createStreetOcclusion(renderer, scene, camera) : undefined;
  const finish = createTourMaterials(Math.min(renderer.capabilities.getMaxAnisotropy(), 8), !smallScreen);
  const sky = createTourSky(scene);
  const fog = scene.fog as T.FogExp2;
  sky?.light(new T.Vector3(-0.5, 0.5, 0.5).normalize(), 0.5, fog.color);
  const sun = new T.DirectionalLight('#F8E9C6', 2.35);
  sun.castShadow = true;
  const shadowResolution = smallScreen ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowResolution, shadowResolution);
  Object.assign(sun.shadow.camera, { left: -250, right: 250, top: 250, bottom: -250, near: 1, far: 1200 });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.16;
  const ambient = new T.HemisphereLight('#D8D5F0', '#17243A', 1.8);
  scene.add(sun, sun.target, ambient);
  const terrain = makeGround(data);
  const terrainProjection = isOpo ? undefined : createTerrainProjection(terrain.geometry);
  terrain.castShadow = true;
  scene.add(terrain);
  const { occluders, anchors, roofs } = buildMeshes(data, scene);
  const insideBuilding = buildingCollision(data.buildings);
  const streets = addStreets(data, scene, finish, terrainProjection, insideBuilding);
  const entrance = isOpo ? addOpoEntrance(data, scene, streets.surface, finish) : undefined;
  const treeCover = data.treeCover ? readTreeCover(data.treeCover) : null;
  const treeCoverOverlay = treeCover?.overlay(terrain.geometry);
  if (treeCoverOverlay) scene.add(treeCoverOverlay);
  const site = addSiteDetails(data, scene, streets.surface, finish, streets.streetClearance, insideBuilding, terrainProjection);
  streets.addSurveyedPaint(site.paving?.asphaltDecks);
  const environment = addEnvironment(data, scene, terrainProjection, finish, point => {
    const road = streets.nearest(point, 14);
    return entrance?.paved(point) || site.paving?.elevation(point) !== undefined || streets.sidewalkElevation(point) !== undefined || insideBuilding(point)
      || (isOpo ? road !== undefined && road.distance <= road.segment.width / 2 + 0.4 : streets.roadClearance(point) <= 0.4);
  }, treeCover ?? undefined, new Map([...streets.municipalTreeHeights, ...(site.paving?.sidewalkTreeHeights ?? [])]));
  terrainProjection?.clear();
  const groundDetail = environment.grassTexture && detailGround(terrain.material, environment.grassTexture, isOpo ? courtyardOpening : undefined);
  const ambientMap = isOpo ? undefined : addSongpaAmbientMap(data, scene, streets.surface);
  const floodMap = isOpo ? undefined : addSongpaFloodMap(data, scene, streets.surface);
  const schoolMap = isOpo ? undefined : addSongpaSchoolMap(data, scene, streets.surface);
  const garden = isOpo ? addCourtyard(scene, streets.surface, finish, environment.waterNormal) : undefined;
  const modeledElevation = (point: Point) => entrance?.elevation(point) ?? garden?.elevation(point);
  function walkDeck(point: Point, ground: number) {
    const paved = site.paving?.elevation(point) ?? streets.sidewalkElevation(point);
    if (streets.streetClearance(point) <= 0) {
      return Math.max(paved ?? ground, ground + streets.deckLift);
    }
    return paved;
  }
  function walkFloor(point: Point, ground: number) {
    return isOpo ? modeledElevation(point) : walkDeck(point, ground);
  }
  function observationSurface(x: number, z: number) {
    const ground = streets.surface(x, z);
    return isOpo ? ground : walkFloor({ x, z }, ground) ?? ground;
  }
  const streetLights = isOpo ? undefined : addStreetLights(scene, ambientFixtures.flatMap(({ kind, coordinate }) => {
    const position = data.project(coordinate);
    if (insideBuilding(position) || streets.roadClearance(position) < 0.02 || site.paving?.fenced(position)) return [];
    return [{ kind, position, toward: streets.nearest(position, 32)?.point }];
  }), observationSurface, smallScreen ? 3 : 4);
  const greenAccess = addGreenAccess(data, scene, streets.surface, site, observationSurface);
  const schoolCrossing = greenAccess.layers.find(layer => layer.id === songpaSchool.routeId)?.crossingView;
  const parkViews = isOpo ? [] : [songiPark.crossingView, ...songiPark.views].map(({ name, coordinate, toward }) => {
    const position = data.project(coordinate);
    const bearing = T.MathUtils.radToDeg(headingTo(position, data.project(toward)) - data.northOffset);
    return { name, position, bearing };
  });
  scene.updateMatrixWorld(true);
  const analysis = createLightAnalyzer(data, terrain, occluders, observationSurface);
  const lightPath = createLightPath(scene, [terrain, ...occluders]);

  const endOfTile = ({ x, z }: Point) => Math.abs(x) > extent - 20 || Math.abs(z) > extent - 20;
  const occupied = (point: Point) => insideBuilding(point) || (isOpo && inCourtyardRing(point))
    || Boolean(entrance?.occupied(point) || garden?.blocked(point) || site.paving?.fenced(point));
  const blockedForMovement = (point: Point) => occupied(point) || site.paving?.parked(point);
  const analysisRadius = isOpo ? Math.min(precinct, data.buildingRadius) : data.buildingRadius;
  const canAnalyze = (point: Point) => !occupied(point) && Math.hypot(point.x, point.z) <= analysisRadius;
  const siteSamples = data.siteOutline.length ? sunGridPoints(data.siteOutline, canAnalyze) : [];
  const sunMap = siteSamples.length ? createSunMap(scene, data.siteOutline, siteSamples, observationSurface) : undefined;
  const roadSpawn = streets.nearest(data.project(isOpo ? roadEntry : songpaComplex.roadside), 64);
  if (!roadSpawn) throw new Error('임장 구역의 도로 시작 위치를 찾을 수 없어요.');
  const frontageStart = site.frontage && splitLineAt(site.frontage, data.project(songpaEntrance.frontage.walkStart));
  const spawn = frontageStart && !occupied(frontageStart.point) ? frontageStart.point : roadSpawn.point;
  const approachPoint = isOpo ? data.project(approach) : roadSpawn.point;
  const frontageAhead = frontageStart?.after.find(point => Math.hypot(point.x - spawn.x, point.z - spawn.z) >= 8);
  const roadLookAt = isOpo ? entrance?.gate ?? approachPoint : data.project(songpaComplex.lookAt);
  const lookAt = spawn === frontageStart?.point && frontageAhead ? frontageAhead : roadLookAt;
  const initialHeading = headingTo(spawn, lookAt);
  const pavingStops = isOpo ? [] : [...songpaGrounds.points, ...songpaCourtyard.views].map((point: SongpaGroundView) => {
    const samplePosition = data.project(point.coordinate);
    const position = point.viewFrom ? data.project(point.viewFrom) : samplePosition;
    return { id: point.id, name: point.name, position, samplePosition, lookAt: data.project(point.lookAt) };
  }).filter(point => canAnalyze(point.position) && inShape(point.position, [data.siteOutline]));
  const entranceStops = isOpo ? [] : [songpaEntrance.main, songpaEntrance.garage].map(stop => ({
    id: stop.id, name: stop.name,
    position: stop.id === songpaEntrance.main.id && site.gateView ? site.gateView : data.project(stop.position),
    samplePosition: data.project(stop.position), lookAt: data.project(stop.lookAt),
  })).filter(stop => !occupied(stop.position));
  const streetViews = isOpo ? [] : songpaStreets.views.map(stop => ({
    id: stop.id, name: stop.name, position: data.project(stop.position), lookAt: data.project(stop.lookAt),
  })).filter(stop => !occupied(stop.position));
  const roadsideViews = [...entranceStops, ...streetViews];
  const destinations: { id: string; name: string; position: Point; lookAt?: Point }[] = isOpo ? [
    { id: 'approach', name: '오포 롯데캐슬 정문·진입교', position: approachPoint },
    courtyard,
    courtyardGarden,
    courtyardStairs,
    ...routePlaces.flatMap(name => {
      const place = data.streetPoints.find(item => item.name === name);
      return place ? [{ id: place.id, name, position: place.position }] : [];
    }),
  ] : [{ id: 'approach', name: songpaComplex.roadName, position: spawn, lookAt }, ...streetViews, ...entranceStops, ...pavingStops];
  const tripStops = ['approach', ...destinations.filter(place => routePlaces.slice(0, 2).includes(place.name)).map(place => place.id)]
    .map(id => destinations.find(place => place.id === id))
    .flatMap(place => {
      const road = place && streets.nearest(place.position, 64);
      return road ? [road] : [];
    });
  const tripRoute = tripStops.length === 3
    ? [streets.route(tripStops[0], tripStops[1]), streets.route(tripStops[1], tripStops[2])] : [];
  const tripLine = tripRoute.length === 2 && tripRoute.every(leg => leg.length > 1)
    ? [...tripRoute[0], ...tripRoute[1].slice(1)] : [];
  const tripLength = Math.round(tripLine.reduce((sum, point, i) => {
    const prior = tripLine[i - 1];
    return prior ? sum + Math.hypot(point.x - prior.x, point.z - prior.z) : sum;
  }, 0));
  let position = spawn;
  let speed = 0;
  let travelSpeed = 0;
  let heading = initialHeading;
  let viewAngle = 0;
  let pitch = 0.17;
  let cameraDistance = 1;
  let walkingTo: Point | null = null;
  let sprinting = false;
  let stickX = 0, stickY = 0;
  let mode: ViewMode = 'orbit';
  let eyeLevel = false;
  let studyingSunlight = false;
  let walkingAtEyeLevel = true;
  const firstPerson = () => eyeLevel || (mode === 'walk' && walkingAtEyeLevel);
  let selecting = false;
  let active = true;
  let satelliteTexture: T.Texture | null = null;
  let terrainPhoto: T.CanvasTexture | null = null;
  let satelliteLoading: Promise<T.Texture> | null = null;
  let showingSatellite = false;
  let driveSegment = roadSpawn.segment;
  let tripIndex = 0;
  const sunDirection = new T.Vector3(-200, 300, 100).normalize();
  const shadowFocus = new T.Vector3(Infinity, 0, Infinity);
  const shadowActor = new T.Vector3(Infinity, 0, Infinity);
  let lastShadow = -Infinity;
  let aerialShadows = false;
  const { player, legs } = makePlayer();
  const car = makeCar();
  scene.add(player, car);
  player.visible = false;
  car.visible = false;
  const studyShadows = createStudyShadows(scene, terrain, occluders);

  function satelliteImage() {
    if (satelliteLoading) return satelliteLoading;
    satelliteLoading = new T.TextureLoader().loadAsync('/opo-sentinel.png').then(texture => {
      if (!active) { texture.dispose(); return texture; }
      texture.colorSpace = T.SRGBColorSpace;
      texture.anisotropy = 4;
      satelliteTexture = texture;
      return texture;
    }).catch(error => { satelliteLoading = null; throw error; });
    return satelliteLoading;
  }
  if (isOpo) void satelliteImage().then(texture => {
    if (!active) return;
    const image = texture.image as HTMLImageElement;
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#f4f0df';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 0.49;
    ctx.drawImage(image, 0, 0);
    terrainPhoto = new T.CanvasTexture(canvas);
    terrainPhoto.colorSpace = T.SRGBColorSpace;
    terrainPhoto.anisotropy = 4;
    if (!showingSatellite) {
      terrain.material.map = terrainPhoto;
      terrain.material.needsUpdate = true;
    }
  }).catch(() => { /* The terrain colors remain usable while the imagery asset is unavailable. */ });

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 52;
  controls.maxDistance = 4800;
  controls.zoomToCursor = true;
  const apartmentBounds = new T.Box3();
  for (const { building, point } of anchors) {
    const roofY = point.y - 7;
    for (const [outline] of building.shapes) for (const { x, z } of outline) {
      apartmentBounds.expandByPoint(new T.Vector3(x, roofY, z));
      apartmentBounds.expandByPoint(new T.Vector3(x, roofY - (building.height ?? 0), z));
    }
  }
  function overview() {
    if (!isOpo && apartmentBounds.isEmpty()) {
      controls.target.set(0, 8, 0);
      camera.position.set(430, 640, 830);
      controls.update();
      return;
    }
    const sphere = apartmentBounds.isEmpty()
      ? new T.Sphere(new T.Vector3(45, 6, 0), 95) : apartmentBounds.getBoundingSphere(new T.Sphere());
    const halfFov = T.MathUtils.degToRad(camera.fov / 2);
    const aspect = host.clientWidth / Math.max(1, host.clientHeight);
    const halfAngle = Math.min(halfFov, Math.atan(Math.tan(halfFov) * aspect));
    const distance = Math.max(260, (sphere.radius + 14) / Math.sin(halfAngle * 0.82));
    controls.target.copy(sphere.center);
    camera.position.copy(sphere.center).addScaledVector(new T.Vector3(150, 170, 260).normalize(), distance);
    controls.update();
  }
  overview();

  function frameSurface(points: T.Vector3[], center: T.Vector3, offset: T.Vector3,
    { clearTitle = false, reserveLabels = false } = {}) {
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
    const panel = host.parentElement?.querySelector<HTMLElement>('.analysis');
    const availableWidth = panel && width > 780 ? panel.offsetLeft : width;
    const controlsTop = reserveLabels ? host.parentElement?.querySelector<HTMLElement>('.view-controls')?.offsetTop : undefined;
    const bottom = Math.min(panel && width <= 780 ? panel.offsetTop : height, controlsTop ?? height);
    const title = clearTitle && (width <= 780 || reserveLabels) && host.parentElement?.querySelector<HTMLElement>('.tour-title');
    const top = Math.min(Math.max(0, bottom - 130), title ? title.offsetTop + title.offsetHeight + 6 : 0);
    const availableHeight = bottom - top;
    const horizontalFrame = 0.84 * Math.max(1, availableWidth - (reserveLabels ? 132 : 0)) / width;
    const verticalFrame = 0.82 * Math.max(1, availableHeight - (reserveLabels ? 48 : 0)) / height;
    camera.fov = 49;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    camera.position.copy(center).add(offset);
    const projection = new T.Vector3();
    for (let attempt = 0; attempt < 4; attempt++) {
      controls.update();
      camera.updateMatrixWorld(true);
      let frame = 1;
      for (const point of points) {
        projection.copy(point).project(camera);
        frame = Math.max(frame, Math.abs(projection.x) / horizontalFrame, Math.abs(projection.y) / verticalFrame);
      }
      if (frame <= 1.01) break;
      camera.position.sub(center).multiplyScalar(Math.min(2.1, frame * 1.04)).add(center);
    }
    if (!panel && !reserveLabels) return;
    const halfHeight = camera.position.distanceTo(center) * Math.tan(T.MathUtils.degToRad(camera.fov / 2));
    const shift = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
      .multiplyScalar(halfHeight * camera.aspect * (width - availableWidth) / width)
      .addScaledVector(new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 1), -halfHeight * (height - bottom - top) / height);
    controls.target.add(shift);
    camera.position.add(shift);
    controls.update();
  }

  function resize() {
    camera.aspect = host.clientWidth / Math.max(host.clientHeight, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(host.clientWidth, host.clientHeight);
    streetOcclusion?.resize(host.clientWidth, host.clientHeight);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  const comparisonMarkers = new T.Group();
  scene.add(comparisonMarkers);
  let ambientInspection = false;
  let guidedWalk = false;
  let browsingPlaces = false;
  let accessEntranceId: string | null = null;
  const analysisMapVisible = () => ambientMap?.group.visible || floodMap?.group.visible || schoolMap?.group.visible;
  const updateComparisonMarkers = () => {
    comparisonMarkers.visible = !ambientInspection && !guidedWalk && !browsingPlaces && !analysisMapVisible() && !lightPath.group.visible;
  };
  const markers = Object.fromEntries((['A', 'B'] as const).map((slot, index) => {
    const group = new T.Group();
    const color = index === 0 ? '#e5ae45' : '#407b7b';
    const circle = new T.Mesh(new T.RingGeometry(1.7, 2.14, 28), new T.MeshBasicMaterial({ color, side: T.DoubleSide }));
    circle.rotation.x = -Math.PI / 2;
    circle.position.y = 0.2;
    const pin = new T.Mesh(new T.ConeGeometry(0.84, 1.8, 8), new T.MeshBasicMaterial({ color }));
    pin.rotation.x = Math.PI;
    pin.position.y = 1.16;
    group.add(circle, pin);
    group.visible = false;
    comparisonMarkers.add(group);
    return [slot, group];
  })) as Record<Slot, T.Group>;
  const stepMarker = new T.Mesh(new T.RingGeometry(0.28, 0.42, 28),
    new T.MeshBasicMaterial({ color: '#f2dfad', side: T.DoubleSide }));
  stepMarker.rotation.x = -Math.PI / 2;
  stepMarker.visible = false;
  scene.add(stepMarker);

  const labels: { point: T.Vector3; element: HTMLSpanElement; enabled: () => boolean; keepInFrame?: boolean; limit?: number }[] = anchors.map(({ point, building }) => {
    const element = document.createElement('span');
    element.className = 'building-label';
    element.textContent = building.dong;
    host.appendChild(element);
    return { point, element, enabled: () => !browsingPlaces && !analysisMapVisible() };
  });
  const ambientLabels = (ambientMap?.labels ?? []).map(label => {
    const element = document.createElement('span');
    element.className = `building-label ${label.kind === 'station' ? 'ambient-sensor-label' : 'ambient-stop-label'}`;
    element.textContent = label.name;
    element.hidden = true;
    host.appendChild(element);
    labels.push({ point: label.point, element, enabled: () => Boolean(ambientMap?.group.visible), keepInFrame: true });
    return { label, element };
  });
  const floodLabels = (floodMap?.labels ?? []).map(label => {
    const element = document.createElement('span');
    element.className = 'building-label flood-map-label';
    element.dataset.kind = label.kind;
    element.textContent = label.text;
    element.hidden = true;
    host.appendChild(element);
    labels.push({ point: label.point, element, enabled: () => Boolean(floodMap?.group.visible && label.enabled()), keepInFrame: true });
    return { label, element };
  });
  for (const label of schoolMap?.labels ?? []) {
    const element = document.createElement('span');
    element.className = `building-label school-map-label school-map-${label.kind}`;
    element.textContent = label.text;
    element.hidden = true;
    host.appendChild(element);
    labels.push({ point: label.point, element, enabled: () => Boolean(schoolMap?.group.visible), keepInFrame: true });
  }
  for (const stop of pavingStops) {
    const element = document.createElement('span');
    element.className = 'building-label street-label';
    element.textContent = stop.name;
    element.hidden = true;
    host.appendChild(element);
    const { x, z } = stop.position;
    labels.push({ point: new T.Vector3(x, streets.surface(x, z) + 3, z), element, limit: 95,
      enabled: () => (mode === 'orbit' && site.overlay.visible)
        || (mode === 'walk' && Math.hypot(x - position.x, z - position.z) > 9) });
  }
  const peers = new Map<string, {
    walker: T.Group; vehicle: T.Group; pose: TourPose;
    label: typeof labels[number];
  }>();
  function removePeer(id: string) {
    const peer = peers.get(id);
    if (!peer) return;
    peer.walker.removeFromParent();
    peer.vehicle.removeFromParent();
    peer.label.element.remove();
    labels.splice(labels.indexOf(peer.label), 1);
    peers.delete(id);
  }
  function showPeer({ id, name, pose }: TourPeer) {
    if (!pose) return;
    const existing = peers.get(id);
    if (existing) { existing.pose = pose; return; }
    // Clone the actors so touring visitors share the world geometry and materials.
    const walker = player.clone(), vehicle = car.clone();
    for (const actor of [walker, vehicle]) {
      actor.position.set(pose.x, 0, pose.z);
      actor.rotation.y = -pose.heading;
      actor.traverse(object => { object.castShadow = false; });
    }
    scene.add(walker, vehicle);
    const element = document.createElement('span');
    element.className = 'building-label tour-live-name';
    element.textContent = name;
    element.hidden = true;
    host.appendChild(element);
    const label = { point: new T.Vector3(), element, enabled: () => true, limit: 500 };
    labels.push(label);
    peers.set(id, { walker, vehicle, pose, label });
  }
  const lightPathLabel = document.createElement('span');
  lightPathLabel.className = 'building-label light-path-label';
  lightPathLabel.hidden = true;
  host.appendChild(lightPathLabel);
  const lightOriginLabel = document.createElement('span');
  lightOriginLabel.className = 'building-label light-path-origin';
  lightOriginLabel.hidden = true;
  host.appendChild(lightOriginLabel);
  const lightPathVisible = () => lightPath.group.visible;
  labels.push({ point: lightPath.labelPoint, element: lightPathLabel, enabled: lightPathVisible, keepInFrame: true },
    { point: lightPath.originPoint, element: lightOriginLabel, enabled: lightPathVisible, keepInFrame: true });
  const placeGroup = new T.Group();
  scene.add(placeGroup);
  const placeOverlay = document.createElement('div');
  placeOverlay.hidden = true;
  placeOverlay.setAttribute('aria-hidden', 'true');
  host.appendChild(placeOverlay);
  const markerShape = new T.SphereGeometry(3.2, 10, 8);
  function placeMarker({ x, z }: Point, label: string, kind: string, color: string) {
    const pin = new T.Mesh(markerShape, new T.MeshBasicMaterial({ color, depthTest: false, depthWrite: false }));
    pin.renderOrder = 4;
    pin.position.set(x, observationSurface(x, z) + 8, z);
    pin.visible = false;
    placeGroup.add(pin);
    const element = document.createElement('span');
    element.className = `building-label place-label place-${kind}`;
    element.textContent = label;
    element.style.visibility = 'hidden';
    placeOverlay.appendChild(element);
    return { pin, element, width: 0, height: 0 };
  }
  const placeOriginMarker = placeMarker(data.placeOrigin.point, data.placeOrigin.label, 'origin', '#ffd28f');
  placeOriginMarker.pin.scale.setScalar(1.5);
  placeOriginMarker.pin.renderOrder = 5;
  const placeMarkers = data.places.map(place => ({
    place, ...placeMarker(place.point, place.name, place.category,
      place.category === 'school' ? '#d8d5f0' : place.category === 'beauty' ? '#f8e9c6' : '#76c9bc'),
  }));
  let visiblePlaceMarkers: ReturnType<typeof placeMarker>[] = [];
  type LabelRect = { left: number; right: number; top: number; bottom: number };

  function updatePlaceLabels() {
    placeOverlay.hidden = !placeGroup.visible || !browsingPlaces;
    if (placeOverlay.hidden) return;
    const { clientWidth: width, clientHeight: height } = host;
    const frame = host.getBoundingClientRect();
    const obstructions: LabelRect[] = [];
    for (const node of host.parentElement?.querySelectorAll('.tour-title, .analysis, .analysis-toggle, .view-controls') ?? []) {
      const bounds = node.getBoundingClientRect();
      if (!bounds.width || !bounds.height) continue;
      obstructions.push({ left: bounds.left - frame.left, right: bounds.right - frame.left,
        top: bounds.top - frame.top, bottom: bounds.bottom - frame.top });
    }
    for (const marker of visiblePlaceMarkers) {
      projected.copy(marker.pin.position).project(camera);
      let visible = projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1;
      if (visible) {
        marker.width ||= marker.element.offsetWidth;
        marker.height ||= marker.element.offsetHeight;
        const x = (projected.x * 0.5 + 0.5) * width;
        const y = (-projected.y * 0.5 + 0.5) * height - marker.height / 2 - 6;
        const rect = { left: x - marker.width / 2, right: x + marker.width / 2,
          top: y - marker.height / 2, bottom: y + marker.height / 2 };
        visible = rect.left >= 6 && rect.top >= 6 && rect.right <= width - 6 && rect.bottom <= height - 6
          && !obstructions.some(block => rect.left < block.right + 5 && rect.right > block.left - 5
            && rect.top < block.bottom + 5 && rect.bottom > block.top - 5);
        if (visible) {
          obstructions.push(rect);
          marker.element.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%)`;
        }
      }
      marker.element.style.visibility = visible ? 'visible' : 'hidden';
    }
  }
  function framePlaceMarkers(markers: typeof visiblePlaceMarkers, includeOrigin = true) {
    const points = (includeOrigin ? [placeOriginMarker, ...markers] : markers).map(marker => marker.pin.position);
    const bounds = new T.Box3().setFromPoints(points);
    const size = bounds.getSize(new T.Vector3());
    const distance = Math.max(135, Math.max(size.x, size.z) * 1.2);
    frameSurface(points, bounds.getCenter(new T.Vector3()), new T.Vector3(0, distance, distance * 0.30),
      { clearTitle: true, reserveLabels: true });
  }
  const pinLabels = (['A', 'B'] as const).map(slot => {
    const element = document.createElement('span');
    element.className = `building-label point-label point-${slot}`;
    element.textContent = slot;
    element.hidden = true;
    host.appendChild(element);
    const label = { point: new T.Vector3(), element, enabled: () => comparisonMarkers.visible && markers[slot].visible, slot };
    labels.push(label);
    return label;
  });
  if (isOpo) {
    const facilities = [
      { name: '놀이시설 등록 주소', position: data.project(playgroundReference), lift: 3.6 },
      { name: courtyard.name, position: courtyard.position, lift: 3, limit: 220 },
    ];
    for (const { name, position: { x, z }, lift, limit } of facilities) {
      const element = document.createElement('span');
      element.className = 'building-label facility-label';
      element.textContent = name;
      element.hidden = true;
      host.appendChild(element);
      labels.push({ point: new T.Vector3(x, streets.surface(x, z) + lift, z),
        element, enabled: () => site.overlay.visible, limit });
    }
  }
  for (const layer of greenAccess.layers) {
    const entranceView = layer.entranceView;
    const element = document.createElement('span');
    element.className = `building-label access-label${layer.entranceLabel ? ' access-entrance-label' : ''}`;
    element.textContent = entranceView ? `병원 보조출입구 · ${entranceView.referenceYear}년 조사`
      : data.region === 'songpa' ? layer.name : `${layer.name} 인근`;
    element.hidden = true;
    host.appendChild(element);
    const { x, z } = layer.endpoint;
    labels.push({ point: layer.entranceLabel ?? new T.Vector3(x, data.ground(x, z) + 5, z), element,
      enabled: () => layer.group.visible && mode === 'orbit' && (!greenAccess.marker.visible
        || Math.hypot(greenAccess.marker.position.x - x, greenAccess.marker.position.z - z) > 15), keepInFrame: true });
    if (entranceView) {
      const entrance = document.createElement('span');
      entrance.className = 'building-label access-entrance-label access-entrance-street';
      entrance.textContent = `보조출입구 조사 위치 · ${entranceView.referenceYear}년`;
      entrance.hidden = true;
      host.appendChild(entrance);
      labels.push({ point: entranceView.target, element: entrance, limit: 75,
        enabled: () => layer.group.visible && mode === 'walk' && accessEntranceId === layer.id });
    }
    const arrival = layer.homeWalk?.stops.at(-1);
    if (layer.homeWalk) {
      const elevator = document.createElement('span');
      elevator.className = 'building-label access-label';
      elevator.textContent = '송파역 지상 엘리베이터 · 서울시 지도 위치';
      elevator.hidden = true;
      host.appendChild(elevator);
      labels.push({ point: layer.homeWalk.elevator.target, element: elevator, limit: 32,
        enabled: () => layer.group.visible && mode === 'walk' });
    }
    if (arrival) {
      const mark = document.createElement('span');
      mark.className = 'building-label access-label';
      mark.textContent = '정문 · 단지 안 포장 공간';
      mark.hidden = true;
      host.appendChild(mark);
      const { x, z } = arrival.position;
      labels.push({ point: new T.Vector3(x, streets.surface(x, z) + 9, z), element: mark,
        enabled: () => layer.group.visible && mode === 'orbit', keepInFrame: true });
    }
  }
  const routeTerrainLabel = document.createElement('span');
  routeTerrainLabel.className = 'building-label route-terrain-label';
  routeTerrainLabel.hidden = true;
  host.appendChild(routeTerrainLabel);
  labels.push({ point: greenAccess.markerLabelPoint, element: routeTerrainLabel,
    enabled: () => mode === 'orbit' && greenAccess.marker.visible, keepInFrame: true });

  const labeledPlaces = data.streetPoints.filter(item => item.name
    && (item.kind === 'bus' || routePlaces.includes(item.name) || Math.hypot(item.position.x - spawn.x, item.position.z - spawn.z) < 720));
  for (const place of labeledPlaces) {
    const element = document.createElement('span');
    element.className = `building-label street-label${place.kind === 'bus' ? ' bus-label' : ''}`;
    element.textContent = place.name;
    element.hidden = true;
    host.appendChild(element);
    const { x, z } = place.position;
    labels.push({ point: new T.Vector3(x, streets.surface(x, z) + (place.kind === 'bus' ? 3.4 : 2.65), z),
      element, enabled: () => mode !== 'orbit' || destinations.some(placeInfo => placeInfo.id === place.id), limit: 110 });
  }

  const presets = anchors.map(({ building, point }) => {
    const outer = building.shapes[0][0];
    const north = Math.min(...outer.map(p => p.z));
    const south = Math.max(...outer.map(p => p.z));
    const candidates = [
      { x: point.x, z: north - 8 }, { x: point.x, z: south + 8 },
      { x: point.x, z: north - 15 }, { x: point.x, z: south + 15 },
    ];
    if (!isOpo) {
      const east = Math.max(...outer.map(p => p.x)), west = Math.min(...outer.map(p => p.x));
      candidates.push({ x: east + 6, z: point.z }, { x: west - 6, z: point.z });
    }
    const sample = candidates.find(p => canAnalyze(p) && (isOpo || !data.siteOutline.length || inShape(p, [data.siteOutline])))
      ?? candidates.find(canAnalyze);
    return sample ? { ...sample, id: building.dong, label: `${building.dong} 인근` } : null;
  }).filter((point): point is SitePoint => point !== null).sort((a, b) => a.id.localeCompare(b.id));
  if (isOpo) {
    if (!occupied(courtyard.position)) presets.push({ ...courtyard.position, id: courtyard.id, label: courtyard.name });
  } else if (!presets.length) {
    const candidates = data.streets.filter(road => road.motor).flatMap(road => road.points)
      .filter(p => Math.hypot(p.x, p.z) < 280 && !occupied(p))
      .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    const first = candidates[0];
    const second = first && candidates.find(p => Math.hypot(p.x-first.x, p.z-first.z) > 60);
    for (const [index, point] of [first, second].entries()) if (point) {
      presets.push({...point, id:`road-${index}`, label:`구역 도로 인근 ${index + 1}`});
    }
  }
  presets.push(...pavingStops.map(stop => ({ ...stop.samplePosition, id: stop.id, label: stop.name })));
  const gate = entranceStops.find(stop => stop.id === songpaEntrance.main.id && canAnalyze(stop.samplePosition));
  if (gate) presets.push({ ...gate.samplePosition, id: gate.id, label: gate.name });
  if (!isOpo) for (const { id, label, coordinate } of winterCapturePoints) {
    const point = data.project(coordinate);
    if (canAnalyze(point) && inShape(point, [data.siteOutline])) presets.push({ ...point, id, label });
  }
  const facades = isOpo ? [] : facadeViews(data, canAnalyze);
  presets.push(...facades);

  function setMode(next: ViewMode) {
    accessEntranceId = null;
    if (mode === next && !eyeLevel) return;
    const previous = mode;
    if (next === 'drive') {
      const entry = streets.nearest(position, 24) ?? roadSpawn;
      position = entry.point;
      driveSegment = entry.segment;
      const forward = headingTo(entry.segment.a, entry.segment.b);
      heading = Math.cos(heading - forward) >= 0 ? forward : forward + Math.PI;
    } else if (previous === 'drive') {
      const roadside = { x: position.x + Math.cos(heading) * 2.3, z: position.z + Math.sin(heading) * 2.3 };
      if (!occupied(roadside)) position = roadside;
    }
    mode = next;
    camera.near = next === 'orbit' ? orbitNear : streetNear;
    camera.updateProjectionMatrix();
    eyeLevel = false;
    tripIndex = 0;
    walkingTo = null;
    speed = 0;
    travelSpeed = 0;
    viewAngle = 0;
    pitch = 0.17;
    cameraDistance = 1;
    movement.clear();
    stickX = stickY = 0;
    player.visible = next === 'walk' && !firstPerson();
    car.visible = next === 'drive';
    greenAccess.marker.children.forEach(part => { part.visible = next === 'orbit'; });
    for (const layer of greenAccess.layers) {
      layer.group.children.forEach(part => { part.visible = next === 'orbit'; });
    }
    controls.enabled = next === 'orbit' && !selecting;
    if (next === 'orbit') overview();
  }

  function updateShadows(now: number) {
    if (!sun.castShadow) return;
    const aerial = mode === 'orbit';
    const x = aerial ? controls.target.x : position.x + Math.sin(heading) * 22;
    const z = aerial ? controls.target.z : position.z - Math.cos(heading) * 22;
    const radius = aerial ? 270 : smallScreen ? 78 : 94;
    if (aerial !== aerialShadows || Math.hypot(x - shadowFocus.x, z - shadowFocus.z) > radius * 0.28) {
      aerialShadows = aerial;
      shadowFocus.set(x, data.ground(x, z), z);
      sun.target.position.copy(shadowFocus);
      sun.position.copy(sunDirection).multiplyScalar(660).add(shadowFocus);
      Object.assign(sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius });
      sun.shadow.camera.updateProjectionMatrix();
      renderer.shadowMap.needsUpdate = true;
    }
    const actor = mode === 'drive' ? car : player;
    if (actor.visible && now - lastShadow > 130 && actor.position.distanceToSquared(shadowActor) > 0.35 ** 2) {
      lastShadow = now;
      shadowActor.copy(actor.position);
      renderer.shadowMap.needsUpdate = true;
    }
  }

  function showLightPath(location: SitePoint | null, date: string, minute: number, slot: Slot, focus = false) {
    if (!location) {
      lightPath.group.visible = false;
      updateComparisonMarkers();
      return;
    }
    const sample = analysis.at(location, date, minute);
    const origin = new T.Vector3(location.x, observationSurface(location.x, location.z) + observationHeight, location.z);
    const { direction } = sunAt(data, date, minute);
    lightPath.update(sample, origin, direction, slot);
    updateComparisonMarkers();
    lightOriginLabel.textContent = `${slot} · ${location.label}`;
    lightPathLabel.textContent = sample.obstruction ? `차폐 · ${sample.cause}`
      : sample.status === 'unknown' ? '차폐 미판정' : '태양 방향';
    lightOriginLabel.dataset.slot = slot;
    lightPathLabel.dataset.slot = slot;
    if (!focus || !lightPath.group.visible) return;
    setMode('orbit');
    const sphere = lightPath.bounds.getBoundingSphere(new T.Sphere());
    const panel = host.clientWidth > 780 ? host.parentElement?.querySelector<HTMLElement>('.analysis') : null;
    const availableWidth = panel?.offsetLeft ?? host.clientWidth;
    const halfFov = T.MathUtils.degToRad(camera.fov / 2);
    const halfAngle = Math.min(halfFov, Math.atan(Math.tan(halfFov) * availableWidth / host.clientHeight));
    const distance = Math.max(95, (sphere.radius + 12) / Math.sin(halfAngle * 0.85));
    controls.target.copy(sphere.center);
    const viewDirection = new T.Vector3(direction.z, 1, -direction.x).normalize();
    camera.position.copy(sphere.center).addScaledVector(viewDirection, distance);
    controls.update();
    if (panel) {
      const right = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const shift = distance * Math.tan(halfFov) * camera.aspect * (host.clientWidth - availableWidth) / host.clientWidth;
      controls.target.addScaledVector(right, shift);
      camera.position.addScaledVector(right, shift);
      controls.update();
    }
  }

  const movement = new Set<string>();
  const commands = new Map([
    ['KeyW', 'up'], ['ArrowUp', 'up'], ['KeyS', 'down'], ['ArrowDown', 'down'],
    ['KeyA', 'left'], ['ArrowLeft', 'left'], ['KeyD', 'right'], ['ArrowRight', 'right'],
  ]);
  function onKey(event: KeyboardEvent, press: boolean) {
    if (press && event.target instanceof HTMLElement && event.target.closest('dialog[open]')) return;
    if (event.key === 'Shift') sprinting = press;
    const command = commands.get(event.code);
    if (!command) return;
    if (!press) { movement.delete(command); return; }
    if (mode === 'orbit' || selecting || event.altKey || event.ctrlKey || event.metaKey ||
        (event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'SUMMARY'].includes(event.target.tagName))) return;
    event.preventDefault();
    movement.add(command);
  }
  const down = (event: KeyboardEvent) => onKey(event, true);
  const up = (event: KeyboardEvent) => onKey(event, false);
  const blur = () => { movement.clear(); sprinting = false; stickX = stickY = 0; };
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', blur);
  setMode('walk');

  const raycaster = new T.Raycaster();
  let drag: { id: number; x: number; y: number; distance: number } | null = null;
  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', event => {
    if ((!selecting && mode === 'orbit') || event.button !== 0 || drag) return;
    canvas.focus();
    canvas.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, distance: 0 };
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    drag.distance += Math.hypot(dx, dy);
    if (!selecting && drag.distance > 5) {
      if (firstPerson() && !eyeLevel) heading -= dx * 0.006;
      else viewAngle -= dx * 0.006;
      pitch = T.MathUtils.clamp(pitch + dy * 0.004, firstPerson() ? -0.63 : -0.05, 0.85);
    }
    drag.x = event.clientX; drag.y = event.clientY;
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('lostpointercapture', () => { drag = null; });
  canvas.addEventListener('wheel', event => {
    if (mode === 'orbit' || firstPerson() || selecting) return;
    event.preventDefault();
    cameraDistance = T.MathUtils.clamp(cameraDistance * Math.exp(event.deltaY * 0.0017), 0.72, 1.75);
  }, { passive: false });
  canvas.addEventListener('pointerup', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const click = drag.distance + Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 9;
    if (click && (selecting || mode === 'walk')) {
      const frame = canvas.getBoundingClientRect();
      const pointer = new T.Vector2((event.clientX - frame.left) / frame.width * 2 - 1, -((event.clientY - frame.top) / frame.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects([terrain, ...occluders], false)[0];
      if (selecting) {
        const sample = sunMap?.pick(raycaster, hit?.distance ?? Infinity);
        if (sample) onPick(sample, 'sun-grid');
        else if (hit) onPick({ x: hit.point.x, z: hit.point.z });
      }
      else if (hit?.object === terrain) {
        const goal = { x: hit.point.x, z: hit.point.z };
        const distance = Math.hypot(goal.x - position.x, goal.z - position.z);
        if (distance >= 0.5 && distance <= 85 && !endOfTile(goal) && !blockedForMovement(goal)) {
          walkingTo = goal;
          viewAngle = 0;
          const ground = streets.surface(goal.x, goal.z);
          const floor = (isOpo ? modeledElevation(goal) : walkDeck(goal, ground)) ?? ground + 0.50;
          stepMarker.position.set(goal.x, floor + 0.12, goal.z);
        }
      }
    }
    drag = null;
  });

  let last = performance.now();
  const target = new T.Vector3(), destination = new T.Vector3(), projected = new T.Vector3();
  renderer.setAnimationLoop(now => {
    const elapsed = Math.min(0.045, (now - last) / 1000);
    last = now;
    const fov = firstPerson() ? eyeFov : 49;
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    if (mode === 'orbit') controls.update();
    else {
      const driving = mode === 'drive';
      const move = selecting ? 0 : T.MathUtils.clamp(Number(movement.has('up')) - Number(movement.has('down')) - stickY, -1, 1);
      const steer = selecting ? 0 : T.MathUtils.clamp(Number(movement.has('right')) - Number(movement.has('left')) + stickX, -1, 1);
      if (move || steer || selecting) walkingTo = null;
      if (walkingTo) {
        if (Math.hypot(walkingTo.x - position.x, walkingTo.z - position.z) < 0.32) {
          walkingTo = null;
          speed = 0;
        } else heading = headingTo(position, walkingTo);
      }
      const maxSpeed = driving ? (move < 0 ? 5 : 16) : sprinting ? 6 : 3.4;
      speed = T.MathUtils.damp(speed, (walkingTo ? 1 : move) * maxSpeed, driving ? 2.9 : 5, elapsed);
      heading += steer * (driving ? 0.94 + Math.min(0.78, Math.abs(speed) * 0.085) : 2.2) * elapsed
        * (driving && speed < -0.05 ? -1 : 1);
      const proposed = { x: position.x + Math.sin(heading) * speed * elapsed, z: position.z - Math.cos(heading) * speed * elapsed };
      const before = position;
      if (move || steer) tripIndex = 0;
      if (tripIndex) {
        let remaining = elapsed * 8.2;
        while (remaining > 0 && tripIndex) {
          const next = tripLine[tripIndex];
          const distance = Math.hypot(next.x - position.x, next.z - position.z);
          if (distance > 0.05) {
            const forward = headingTo(position, next);
            const turn = Math.atan2(Math.sin(forward - heading), Math.cos(forward - heading));
            heading += turn * Math.min(1, elapsed * 8);
          }
          if (distance > remaining) {
            const t = remaining / distance;
            position = { x: position.x + (next.x - position.x) * t, z: position.z + (next.z - position.z) * t };
            remaining = 0;
          } else {
            position = next;
            remaining -= distance;
            tripIndex = tripIndex + 1 < tripLine.length ? tripIndex + 1 : 0;
          }
        }
        driveSegment = streets.nearest(position, 6)?.segment ?? driveSegment;
      } else if (Math.abs(speed) > 0.01) {
        const drive = driving ? streets.drive(proposed, driveSegment) : null;
        const next = driving ? drive?.point : proposed;
        if (next && !endOfTile(next) && !blockedForMovement(next)) {
          position = next;
          if (drive) driveSegment = drive.segment;
        } else if (walkingTo) { walkingTo = null; speed = 0; }
      }
      travelSpeed = T.MathUtils.damp(travelSpeed,
        Math.hypot(position.x - before.x, position.z - before.z) / Math.max(elapsed, 0.001), 6, elapsed);
      const surfaceHeight = streets.surface(position.x, position.z);
      const modeledFloor = driving && !isOpo ? undefined : walkFloor(position, surfaceHeight);
      const drivingFloor = driving && !isOpo ? site.paving?.drivewayElevation(position) : undefined;
      const y = drivingFloor ?? (eyeLevel ? undefined : modeledFloor) ?? surfaceHeight;
      const actor = driving ? car : player;
      const actorHeight = modeledFloor === undefined
        ? drivingFloor ?? surfaceHeight + (driving ? streets.deckLift : 0.18)
        : modeledFloor - (isOpo ? 0 : playerFootHeight);
      actor.position.set(position.x, actorHeight, position.z);
      actor.rotation.y = -heading;
      if (!driving) legs.forEach((leg, index) => { leg.rotation.x = Math.sin(now / 78 + index * Math.PI) * Math.min(0.68, Math.abs(speed) * 0.25); });

      const angle = heading + viewAngle;
      if (firstPerson()) {
        const renderedFloor = isOpo ? undefined : modeledFloor;
        const base = renderedFloor ?? (eyeLevel || studyingSunlight ? surfaceHeight : undefined);
        const eye = base === undefined ? actor.position.y + 1.6 : base + observationHeight;
        camera.position.set(position.x, eye, position.z);
        const tilt = (0.17 - pitch) * Math.PI / 2;
        target.set(position.x + Math.sin(angle), camera.position.y + Math.tan(tilt), position.z - Math.cos(angle));
      } else {
        const distance = (driving ? 7.4 : 5.55) * cameraDistance;
        const x = position.x - Math.sin(angle) * distance;
        const z = position.z + Math.cos(angle) * distance;
        destination.set(x, Math.max(y, streets.surface(x, z)) + (driving ? 2.3 : 1.9) + pitch * distance, z);
        target.set(position.x + Math.sin(angle) * 5.5, y + (driving ? 1.1 : 1.7) - (pitch - 0.17) * 3, position.z - Math.cos(angle) * 5.5);
        if (camera.position.distanceTo(destination) > 20) camera.position.copy(destination);
        else camera.position.lerp(destination, 1 - Math.exp(-elapsed * 8));
      }
      camera.lookAt(target);
    }

    stepMarker.visible = Boolean(walkingTo);
    for (const { walker, vehicle, pose, label } of peers.values()) {
      const actor = pose.driving ? vehicle : walker;
      const previous = pose.driving ? walker : vehicle;
      if (previous.visible) actor.position.copy(previous.position);
      walker.visible = !pose.driving;
      vehicle.visible = pose.driving;
      const blend = Math.hypot(actor.position.x - pose.x, actor.position.z - pose.z) > 25 ? 1 : 1 - Math.exp(-elapsed * 13);
      const x = T.MathUtils.lerp(actor.position.x, pose.x, blend);
      const z = T.MathUtils.lerp(actor.position.z, pose.z, blend);
      const point = { x, z };
      const ground = streets.surface(x, z);
      const deck = !isOpo && !pose.driving ? walkDeck(point, ground) : undefined;
      const y = isOpo ? modeledElevation(point) ?? ground + (pose.driving ? streets.deckLift : 0.18)
        : deck === undefined ? ground + (pose.driving ? streets.deckLift : 0.18) : deck - playerFootHeight;
      actor.position.set(x, y, z);
      const turn = -pose.heading - actor.rotation.y;
      actor.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * blend;
      label.point.set(x, y + (pose.driving ? 2.1 : 2.5), z);
    }
    camera.updateMatrixWorld();
    for (const { point, element, enabled, keepInFrame, limit } of labels) {
      projected.copy(point).project(camera);
      const visible = enabled() && (!limit || camera.position.distanceToSquared(point) < limit ** 2)
        && projected.z < 1 && projected.z > -1 && Math.abs(projected.x) < 0.97 && Math.abs(projected.y) < 0.97;
      element.hidden = !visible;
      if (visible) {
        const width = host.clientWidth;
        const margin = keepInFrame ? element.offsetWidth / 2 + 8 : 0;
        const panel = keepInFrame && width > 780 ? host.parentElement?.querySelector<HTMLElement>('.analysis') : null;
        const right = panel?.offsetLeft ?? width;
        const x = T.MathUtils.clamp((projected.x * 0.5 + 0.5) * width, margin, right - margin);
        const y = (-projected.y * 0.5 + 0.5) * host.clientHeight;
        element.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%)`;
      }
    }
    updatePlaceLabels();
    sky.follow(camera);
    updateShadows(now);
    environment.waterNormal?.offset.set(now * 0.000018, -now * 0.000033);
    streets.setPaintProjection(renderer.domElement.height / renderer.getPixelRatio(), camera.fov);
    fog.density = mode === 'orbit'
      ? Math.min(fogDensity, 0.62 / Math.max(1, controls.getDistance())) : fogDensity;
    if (streetOcclusion && mode !== 'orbit' && !showingSatellite) streetOcclusion.render();
    else renderer.render(scene, camera);
  });

  return {
    presets,
    facades,
    buildingAhead: (view: FacadeView) => firstBuildingAhead(data, view, view.bearing),
    destinations,
    tripLength,
    showLightPath,
    sunMap: sunMap && {
      render: (date: string, minute: number, done: (counts: SunMapCounts) => void) => sunMap.render(analysis.sampleAtTime(date, minute), done),
      focus() {
        setMode('orbit');
        const frame = new T.Box3().setFromPoints(sunMap.positions);
        const { x, z } = frame.getSize(new T.Vector3());
        const size = Math.max(160, x, z);
        frameSurface(sunMap.positions, frame.getCenter(new T.Vector3()), new T.Vector3(0, size * 1.42, size * 0.14), { clearTitle: true });
      },
    },
    sources: { terrain: data.terrainSource, osmSnapshot: data.snapshot, referenceHeight: data.referenceHeight,
      localTerrain: data.localTerrain,
      roadMarkings: data.roadMarkings && { lanes: data.roadMarkings.lanesSource, crosswalks: data.roadMarkings.crosswalksSource,
        inventory: data.roadMarkings.crosswalkInventory, archiveDate: data.roadMarkings.markingsArchiveDate,
        inventoryDate: data.roadMarkings.crosswalkInventoryDate, paintedHumps: data.roadMarkings.paintedHumps?.source },
      streets: data.streetSource, register: data.buildingRegister,
      treeCover: data.treeCover && { year: data.treeCover.year, resolution: data.treeCover.cellM,
        source: data.treeCover.source, catalog: data.treeCover.catalog, license: data.treeCover.license } },
    setMode,
    setStudyLighting(enabled: boolean) {
      studyingSunlight = enabled;
      if (studyShadows(enabled)) renderer.shadowMap.needsUpdate = true;
    },
    setWalkingCamera(enabled: boolean) {
      walkingAtEyeLevel = enabled;
      eyeLevel = false;
      player.visible = mode === 'walk' && !firstPerson();
      viewAngle = 0;
      pitch = 0.17;
      renderer.shadowMap.needsUpdate = true;
    },
    focus() { canvas.focus({ preventScroll: true }); },
    setSelect(enabled: boolean) {
      selecting = enabled;
      controls.enabled = mode === 'orbit' && !enabled;
      canvas.dataset.selecting = String(enabled);
      if (enabled) { movement.clear(); walkingTo = null; tripIndex = 0; stickX = stickY = 0; }
    },
    movement(command: string, pressed: boolean) { if (pressed) movement.add(command); else movement.delete(command); },
    walkStick(x: number, y: number) { if (mode === 'walk') { stickX = x; stickY = y; } },
    locate() {
      if (mode === 'orbit') { overview(); return; }
      setMode(mode);
      position = mode === 'drive' ? roadSpawn.point : spawn;
      tripIndex = 0;
      walkingTo = null;
      heading = mode === 'drive' ? headingTo(roadSpawn.point, roadLookAt) : initialHeading;
      driveSegment = roadSpawn.segment;
      viewAngle = 0;
      speed = travelSpeed = 0;
    },
    goTo(id: string, observation?: SitePoint) {
      const target = destinations.find(place => place.id === id)
        ?? ambientMap?.stops.find(place => place.id === id && canAnalyze(place.position));
      if (!target || (observation && (!target.lookAt || !canAnalyze(observation)))) return;
      if (target.lookAt) {
        setMode('walk');
        position = observation ?? target.position;
        heading = headingTo(position, target.lookAt);
      } else {
        const entry = streets.nearest(target.position, 64);
        if (!entry) return;
        if (mode === 'orbit') setMode('walk');
        position = entry.point;
        driveSegment = entry.segment;
        heading = id === 'approach' && entrance ? headingTo(position, entrance.gate)
          : mode === 'drive' ? headingTo(entry.segment.a, entry.segment.b) : headingTo(position, target.position);
      }
      eyeLevel = false;
      player.visible = mode === 'walk' && !firstPerson();
      tripIndex = 0;
      walkingTo = null;
      viewAngle = 0;
      pitch = 0.17;
      speed = travelSpeed = 0;
      movement.clear();
      return mode;
    },
    streetStatus() {
      const nearest = mode === 'drive' ? driveSegment.road : streets.nearest(position, 8)?.segment.road;
      const nearCourtyard = isOpo && mode === 'walk' && Math.hypot(position.x - courtyard.position.x, position.z - courtyard.position.z) < 20;
      const paving = mode === 'walk' ? pavingStops.find(stop => Math.hypot(position.x - stop.position.x, position.z - stop.position.z) < 11) : undefined;
      const roadsideView = mode === 'walk' ? roadsideViews.reduce<{ name: string; distance: number } | undefined>((closest, stop) => {
        const distance = Math.hypot(position.x - stop.position.x, position.z - stop.position.z);
        return distance < (closest?.distance ?? 10) ? { name: stop.name, distance } : closest;
      }, undefined) : undefined;
      const roadside = ambientMap?.stops[0];
      const nearRoadside = mode === 'walk' && roadside && Math.hypot(position.x - roadside.position.x, position.z - roadside.position.z) < 11;
      const nearSchoolCrossing = mode === 'walk' && schoolCrossing
        && Math.hypot(position.x - schoolCrossing.position.x, position.z - schoolCrossing.position.z) < 11;
      const onFrontage = mode === 'walk' && site.frontage && nearestOnLine(position, [site.frontage]).distance <= 1;
      const onSongpaStartRoad = !isOpo && (onFrontage || nearest?.id === roadSpawn.segment.road.id);
      const streetName = onFrontage ? songpaComplex.roadName
        : nearest?.name || (onSongpaStartRoad ? songpaComplex.roadName : nearest ? '동네 골목' : data.area.name);
      const parkView = mode === 'walk' ? parkViews.find(view => Math.hypot(position.x - view.position.x, position.z - view.position.z) < 12) : undefined;
      const analysisPoint = (eyeLevel || studyingSunlight) && 'label' in position && typeof position.label === 'string' ? position.label : undefined;
      const namedPoint = roadsideView?.name
        ?? (nearSchoolCrossing ? '송이로 횡단보도' : nearRoadside ? roadside.name : (paving?.name ?? parkView?.name));
      return { name: analysisPoint ?? namedPoint ?? (nearCourtyard ? courtyard.name : streetName),
        speed: Math.round(travelSpeed * 3.6), touring: tripIndex > 0 };
    },
    toggleTrip() {
      if (tripIndex) { tripIndex = 0; return false; }
      if (!tripLength) return false;
      setMode('drive');
      tripIndex = 1;
      position = tripLine[0];
      heading = headingTo(position, tripLine[1]);
      viewAngle = 0;
      pitch = 0.17;
      speed = travelSpeed = 0;
      movement.clear();
      return true;
    },
    lookFrom(point: Point, bearing: number, sightlineAngle?: number) {
      setMode('walk');
      eyeLevel = true;
      walkingTo = null;
      player.visible = false;
      movement.clear();
      position = point;
      heading = T.MathUtils.degToRad(bearing) + data.northOffset;
      viewAngle = 0;
      // Leave room above steep rooflines that a midpoint framing would cut out.
      const obstructionAngle = sightlineAngle ?? 0;
      const lookElevation = Math.max(obstructionAngle / 2, obstructionAngle - (eyeFov / 2 - 6));
      pitch = 0.17 - lookElevation / 90;
      speed = 0;
    },
    places: data.places,
    placeOrigin: data.placeOrigin.label,
    showPlaces(categories: string[], selectedId: string | null) {
      browsingPlaces = categories.length > 0;
      visiblePlaceMarkers = browsingPlaces ? [placeOriginMarker] : [];
      placeOriginMarker.pin.visible = browsingPlaces;
      for (const marker of placeMarkers) {
        const shown = categories.includes(marker.place.category);
        const selected = shown && marker.place.id === selectedId;
        marker.pin.visible = shown;
        marker.pin.scale.setScalar(selected ? 1.6 : 1);
        marker.pin.renderOrder = selected ? 6 : 4;
        marker.element.dataset.selected = selected ? 'true' : '';
        if (selected) visiblePlaceMarkers.unshift(marker);
        else if (shown) visiblePlaceMarkers.push(marker);
        else marker.element.style.visibility = 'hidden';
      }
      updateComparisonMarkers();
    },
    focusPlace(id: string) {
      const marker = placeMarkers.find(item => item.place.id === id);
      if (!marker) return;
      framePlaceMarkers([marker]);
      camera.updateMatrixWorld();
      updatePlaceLabels();
      // At the zoom limit on a small screen, keep the selected facility in view.
      if (marker.element.style.visibility === 'hidden') framePlaceMarkers([marker], false);
    },
    frameNearbyPlaces(category: string) {
      framePlaceMarkers(placeMarkers.filter(marker => category === 'all' || marker.place.category === category).slice(0, 5));
    },
    showSchoolZone(enabled: boolean) {
      if (!schoolMap) return;
      schoolMap.group.visible = enabled;
      placeGroup.visible = !enabled;
      updateComparisonMarkers();
      if (!enabled) return;
      const bounds = new T.Box3().setFromPoints(schoolMap.regionPoints);
      const { x, z } = bounds.getSize(new T.Vector3());
      const scale = Math.max(x, z);
      frameSurface(schoolMap.regionPoints, bounds.getCenter(new T.Vector3()), new T.Vector3(scale * 0.06, scale * 1.10, scale * 0.17), { clearTitle: true });
    },
    showSiteDetails(enabled: boolean) { site.overlay.visible = enabled; },
    ambientScene: ambientMap && {
      stops: ambientMap.stops.filter(stop => canAnalyze(stop.position)).map(stop => ({
        ...stop, bearing: T.MathUtils.radToDeg(headingTo(stop.position, stop.lookAt) - data.northOffset),
      })),
    },
    showAmbient(active: boolean, map: boolean, referenceId?: string) {
      if (!ambientMap) return;
      ambientInspection = active;
      ambientMap.group.visible = map;
      updateComparisonMarkers();
      const reference = ambientMap.selectReference(referenceId);
      streetLights?.refer(active && !map ? reference?.position : undefined);
      if (!map) return;
      for (const { label, element } of ambientLabels) {
        if (label.kind === 'station') {
          const distance = reference?.stationDistancesM[label.serial];
          element.textContent = distance === undefined ? label.name : `${label.name} · ${ambientStationDistance(distance)}`;
        } else {
          element.dataset.reference = String(label.id === reference?.id);
        }
      }
      const bounds = new T.Box3().setFromPoints(ambientMap.frames);
      const scale = bounds.getSize(new T.Vector3()).length();
      frameSurface(ambientMap.frames, bounds.getCenter(new T.Vector3()), new T.Vector3(scale * 0.10, scale * 1.1, scale * 0.22), { clearTitle: true });
    },
    showFlood(year: string | null, view: FloodView) {
      if (!floodMap) return;
      const points = floodMap.show(year, view);
      updateComparisonMarkers();
      if (!points.length) return;
      for (const { label, element } of floodLabels) element.textContent = label.text;
      const bounds = new T.Box3().setFromPoints(points);
      const { x, z } = bounds.getSize(new T.Vector3());
      const scale = Math.max(160, x, z);
      const offset = view === 'forecast' ? new T.Vector3(-0.25, 1.55, -0.27) : new T.Vector3(0.06, 1.3, 0.25);
      frameSurface(points, bounds.getCenter(new T.Vector3()), offset.multiplyScalar(scale), { clearTitle: true });
    },
    greenAccessProfiles: greenAccess.layers.map(({ id, profile, crossingView, entranceView, stopView, homeWalk }) =>
      ({ id, profile, crossingView, entranceView, stopView, homeWalk })),
    showAccessEntrance(id: string) { accessEntranceId = id; },
    showGuidedWalk(id: string | null) {
      guidedWalk = mode === 'walk' && id !== null;
      updateComparisonMarkers();
      for (const layer of greenAccess.layers) {
        const active = guidedWalk && layer.id === id;
        layer.lines.visible = mode === 'orbit' || active;
        layer.pavingGuides.visible = layer.lines.visible;
        layer.lines.position.y = active ? -0.10 : 0;
      }
    },
    parkViews,
    markGreenAccess(id: string | null, index: number) {
      greenAccess.mark(id, index);
      const sample = greenAccess.layers.find(layer => layer.id === id)?.profile?.samples[index];
      if (sample) routeTerrainLabel.textContent = `${Math.round(sample.distance)}m · 모델 표고 ${Math.round(sample.elevation)}m`;
    },
    showGreenAccess(id: string | null) {
      const layer = greenAccess.show(id);
      if (!layer) return;
      setMode('orbit');
      const center = layer.bounds.getCenter(new T.Vector3());
      const size = layer.bounds.getSize(new T.Vector3());
      const scale = Math.max(340, size.x, size.z);
      frameSurface(layer.routePoints, center, new T.Vector3(scale * 0.15, scale * 1.28, scale * 0.34), { clearTitle: Boolean(layer.entranceView || layer.stopView) });
    },
    position() { return position; },
    tourPose(): TourPose {
      return { x: position.x, z: position.z, heading: Math.atan2(Math.sin(heading), Math.cos(heading)), driving: mode === 'drive' };
    },
    showPeer,
    removePeer,
    clearPeers() { for (const id of peers.keys()) removePeer(id); },
    canAnalyze,
    place(slot: Slot, location: Point) {
      const y = observationSurface(location.x, location.z);
      markers[slot].visible = true;
      markers[slot].position.set(location.x, y, location.z);
      pinLabels.find(label => label.slot === slot)?.point.set(location.x, y + 3.2, location.z);
    },
    light(date: string, minute: number) {
      const solar = sunAt(data, date, minute);
      const daylight = solar.altitude > 0;
      sky.light(solar.direction, solar.altitude, fog.color);
      streetLights?.setSunAltitude(solar.altitude);
      sunDirection.copy(daylight ? solar.direction : new T.Vector3(-200, 300, 100).normalize());
      sun.castShadow = daylight;
      const strength = T.MathUtils.smoothstep(solar.altitude, -0.04, 0.36);
      sun.intensity = 0.17 + strength * 2.35;
      sun.color.set(daylight ? '#fff0d7' : '#a5b9df');
      ambient.intensity = 0.57 + T.MathUtils.smoothstep(solar.altitude, -0.14, 0.24) * 0.98;
      ambient.color.set(daylight ? '#d9e9fa' : '#98a6d0');
      ambient.groundColor.set(daylight ? '#6b735d' : '#242c38');
      shadowFocus.set(Infinity, 0, Infinity);
      if (!daylight) {
        sun.target.position.set(45, 0, 0);
        sun.position.copy(sunDirection).multiplyScalar(660).add(sun.target.position);
      }
    },
    report: analysis.day,
    lightAt: analysis.at,
    lightNearSurface: (point: Point, date: string, minute: number) => analysis.at(point, date, minute, nearSurfaceHeight),
    winterPixel(pixel: number[], date: string, minute: number) {
      const sample = analysis.sampleAtTime(date, minute);
      return sampleWinterPixel(pixel, coordinate => {
        const point = data.project(coordinate);
        return canAnalyze(point) ? sample(point, nearSurfaceHeight) : undefined;
      });
    },
    environmentAt(point: Point) {
      const water = nearestOnLine(point, environment.waters).distance;
      const green = environment.greens.some(shape => inShape(point, shape)) ? 0
        : nearestOnLine(point, environment.greens.map(shape => [...shape[0], shape[0][0]])).distance;
      return { water, green, elevation: data.elevationAt(point.x, point.z), spread: data.spreadAt(point.x, point.z) };
    },
    directionProfile(point: Point, bearing: number) {
      return directionProfile(data, roofs, observationSurface(point.x, point.z), point, bearing);
    },
    showTreeCover(enabled: boolean) {
      if (!treeCoverOverlay || treeCoverOverlay.visible === enabled) return;
      treeCoverOverlay.visible = enabled;
      environment.landCoverOverlays.visible = !enabled;
      environment.vegetation.visible = !enabled;
      renderer.shadowMap.needsUpdate = true;
      if (!enabled) return;

      setMode('orbit');
      // Frame nearby hills while leaving the rest of the mapped grid available to pan across.
      const points = [-365, 365].flatMap(x => [-365, 365].map(z => new T.Vector3(x, data.ground(x, z), z)));
      frameSurface(points, new T.Vector3(0, data.ground(0, 0), 0), new T.Vector3(40, 820, 300), { clearTitle: true });
    },
    async showSatellite(enabled: boolean) {
      if (!isOpo) return;
      if (enabled) await satelliteImage();
      if (!active) return;
      showingSatellite = enabled;
      if (groundDetail) groundDetail.value = enabled ? 0 : 1;
      terrain.material.map = enabled ? satelliteTexture : terrainPhoto;
      terrain.material.vertexColors = !enabled;
      terrain.material.needsUpdate = true;
      environment.surfaceOverlays.visible = !enabled;
    },
    dispose() {
      if (!active) return;
      active = false;
      renderer.setAnimationLoop(null);
      observer.disconnect();
      controls.dispose();
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      sunMap?.dispose();
      lightPath.dispose();
      const materials = new Set<T.Material>(), geometries = new Set<T.BufferGeometry>();
      scene.traverse(object => {
        if (object instanceof T.Mesh || object instanceof T.Line) {
          geometries.add(object.geometry);
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
        }
      });
      for (const geometry of geometries) geometry.dispose();
      const textures = new Set<T.Texture>();
      for (const material of materials) {
        if (material instanceof T.MeshStandardMaterial) {
          for (const map of [material.map, material.normalMap, material.roughnessMap, material.bumpMap]) if (map) textures.add(map);
        }
        material.dispose();
      }
      for (const texture of [satelliteTexture, terrainPhoto, environment.waterNormal, environment.grassTexture,
        treeCoverOverlay?.material.map]) if (texture) textures.add(texture);
      for (const texture of textures) texture.dispose();
      sun.shadow.dispose();
      streetOcclusion?.dispose();
      renderer.dispose();
      canvas.remove();
      placeOverlay.remove();
      labels.forEach(({ element }) => element.remove());
    },
  };
}

export type OpoWorld = ReturnType<typeof openOpoWorld>;
