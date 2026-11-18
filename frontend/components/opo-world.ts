import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildingCollision, extent, inShape, nearestOnLine, precinct, type OpoData, type Point } from './opo-data';
import { addCourtyard, courtyard, courtyardGarden, inCourtyardRing } from './opo-courtyard';
import { directionProfile } from './opo-horizon';
import { createLightPath } from './opo-light-path';
import { addEnvironment, buildMeshes, makeGround } from './opo-meshes';
import { createLightAnalyzer, observationHeight, sunAt } from './opo-sunlight';
import { addGreenAccess, addSiteDetails, approach, playgroundReference } from './opo-site';
import { addStreets } from './opo-streets';

export type ViewMode = 'orbit' | 'walk' | 'drive';
export type Slot = 'A' | 'B';
export type SitePoint = Point & { id: string; label: string };
const roadEntry = [127.164886, 37.351094];
const routePlaces = ['수레실.오포롯데캐슬', '능평도서관', '용상골현대아파트', '현동빌라'];
const headingTo = (from: Point, to: Point) => Math.atan2(to.x - from.x, from.z - to.z);

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

function makeCar() {
  const model = new T.Group();
  const body = new T.MeshStandardMaterial({ color: '#c59b44', roughness: 0.31, metalness: 0.14 });
  const glass = new T.MeshStandardMaterial({ color: '#405a64', roughness: 0.30, metalness: 0.25 });
  const rubber = new T.MeshStandardMaterial({ color: '#263334' });
  const chassis = new T.Mesh(new RoundedBoxGeometry(1.72, 0.55, 3.65, 3, 0.16), body);
  chassis.position.set(0, 0.55, 0);
  const cabin = new T.Mesh(new RoundedBoxGeometry(1.41, 0.52, 1.95, 3, 0.2), glass);
  cabin.position.set(0, 0.995, 0.11);
  model.add(chassis, cabin);
  const roof = new T.Mesh(new RoundedBoxGeometry(1.31, 0.12, 1.29, 3, 0.06), body);
  roof.position.set(0, 1.25, 0.20);
  model.add(roof);
  const headlight = new T.MeshStandardMaterial({ color: '#f0e9cd', emissive: '#c7ac65', emissiveIntensity: 0.22 });
  const taillight = new T.MeshStandardMaterial({ color: '#a74137', emissive: '#b63e2e', emissiveIntensity: 0.22 });
  for (const x of [-0.57, 0.57]) {
    const front = new T.Mesh(new RoundedBoxGeometry(0.37, 0.13, 0.08, 2, 0.032), headlight);
    front.position.set(x, 0.65, -1.79);
    const rear = new T.Mesh(new RoundedBoxGeometry(0.36, 0.12, 0.08, 2, 0.032), taillight);
    rear.position.set(x, 0.64, 1.79);
    const mirror = new T.Mesh(new T.BoxGeometry(0.20, 0.13, 0.22), glass);
    mirror.position.set(x * 1.52, 1.0, -0.53);
    model.add(front, rear, mirror);
  }
  const bumper = new T.Mesh(new RoundedBoxGeometry(1.54, 0.13, 0.12, 2, 0.04), rubber);
  bumper.position.set(0, 0.43, 1.78);
  model.add(bumper);
  const wheel = new T.CylinderGeometry(0.31, 0.31, 0.2, 12);
  wheel.rotateZ(Math.PI / 2);
  for (const x of [-0.8, 0.8]) for (const z of [-1.02, 1.02]) {
    const tyre = new T.Mesh(wheel, rubber);
    tyre.position.set(x, 0.32, z);
    model.add(tyre);
  }
  model.traverse(object => { if (object instanceof T.Mesh) object.castShadow = true; });
  return model;
}

export function openOpoWorld(host: HTMLDivElement, data: OpoData, onPick: (position: Point) => void) {
  const isOpo = data.region === 'opo';
  const scene = new T.Scene();
  scene.background = new T.Color('#354D65');
  scene.fog = new T.FogExp2('#354D65', isOpo ? 0.00112 : 0.00025);
  const camera = new T.PerspectiveCamera(49, 1, 0.25, 4300);
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

  const sun = new T.DirectionalLight('#F8E9C6', 2.35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(window.innerWidth < 720 ? 1024 : 2048, window.innerWidth < 720 ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -250, right: 250, top: 250, bottom: -250, near: 1, far: 1200 });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.16;
  const ambient = new T.HemisphereLight('#D8D5F0', '#17243A', 1.8);
  scene.add(sun, sun.target, ambient);
  const terrain = makeGround(data);
  terrain.castShadow = true;
  scene.add(terrain);
  const { occluders, anchors, roofs } = buildMeshes(data, scene);
  const environment = addEnvironment(data, scene);
  const streets = addStreets(data, scene);
  const site = addSiteDetails(data, scene, streets.surface);
  if (isOpo) addCourtyard(scene, streets.surface);
  const greenAccess = addGreenAccess(data, scene);
  scene.updateMatrixWorld(true);
  const analysis = createLightAnalyzer(data, terrain, occluders, streets.grade);
  const lightPath = createLightPath(scene, [terrain, ...occluders]);

  const endOfTile = ({ x, z }: Point) => Math.abs(x) > extent - 20 || Math.abs(z) > extent - 20;
  const insideBuilding = buildingCollision(data.buildings);
  const occupied = (point: Point) => insideBuilding(point) || (isOpo && inCourtyardRing(point));
  const roadSpawn = isOpo ? streets.nearest(data.project(roadEntry)) : streets.nearest({ x: 0, z: 0 }, data.buildingRadius);
  if (!roadSpawn) throw new Error('임장 구역의 도로 시작 위치를 찾을 수 없어요.');
  const spawn = roadSpawn.point;
  const entrance = isOpo ? data.project(approach) : spawn;
  const initialHeading = isOpo ? headingTo(spawn, entrance) : headingTo(roadSpawn.segment.a, roadSpawn.segment.b);
  const destinations: { id: string; name: string; position: Point; lookAt?: Point }[] = isOpo ? [
    { id: 'approach', name: '오포 롯데캐슬 입구', position: entrance },
    courtyard,
    courtyardGarden,
    ...routePlaces.flatMap(name => {
      const place = data.streetPoints.find(item => item.name === name);
      return place ? [{ id: place.id, name, position: place.position }] : [];
    }),
  ] : [];
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
  let selecting = false;
  let active = true;
  let satelliteTexture: T.Texture | null = null;
  let terrainPhoto: T.CanvasTexture | null = null;
  let satelliteLoading: Promise<T.Texture> | null = null;
  let showingSatellite = false;
  let driveSegment = roadSpawn.segment;
  let tripIndex = 0;
  const { player, legs } = makePlayer();
  const car = makeCar();
  scene.add(player, car);
  player.visible = false;
  car.visible = false;

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
  controls.maxDistance = 2600;
  controls.zoomToCursor = true;
  function overview() {
    if (!isOpo) {
      controls.target.set(0, 8, 0);
      camera.position.set(430, 640, 830);
      controls.update();
      return;
    }
    controls.target.set(45, 6, 0);
    const narrow = host.clientWidth < 700;
    camera.position.set(narrow ? 155 : 175, narrow ? 215 : 180, narrow ? 318 : 275);
    controls.update();
  }
  overview();

  function resize() {
    camera.aspect = host.clientWidth / Math.max(host.clientHeight, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(host.clientWidth, host.clientHeight);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

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
    scene.add(group);
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
    return { point, element, enabled: () => true };
  });
  const lightPathLabel = document.createElement('span');
  lightPathLabel.className = 'building-label light-path-label';
  lightPathLabel.hidden = true;
  host.appendChild(lightPathLabel);
  labels.push({ point: lightPath.labelPoint, element: lightPathLabel, enabled: () => lightPath.group.visible });
  const placeGroup = new T.Group();
  scene.add(placeGroup);
  let placeCategories: string[] = [];
  for (const place of data.places) {
    const { x, z } = place.point;
    const color = place.category === 'school' ? '#D8D5F0' : place.category === 'beauty' ? '#F8E9C6' : '#76C9BC';
    const pin = new T.Mesh(new T.SphereGeometry(7, 10, 8), new T.MeshBasicMaterial({ color }));
    pin.position.set(x, data.ground(x,z) + 25, z);
    pin.userData.category = place.category;
    pin.visible = false;
    placeGroup.add(pin);
    const element = document.createElement('span');
    element.className = `building-label place-label place-${place.category}`;
    element.textContent = place.name;
    element.hidden = true;
    host.appendChild(element);
    labels.push({point: pin.position.clone().add(new T.Vector3(0, 12, 0)), element,
      enabled: () => placeCategories.includes(place.category)});
  }
  const pinLabels = (['A', 'B'] as const).map(slot => {
    const element = document.createElement('span');
    element.className = `building-label point-label point-${slot}`;
    element.textContent = slot;
    element.hidden = true;
    host.appendChild(element);
    const label = { point: new T.Vector3(), element, enabled: () => markers[slot].visible, slot };
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
    const element = document.createElement('span');
    element.className = 'building-label access-label';
    element.textContent = `${layer.name} 인근`;
    element.hidden = true;
    host.appendChild(element);
    const { x, z } = layer.endpoint;
    labels.push({ point: new T.Vector3(x, data.ground(x, z) + 5, z), element, enabled: () => layer.group.visible, keepInFrame: true });
  }

  const labeledPlaces = data.streetPoints.filter(item => item.name
    && (item.kind === 'bus' || routePlaces.includes(item.name) || Math.hypot(item.position.x - spawn.x, item.position.z - spawn.z) < 720));
  for (const place of labeledPlaces) {
    const element = document.createElement('span');
    element.className = `building-label street-label${place.kind === 'bus' ? ' bus-label' : ''}`;
    element.textContent = place.name;
    element.hidden = true;
    host.appendChild(element);
    const { x, z } = place.position;
    labels.push({ point: new T.Vector3(x, streets.grade(x, z) + (place.kind === 'bus' ? 3.4 : 2.65), z),
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
    const sample = candidates.find(p => !occupied(p));
    return sample ? { ...sample, id: building.dong, label: `${building.dong} 인근` } : null;
  }).filter((point): point is SitePoint => point !== null).sort((a, b) => a.id.localeCompare(b.id));
  if (isOpo) {
    if (!occupied(courtyard.position)) presets.push({ ...courtyard.position, id: courtyard.id, label: courtyard.name });
  } else {
    const candidates = data.streets.filter(road => road.motor).flatMap(road => road.points)
      .filter(p => Math.hypot(p.x, p.z) < 280 && !occupied(p))
      .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    const first = candidates[0];
    const second = first && candidates.find(p => Math.hypot(p.x-first.x, p.z-first.z) > 60);
    for (const [index, point] of [first, second].entries()) if (point) {
      presets.push({...point, id:`road-${index}`, label:`구역 도로 인근 ${index + 1}`});
    }
  }

  function setMode(next: ViewMode) {
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
    player.visible = next === 'walk';
    car.visible = next === 'drive';
    controls.enabled = next === 'orbit' && !selecting;
    if (next === 'orbit') overview();
  }

  function showLightPath(location: Point | null, date: string, minute: number, slot: Slot, focus = false) {
    if (!location) { lightPath.group.visible = false; return; }
    const sample = analysis.at(location, date, minute);
    const origin = new T.Vector3(location.x, streets.grade(location.x, location.z) + observationHeight, location.z);
    const { direction } = sunAt(data, date, minute);
    lightPath.update(sample, origin, direction, slot);
    lightPathLabel.textContent = sample.obstruction ? `${slot} · ${sample.cause}`
      : sample.status === 'unknown' ? `${slot} · 차폐 미판정` : `${slot} · 태양 방향`;
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
      viewAngle -= dx * 0.006;
      pitch = T.MathUtils.clamp(pitch + dy * 0.004, eyeLevel ? -0.63 : -0.05, 0.85);
    }
    drag.x = event.clientX; drag.y = event.clientY;
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('lostpointercapture', () => { drag = null; });
  canvas.addEventListener('wheel', event => {
    if (mode === 'orbit' || eyeLevel || selecting) return;
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
      if (hit && selecting) onPick({ x: hit.point.x, z: hit.point.z });
      else if (hit?.object === terrain) {
        const goal = { x: hit.point.x, z: hit.point.z };
        const distance = Math.hypot(goal.x - position.x, goal.z - position.z);
        if (distance >= 0.5 && distance <= 85 && !endOfTile(goal) && !occupied(goal)) {
          walkingTo = goal;
          viewAngle = 0;
          stepMarker.position.set(goal.x, streets.surface(goal.x, goal.z) + 0.62, goal.z);
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
        if (next && !endOfTile(next) && !occupied(next)) {
          position = next;
          if (drive) driveSegment = drive.segment;
        } else if (walkingTo) { walkingTo = null; speed = 0; }
      }
      travelSpeed = T.MathUtils.damp(travelSpeed,
        Math.hypot(position.x - before.x, position.z - before.z) / Math.max(elapsed, 0.001), 6, elapsed);
      const y = streets.grade(position.x, position.z);
      const actor = driving ? car : player;
      actor.position.set(position.x, streets.surface(position.x, position.z) + (driving ? 0.47 : 0.18), position.z);
      actor.rotation.y = -heading;
      if (!driving) legs.forEach((leg, index) => { leg.rotation.x = Math.sin(now / 78 + index * Math.PI) * Math.min(0.68, Math.abs(speed) * 0.25); });

      const angle = heading + viewAngle;
      if (eyeLevel) {
        camera.position.set(position.x, y + observationHeight, position.z);
        const tilt = (0.17 - pitch) * Math.PI / 2;
        target.set(position.x + Math.sin(angle), camera.position.y + Math.tan(tilt), position.z - Math.cos(angle));
      } else {
        const distance = (driving ? 7.4 : 5.55) * cameraDistance;
        const x = position.x - Math.sin(angle) * distance;
        const z = position.z + Math.cos(angle) * distance;
        destination.set(x, Math.max(y, data.ground(x, z)) + (driving ? 2.3 : 1.9) + pitch * distance, z);
        target.set(position.x + Math.sin(angle) * 5.5, y + (driving ? 1.1 : 1.7) - (pitch - 0.17) * 3, position.z - Math.cos(angle) * 5.5);
        if (camera.position.distanceTo(destination) > 20) camera.position.copy(destination);
        else camera.position.lerp(destination, 1 - Math.exp(-elapsed * 8));
      }
      camera.lookAt(target);
    }

    stepMarker.visible = Boolean(walkingTo);
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
    renderer.render(scene, camera);
  });

  return {
    presets,
    destinations,
    tripLength,
    showLightPath,
    sources: { terrain: data.terrainSource, osmSnapshot: data.snapshot, referenceHeight: data.referenceHeight,
      streets: data.streetSource, register: data.buildingRegister },
    setMode,
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
      position = spawn;
      tripIndex = 0;
      walkingTo = null;
      heading = initialHeading;
      driveSegment = roadSpawn.segment;
      viewAngle = 0;
      speed = travelSpeed = 0;
    },
    goTo(id: string) {
      const target = destinations.find(place => place.id === id);
      if (!target) return;
      if (target.lookAt) {
        setMode('walk');
        position = target.position;
        heading = headingTo(position, target.lookAt);
      } else {
        const entry = streets.nearest(target.position, 64);
        if (!entry) return;
        if (mode === 'orbit') setMode('walk');
        position = entry.point;
        driveSegment = entry.segment;
        heading = mode === 'drive' ? headingTo(entry.segment.a, entry.segment.b) : headingTo(position, target.position);
      }
      eyeLevel = false;
      player.visible = mode === 'walk';
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
      return { name: nearCourtyard ? courtyard.name : nearest?.name || (nearest ? '동네 골목' : data.area.name),
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
    lookFrom(point: Point, bearing: number, obstructionAngle: number) {
      setMode('walk');
      eyeLevel = true;
      walkingTo = null;
      player.visible = false;
      movement.clear();
      position = point;
      heading = T.MathUtils.degToRad(bearing) + data.northOffset;
      viewAngle = 0;
      pitch = 0.17 - obstructionAngle / 180;
      speed = 0;
    },
    places: data.places,
    showPlaces(categories: string[]) {
      placeCategories = categories;
      placeGroup.children.forEach(pin => { pin.visible = categories.includes(pin.userData.category); });
    },
    focusPlace(id: string) {
      const place = data.places.find(p => p.id === id);
      if (!place) return;
      setMode('orbit');
      const {x,z} = place.point;
      controls.target.set(x, data.ground(x,z), z);
      camera.position.copy(controls.target).add(new T.Vector3(100, 350, 450));
      controls.update();
    },
    showSiteDetails(enabled: boolean) { site.overlay.visible = enabled; },
    showGreenAccess(id: string | null) {
      const layer = greenAccess.show(id);
      if (!layer) return;
      setMode('orbit');
      const center = layer.bounds.getCenter(new T.Vector3());
      const size = layer.bounds.getSize(new T.Vector3());
      const scale = Math.max(340, size.x, size.z);
      const horizontalFrame = host.clientWidth < 600 ? 0.52 : 0.76;
      controls.target.copy(center);
      camera.position.copy(center).add(new T.Vector3(scale * 0.15, scale * 1.28, scale * 0.34));
      const projection = new T.Vector3();
      for (let attempt = 0; attempt < 4; attempt++) {
        controls.update();
        camera.updateMatrixWorld(true);
        let frame = 1;
        for (const point of layer.routePoints) {
          projection.copy(point).project(camera);
          frame = Math.max(frame, Math.abs(projection.x) / horizontalFrame, Math.abs(projection.y) / 0.76);
        }
        if (frame <= 1.01) break;
        camera.position.sub(center).multiplyScalar(Math.min(2.1, frame * 1.04)).add(center);
      }
      const width = host.clientWidth;
      const panel = width > 780 ? host.parentElement?.querySelector<HTMLElement>('.analysis') : null;
      if (panel) {
        const inset = (width - panel.offsetLeft) / width;
        const halfWidth = camera.position.distanceTo(center) * Math.tan(T.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
        const viewRight = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        controls.target.addScaledVector(viewRight, halfWidth * inset);
        camera.position.addScaledVector(viewRight, halfWidth * inset);
        controls.update();
      }
    },
    position() { return position; },
    canAnalyze(p: Point) { return !occupied(p) && Math.hypot(p.x, p.z) <= Math.min(precinct, data.buildingRadius); },
    place(slot: Slot, location: Point) {
      const y = streets.grade(location.x, location.z);
      markers[slot].visible = true;
      markers[slot].position.set(location.x, y, location.z);
      pinLabels.find(label => label.slot === slot)?.point.set(location.x, y + 3.2, location.z);
    },
    light(date: string, minute: number) {
      const solar = sunAt(data, date, minute);
      const daylight = solar.altitude > 0;
      sun.position.copy(solar.direction).multiplyScalar(660).add(new T.Vector3(45, 0, 0));
      if (!daylight) sun.position.set(-200, 300, 100);
      sun.target.position.set(45, 0, 0);
      sun.intensity = daylight ? 2.7 : 0.4;
      ambient.intensity = daylight ? 1.8 : 0.85;
      (scene.background as T.Color).set(daylight ? '#354D65' : '#17243A');
      (scene.fog as T.FogExp2).color.copy(scene.background as T.Color);
      renderer.shadowMap.needsUpdate = true;
    },
    report: analysis.day,
    lightAt: analysis.at,
    environmentAt(point: Point) {
      const water = nearestOnLine(point, environment.waters).distance;
      const green = environment.greens.some(shape => inShape(point, shape)) ? 0
        : nearestOnLine(point, environment.greens.map(shape => [...shape[0], shape[0][0]])).distance;
      return { water, green, elevation: data.elevationAt(point.x, point.z), spread: data.spreadAt(point.x, point.z) };
    },
    directionProfile: (point: Point, bearing: number) => directionProfile(data, roofs, streets.grade, point, bearing),
    async showSatellite(enabled: boolean) {
      if (!isOpo) return;
      if (enabled) await satelliteImage();
      if (!active) return;
      showingSatellite = enabled;
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
      lightPath.dispose();
      const materials = new Set<T.Material>(), geometries = new Set<T.BufferGeometry>();
      scene.traverse(object => {
        if (object instanceof T.Mesh || object instanceof T.Line) {
          geometries.add(object.geometry);
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
        }
      });
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) {
        if (material instanceof T.MeshStandardMaterial && material.map !== satelliteTexture && material.map !== terrainPhoto) material.map?.dispose();
        material.dispose();
      }
      satelliteTexture?.dispose();
      terrainPhoto?.dispose();
      sun.shadow.dispose();
      renderer.dispose();
      canvas.remove();
      labels.forEach(({ element }) => element.remove());
    },
  };
}

export type OpoWorld = ReturnType<typeof openOpoWorld>;
