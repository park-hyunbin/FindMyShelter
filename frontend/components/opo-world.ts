import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { extent, inShape, nearestOnLine, precinct, type OpoData, type Point } from './opo-data';
import { directionProfile } from './opo-horizon';
import { addEnvironment, buildMeshes, makeGround } from './opo-meshes';
import { createLightAnalyzer, observationHeight, sunAt } from './opo-sunlight';
import { addGreenAccess, addSiteDetails, approach, approachHeading, playgroundReference } from './opo-site';

export type ViewMode = 'orbit' | 'walk' | 'drive';
export type Slot = 'A' | 'B';
export type SitePoint = Point & { id: string; label: string };
const roadEntry = [127.164886, 37.351094];

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
  const body = new T.MeshStandardMaterial({ color: '#d7aa52', roughness: 0.5 });
  const glass = new T.MeshStandardMaterial({ color: '#48636d', roughness: 0.35 });
  const rubber = new T.MeshStandardMaterial({ color: '#263334' });
  const chassis = new T.Mesh(new T.BoxGeometry(1.72, 0.55, 3.55), body);
  chassis.position.set(0, 0.55, 0);
  const cabin = new T.Mesh(new T.BoxGeometry(1.35, 0.49, 1.64), glass);
  cabin.position.set(0, 1.02, 0.1);
  model.add(chassis, cabin);
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
  const scene = new T.Scene();
  scene.background = new T.Color('#bcd5d8');
  scene.fog = new T.FogExp2('#bfd5d8', 0.00112);
  const camera = new T.PerspectiveCamera(49, 1, 0.25, 4300);
  const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.65));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  renderer.domElement.setAttribute('aria-label', '오포 롯데캐슬 포레스트 3D 공간');
  renderer.domElement.tabIndex = 0;
  renderer.domElement.dataset.world = 'opo';
  host.appendChild(renderer.domElement);

  const sun = new T.DirectionalLight('#fff0d2', 2.35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(window.innerWidth < 720 ? 1024 : 2048, window.innerWidth < 720 ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -250, right: 250, top: 250, bottom: -250, near: 1, far: 1200 });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.16;
  const ambient = new T.HemisphereLight('#e2f5ff', '#92805e', 1.8);
  scene.add(sun, sun.target, ambient);
  const terrain = makeGround(data);
  terrain.castShadow = true;
  scene.add(terrain);
  const { occluders, anchors, roofs } = buildMeshes(data, scene);
  const environment = addEnvironment(data, scene);
  const site = addSiteDetails(data, scene);
  const greenAccess = addGreenAccess(data, scene);
  scene.updateMatrixWorld(true);
  const analysis = createLightAnalyzer(data, terrain, occluders, site.grade);

  const endOfTile = ({ x, z }: Point) => Math.abs(x) > extent - 20 || Math.abs(z) > extent - 20;
  const occupied = (p: Point) => data.buildings.some(b => b.shapes.some(shape => inShape(p, shape)));
  const spawn = data.project(roadEntry);
  let position = spawn;
  let speed = 0;
  let heading = -2.04;
  let viewAngle = 0;
  let pitch = 0.17;
  let mode: ViewMode = 'orbit';
  let eyeLevel = false;
  let selecting = false;
  let active = true;
  let satelliteTexture: T.Texture | null = null;
  const carEntry = data.project(approach);
  let drivePosition = carEntry;
  const { player, legs } = makePlayer();
  const car = makeCar();
  scene.add(player, car);
  player.visible = false;
  car.visible = false;

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 52;
  controls.maxDistance = 2600;
  controls.zoomToCursor = true;
  function overview() {
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

  const labels: { point: T.Vector3; element: HTMLSpanElement; enabled: () => boolean; keepInFrame?: boolean }[] = anchors.map(({ point, building }) => {
    const element = document.createElement('span');
    element.className = 'building-label';
    element.textContent = building.dong;
    host.appendChild(element);
    return { point, element, enabled: () => true };
  });
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
  const playground = data.project(playgroundReference);
  const facilityLabel = document.createElement('span');
  facilityLabel.className = 'building-label facility-label';
  facilityLabel.textContent = '놀이시설 등록 위치';
  facilityLabel.hidden = true;
  host.appendChild(facilityLabel);
  labels.push({ point: new T.Vector3(playground.x, data.ground(playground.x, playground.z) + 3.6, playground.z),
    element: facilityLabel, enabled: () => site.overlay.visible });
  for (const layer of greenAccess.layers) {
    const element = document.createElement('span');
    element.className = 'building-label access-label';
    element.textContent = `${layer.name} 인근`;
    element.hidden = true;
    host.appendChild(element);
    const { x, z } = layer.endpoint;
    labels.push({ point: new T.Vector3(x, data.ground(x, z) + 5, z), element, enabled: () => layer.group.visible, keepInFrame: true });
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

  function setMode(next: ViewMode) {
    if (mode === next && !eyeLevel) return;
    const previous = mode;
    if (next === 'drive') {
      drivePosition = carEntry;
      position = drivePosition;
      heading = approachHeading;
    } else if (previous === 'drive') {
      const sidewalk = { x: drivePosition.x + Math.cos(heading) * 2.8, z: drivePosition.z - Math.sin(heading) * 2.8 };
      position = occupied(sidewalk) ? drivePosition : sidewalk;
    }
    mode = next;
    eyeLevel = false;
    speed = 0;
    viewAngle = 0;
    pitch = 0.17;
    movement.clear();
    player.visible = next === 'walk';
    car.visible = next === 'drive';
    controls.enabled = next === 'orbit' && !selecting;
    if (next === 'orbit') overview();
  }

  const movement = new Set<string>();
  const commands = new Map([
    ['KeyW', 'up'], ['ArrowUp', 'up'], ['KeyS', 'down'], ['ArrowDown', 'down'],
    ['KeyA', 'left'], ['ArrowLeft', 'left'], ['KeyD', 'right'], ['ArrowRight', 'right'],
  ]);
  function onKey(event: KeyboardEvent, press: boolean) {
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
  const blur = () => movement.clear();
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', blur);
  setMode('walk');

  const raycaster = new T.Raycaster();
  let drag: { id: number; x: number; y: number } | null = null;
  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', event => {
    if (mode === 'orbit' && !selecting) return;
    canvas.focus();
    canvas.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId || selecting) return;
    viewAngle -= (event.clientX - drag.x) * 0.006;
    pitch = T.MathUtils.clamp(pitch + (event.clientY - drag.y) * 0.004, eyeLevel ? -0.63 : -0.05, 0.85);
    drag.x = event.clientX; drag.y = event.clientY;
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('pointerup', event => {
    if (!drag || event.pointerId !== drag.id) return;
    if (selecting && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 12) {
      const frame = canvas.getBoundingClientRect();
      const pointer = new T.Vector2((event.clientX - frame.left) / frame.width * 2 - 1, -((event.clientY - frame.top) / frame.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects([terrain, ...occluders], false)[0];
      if (hit) onPick({ x: hit.point.x, z: hit.point.z });
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
      const move = selecting ? 0 : Number(movement.has('up')) - Number(movement.has('down'));
      const steer = selecting ? 0 : Number(movement.has('right')) - Number(movement.has('left'));
      const driving = mode === 'drive';
      speed = T.MathUtils.damp(speed, move * (driving ? 12 : 3), 5, elapsed);
      heading += steer * (driving ? Math.max(0.65, Math.abs(speed) * 0.15) : 2.2) * elapsed * (driving && speed < -0.05 ? -1 : 1);
      const proposed = { x: position.x + Math.sin(heading) * speed * elapsed, z: position.z - Math.cos(heading) * speed * elapsed };
      const next = driving && Math.abs(speed) > 0.01 ? site.driveTo(proposed) : proposed;
      if (next && Math.abs(speed) > 0.01 && !endOfTile(next) && !occupied(next)) position = next;
      if (driving) drivePosition = position;
      const y = site.grade(position.x, position.z);
      const actor = driving ? car : player;
      actor.position.set(position.x, y, position.z);
      actor.rotation.y = -heading;
      if (!driving) legs.forEach((leg, index) => { leg.rotation.x = Math.sin(now / 78 + index * Math.PI) * Math.min(0.68, Math.abs(speed) * 0.25); });

      const angle = heading + viewAngle;
      if (eyeLevel) {
        camera.position.set(position.x, y + observationHeight, position.z);
        const tilt = (0.17 - pitch) * Math.PI / 2;
        target.set(position.x + Math.sin(angle), camera.position.y + Math.tan(tilt), position.z - Math.cos(angle));
      } else {
        const distance = driving ? 7.6 : 4.15;
        const x = position.x - Math.sin(angle) * distance;
        const z = position.z + Math.cos(angle) * distance;
        destination.set(x, Math.max(y, data.ground(x, z)) + (driving ? 2.9 : 1.9) + pitch * distance, z);
        target.set(position.x + Math.sin(angle) * 4, y + (driving ? 1.1 : 1.7) - (pitch - 0.17) * 3, position.z - Math.cos(angle) * 4);
        if (camera.position.distanceTo(destination) > 20) camera.position.copy(destination);
        else camera.position.lerp(destination, 1 - Math.exp(-elapsed * 8));
      }
      camera.lookAt(target);
    }

    camera.updateMatrixWorld();
    for (const { point, element, enabled, keepInFrame } of labels) {
      projected.copy(point).project(camera);
      const visible = enabled() && projected.z < 1 && projected.z > -1 && Math.abs(projected.x) < 0.97 && Math.abs(projected.y) < 0.97;
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
    sources: { terrain: data.terrainSource, osmSnapshot: data.snapshot, referenceHeight: data.referenceHeight },
    setMode,
    focus() { canvas.focus({ preventScroll: true }); },
    setSelect(enabled: boolean) {
      selecting = enabled;
      controls.enabled = mode === 'orbit' && !enabled;
      canvas.dataset.selecting = String(enabled);
      if (enabled) movement.clear();
    },
    movement(command: string, pressed: boolean) { if (pressed) movement.add(command); else movement.delete(command); },
    locate() {
      if (mode === 'orbit') { overview(); return; }
      setMode(mode);
      position = mode === 'drive' ? carEntry : spawn;
      heading = mode === 'drive' ? approachHeading : -2.04;
      viewAngle = 0;
      speed = 0;
    },
    lookFrom(point: Point, bearing: number, obstructionAngle: number) {
      setMode('walk');
      eyeLevel = true;
      player.visible = false;
      movement.clear();
      position = point;
      heading = T.MathUtils.degToRad(bearing) + data.northOffset;
      viewAngle = 0;
      pitch = 0.17 - obstructionAngle / 180;
      speed = 0;
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
      const y = site.grade(location.x, location.z);
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
      (scene.background as T.Color).set(daylight ? '#bcd5d8' : '#7e95aa');
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
    directionProfile: (point: Point, bearing: number) => directionProfile(data, roofs, site.grade, point, bearing),
    async showSatellite(enabled: boolean) {
      if (enabled && !satelliteTexture) {
        const texture = await new T.TextureLoader().loadAsync('/opo-sentinel.png');
        if (!active) { texture.dispose(); return; }
        texture.colorSpace = T.SRGBColorSpace;
        texture.anisotropy = 4;
        satelliteTexture = texture;
      }
      terrain.material.map = enabled ? satelliteTexture : null;
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
      const materials = new Set<T.Material>(), geometries = new Set<T.BufferGeometry>();
      scene.traverse(object => {
        if (object instanceof T.Mesh || object instanceof T.Line) {
          geometries.add(object.geometry);
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
        }
      });
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) {
        if (material instanceof T.MeshStandardMaterial && material.map !== satelliteTexture) material.map?.dispose();
        material.dispose();
      }
      satelliteTexture?.dispose();
      sun.shadow.dispose();
      renderer.dispose();
      canvas.remove();
      labels.forEach(({ element }) => element.remove());
    },
  };
}

export type OpoWorld = ReturnType<typeof openOpoWorld>;
