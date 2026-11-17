'use client';

import { useEffect, useRef, useState } from 'react';
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import proj4 from 'proj4';
import { loadBuildingDataset } from './data/building-dataset';
import './polygon-preview.css';

const crs = '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs';
const regions = { songpa: '송파 · 600m 표본', opo: '오포 · 214개 표본' };

export default function PolygonPreview() {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<(top: boolean) => void>(() => {});
  const [region, setRegion] = useState<keyof typeof regions>('songpa');
  const [top, setTop] = useState(false);
  const [stats, setStats] = useState<{ count: number; missing: number; ms: number } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const signal = new AbortController();
    let dispose = () => {};
    setStats(null); setError(''); setTop(false);
    const start = performance.now();
    loadBuildingDataset(region, signal.signal).then(data => {
      if (signal.signal.aborted || !host.current) return;
      const container = host.current;
      const scene = new T.Scene();
      scene.background = new T.Color('#17243A');
      const renderer = new T.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.domElement.setAttribute('aria-label', `${regions[region]} 실제 건물 폴리곤`);
      renderer.domElement.setAttribute('role', 'img');
      container.appendChild(renderer.domElement);
      const camera = new T.PerspectiveCamera(42, 1, 1, 10000);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.maxPolarAngle = Math.PI / 2 - 0.02;
      controls.minDistance = 30;
      controls.maxDistance = 4000;
      scene.add(new T.HemisphereLight('#D8D5F0', '#354D65', 2.8));
      const sun = new T.DirectionalLight('#F8E9C6', 2.5);
      sun.position.set(-500, 1000, 400); scene.add(sun);
      const project = ([lng, lat]: number[]) => {
        const [x, y] = proj4('WGS84', crs, [lng, lat]);
        return new T.Vector2(x - data.metadata.local_origin_xy[0], y - data.metadata.local_origin_xy[1]);
      };
      const solid: T.BufferGeometry[] = [], unknown: T.BufferGeometry[] = [];
      for (const f of data.features) {
        const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
        for (const rings of polygons) {
          const shape = new T.Shape(rings[0].slice(0, -1).map(project));
          for (const hole of rings.slice(1)) shape.holes.push(new T.Path(hole.slice(0, -1).map(project)));
          const height = f.properties.height_m;
          const geometry = height !== null
            ? new T.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, steps: 1, curveSegments: 1 })
            : new T.ShapeGeometry(shape);
          geometry.rotateX(-Math.PI / 2);
          if (height === null) geometry.translate(0, 0.2, 0);
          // Use identical position/normal attributes for compact two-batch rendering.
          geometry.deleteAttribute('uv');
          (height === null ? unknown : solid).push(geometry.index ? geometry.toNonIndexed() : geometry);
          if (geometry.index) geometry.dispose();
        }
      }
      const geometries: T.BufferGeometry[] = [], materials: T.Material[] = [];
      for (const [parts, color] of [[solid, '#76C9BC'], [unknown, '#D8D5F0']] as const) {
        if (!parts.length) continue;
        const geometry = mergeGeometries([...parts], false);
        parts.forEach(part => part.dispose());
        if (!geometry) throw new Error('도형 렌더링 병합에 실패했습니다.');
        const material = new T.MeshStandardMaterial({ color, roughness: 0.85, side: T.DoubleSide });
        geometries.push(geometry); materials.push(material);
        scene.add(new T.Mesh(geometry, material));
      }
      const groundGeometry = new T.PlaneGeometry(2200, 2200);
      const groundMaterial = new T.MeshStandardMaterial({ color: '#253952', roughness: 1 });
      const ground = new T.Mesh(groundGeometry, groundMaterial);
      ground.rotation.x = -Math.PI / 2; ground.position.y = -0.2;
      scene.add(ground);
      const grid = new T.GridHelper(2200, 44, '#53677f', '#354D65');
      grid.position.y = -0.1; scene.add(grid);
      const render = () => renderer.render(scene, camera);
      const showView = (isTop: boolean) => {
        camera.up.set(0, 1, 0);
        camera.position.set(isTop ? 0 : 700, isTop ? 1800 : 1050, isTop ? 0.1 : 1100);
        controls.target.set(0, 0, 0); controls.update(); render();
      };
      view.current = showView;
      const resize = () => {
        camera.aspect = container.clientWidth / Math.max(1, container.clientHeight);
        camera.updateProjectionMatrix(); renderer.setSize(container.clientWidth, container.clientHeight); render();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(container);
      controls.addEventListener('change', render);
      showView(false); resize();
      setStats({ count: data.features.length, missing: data.features.filter(f => f.properties.height_m === null).length,
        ms: Math.round(performance.now() - start) });
      dispose = () => {
        observer.disconnect(); controls.removeEventListener('change', render); controls.dispose();
        geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
        groundGeometry.dispose(); groundMaterial.dispose(); grid.geometry.dispose();
        (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach(m => m.dispose());
        renderer.dispose(); renderer.domElement.remove(); view.current = () => {};
      };
    }).catch(e => { if (!signal.signal.aborted) setError(String(e.message ?? e)); });
    return () => { signal.abort(); dispose(); };
  }, [region]);

  return <main className="polygon-preview">
    <div ref={host} className="polygon-canvas" />
    <header className="polygon-header"><a href="/">Find My Shelter</a><h1>건물 데이터 검증</h1><p>QGIS 검증본 → 웹 폴리곤</p></header>
    <section className="polygon-tools" aria-label="폴리곤 검증 도구">
      <label>지역<select value={region} onChange={e => setRegion(e.target.value as keyof typeof regions)}>{Object.entries(regions).map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
      <div className="polygon-buttons"><button aria-pressed={!top} onClick={() => { setTop(false); view.current(false); }}>비스듬히</button><button aria-pressed={top} onClick={() => { setTop(true); view.current(true); }}>위에서</button></div>
      {stats ? <p role="status">{stats.count.toLocaleString()}개 표시 · 높이 미확인 {stats.missing}개<br /><small>데이터 로딩·화면 준비 {stats.ms.toLocaleString()}ms</small></p> : <p role="status">{error || '폴리곤을 불러오는 중…'}</p>}
      <div className="polygon-key"><span><i />높이 값 있음</span><span><i />높이 미확인 · 평면</span></div>
      <p className="polygon-note">실제 건물 도형입니다. 높이는 검증 전 후보값을 포함합니다. 바닥은 비교용 평면이며 DEM·도로·학군은 이 검증 화면에 연결하지 않았습니다.</p>
      <a href={`/datasets/buildings/${region}/manifest.json`} target="_blank" rel="noreferrer">데이터 품질·출처 보기 ↗</a>
    </section>
    <footer className="polygon-hint">드래그로 회전 · 스크롤로 확대 · 우클릭 드래그로 이동 · 격자 50m</footer>
  </main>;
}
