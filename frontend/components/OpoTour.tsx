'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { loadOpoData, type Point } from './opo-data';
import { horizonRange, type DirectionProfile } from './opo-horizon';
import { observationHeight, type LightReport, type LightSample } from './opo-sunlight';
import { openOpoWorld, type OpoWorld, type SitePoint, type Slot, type ViewMode } from './opo-world';
import satelliteMetadata from '../public/opo-sentinel.json';
import greenAccess from '../public/opo-green-access.json';
import { regions, type RegionId } from './data/regions';

const slots: Slot[] = ['A', 'B'];
const initialDate = '2026-12-21';
const capture = new Date(Date.parse(satelliteMetadata.acquired_at) + 9 * 3600000);
const captureMinute = capture.getUTCHours() * 60 + capture.getUTCMinutes();
type Points = Partial<Record<Slot, SitePoint>>;
type AnalysisTab = 'sun' | 'nature' | 'site' | 'places';
const modeLabels: Record<ViewMode, string> = { orbit: '조감', walk: '걷기', drive: '운전' };
const directions = [ ['up', '↑', '전진'], ['left', '←', '왼쪽'], ['down', '↓', '후진'], ['right', '→', '오른쪽'] ];
const bearings = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];

function timeLabel(minute: number) {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function duration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}시간 ${minutes % 60}분` : `${minutes}분`;
}

function meters(value: number) {
  return Number.isFinite(value) ? `약 ${Math.round(value / 10) * 10}m` : '자료 없음';
}

function Timeline({ report, minute }: { report: LightReport; minute: number }) {
  const runs: { status: string; length: number; start: number }[] = [];
  report.samples.forEach((sample, i) => {
    const last = runs[runs.length - 1];
    if (last?.status === sample.status) last.length++;
    else runs.push({ status: sample.status, length: 1, start: i });
  });
  return <div className="timeline" aria-hidden="true">
    {runs.map(run => <span key={run.start} className={`strip-${run.status}`} style={{ flexGrow: run.length }} />)}
    <i style={{ left: `${minute / 14.4}%` }} />
  </div>;
}

function TerrainSection({ profiles, onLook }: {
  profiles: { slot: Slot; point: SitePoint; profile: DirectionProfile }[];
  onLook: (point: SitePoint, angle: number) => void;
}) {
  const envelope = Math.max(10, ...profiles.flatMap(({ profile }) => profile.heights.map(Math.abs)));
  return <div className="terrain-profiles">
    {profiles.map(({ slot, point, profile: { heights: values, hit, terrainAngleBelowBuilding, nearestHeightGap } }) => {
      const peak = Math.round(Math.max(...values));
      const end = Math.round(values[values.length - 1]);
      return <div key={slot} className={`profile-${slot}`}>
        <div className="profile-title"><b>{slot} 지점</b><span>지형 최대 상승 약 {peak}m</span></div>
        <div className="profile-plot" aria-hidden="true">
          {values.map((value, i) => <i key={i} style={{ height: `${Math.abs(value) / envelope * 48}%`, top: `${value > 0 ? 50 - value / envelope * 48 : 50}%` }} />)}
        </div>
        <div className="profile-title plot-scale"><span>0m</span><span>{horizonRange}m · 고도차 {end > 0 ? '+' : ''}{end}m</span></div>
        <div className="horizon-result">
          <strong>{hit ? `차폐각 약 ${hit.angle.toFixed(1)}°` : '모델상 수평선 위 차폐 없음'}</strong>
          {hit && <small>{hit.source} · 약 {Math.round(hit.distance)}m</small>}
          {terrainAngleBelowBuilding !== null && <small>지형만 적용 시 약 {terrainAngleBelowBuilding.toFixed(1)}°</small>}
          {nearestHeightGap !== null && <small className="horizon-gap">높이 미확인 건물 · 약 {Math.round(nearestHeightGap)}m</small>}
        </div>
        <button className="eye-view" aria-label={`${slot} 지점 눈높이로 보기`} onClick={() => onLook(point, hit?.angle ?? 0)}>눈높이로 보기</button>
      </div>;
    })}
  </div>;
}

export default function OpoTour({region = 'opo'}: {region?: RegionId}) {
  const area = regions.find(r => r.id === region)!;
  const host = useRef<HTMLDivElement>(null);
  const pickSlot = useRef<Slot | null>(null);
  const [world, setWorld] = useState<OpoWorld | null>(null);
  const [mode, setMode] = useState<ViewMode>(region === 'opo' ? 'walk' : 'orbit');
  const [date, setDate] = useState(initialDate);
  const [minute, setMinute] = useState(840);
  const [points, setPoints] = useState<Points>({});
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(true);
  const [placeCategory, setPlaceCategory] = useState('all');
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [tab, setTab] = useState<AnalysisTab>('sun');
  const [accessId, setAccessId] = useState<string | null>(null);
  const [bearing, setBearing] = useState(0);
  const [satellite, setSatellite] = useState(false);
  const [imageStatus, setImageStatus] = useState<'loading' | 'error' | 'idle'>('idle');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(max-width: 780px)').matches) setOpen(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active: OpoWorld | undefined;
    loadOpoData(controller.signal, region).then(data => {
      if (controller.signal.aborted || !host.current) return;
      active = openOpoWorld(host.current, data, location => {
        const slot = pickSlot.current;
        if (!slot || !active) return;
        if (!active.canAnalyze(location)) {
          setStatus('건물 밖에서 단지에 가까운 실외 지점을 선택해 주세요.');
          return;
        }
        setPoints(current => ({ ...current, [slot]: { ...location, id: 'custom', label: '직접 선택한 지점' } }));
        setSelectedSlot(null);
        setStatus('');
      });
      const options = active.presets;
      setPoints({ A: options[0], B: options[options.length - 1] });
      active.setMode(region === 'opo' ? 'walk' : 'orbit');
      setWorld(active);
    }).catch(() => {
      if (!controller.signal.aborted) setError('3D 공간을 열지 못했어요. 브라우저의 그래픽 가속과 자료 연결을 확인해 주세요.');
    });
    return () => {
      controller.abort();
      active?.dispose();
    };
  }, [retry, region]);

  useEffect(() => {
    if (!world || !date) return;
    world.light(date, minute);
  }, [world, date, minute]);

  useEffect(() => {
    if (!world) return;
    for (const slot of slots) {
      const point = points[slot];
      if (point) world.place(slot, point);
    }
  }, [world, points]);

  useEffect(() => {
    pickSlot.current = selectedSlot;
    world?.setSelect(selectedSlot !== null);
  }, [world, selectedSlot]);

  useEffect(() => {
    world?.showSiteDetails(open && tab === 'site');
    world?.showPlaces(open && tab === 'places' ? (placeCategory === 'all' ? ['beauty','convenience','school'] : [placeCategory]) : []);
  }, [world, open, tab, placeCategory]);

  const reports = useMemo(() => {
    const result: Partial<Record<Slot, LightReport>> = {};
    if (world && date) for (const slot of slots) {
      if (points[slot]) result[slot] = world.report(points[slot], date);
    }
    return result;
  }, [world, points, date]);

  const moment = useMemo(() => {
    const result: Partial<Record<Slot, LightSample>> = {};
    if (world && date && open && tab === 'sun') for (const slot of slots) {
      if (points[slot]) result[slot] = world.lightAt(points[slot], date, minute);
    }
    return result;
  }, [world, date, open, tab, points, minute]);

  const nature = useMemo(() => {
    if (!world || tab !== 'nature') return {};
    return Object.fromEntries(slots.filter(slot => points[slot]).map(slot => [slot, world.environmentAt(points[slot]) ]));
  }, [world, tab, points]);
  const profiles = useMemo(() => {
    if (!world || !open || tab !== 'nature') return [];
    return slots.flatMap(slot => {
      const point = points[slot];
      return point ? [{ slot, point, profile: world.directionProfile(point, bearing) }] : [];
    });
  }, [world, open, tab, points, bearing]);

  function chooseMode(next: ViewMode) {
    setSelectedSlot(null);
    setStatus('');
    setMode(next);
    world?.setMode(next);
    if (next !== 'orbit') {
      world?.focus();
      if (window.matchMedia('(max-width: 780px)').matches) setOpen(false);
    }
  }

  function chooseTab(next: AnalysisTab) {
    setSelectedSlot(null);
    setStatus('');
    if (next !== 'nature') {
      setAccessId(null);
      world?.showGreenAccess(null);
    }
    setTab(next);
  }

  function selectPlace(id: string) {
    setSelectedPlaceId(id);
    world?.focusPlace(id);
    setMode('orbit');
  }

  function toggleGreenAccess(id: string) {
    if (!world) return;
    const next = accessId === id ? null : id;
    setAccessId(next);
    setSelectedSlot(null);
    setStatus('');
    if (next) {
      setMode('orbit');
      if (window.matchMedia('(max-width: 780px)').matches) setOpen(false);
    }
    world.showGreenAccess(next);
  }

  function choosePoint(slot: Slot, point: SitePoint) {
    setPoints(current => ({ ...current, [slot]: point }));
    setSelectedSlot(null);
    setStatus('');
  }

  function useCurrentPosition() {
    if (!world || !selectedSlot) return;
    const position = world.position();
    if (!world.canAnalyze(position)) {
      setStatus('단지에 가까운 실외 지점으로 이동해 주세요.');
      return;
    }
    choosePoint(selectedSlot, { ...position, id: 'custom', label: '현재 위치에서 선택' });
  }

  async function toggleSatellite() {
    if (!world) return;
    setImageStatus('loading');
    try {
      await world.showSatellite(!satellite);
      setSatellite(!satellite);
      setImageStatus('idle');
    } catch {
      setImageStatus('error');
    }
  }

  return <main className="tour" data-satellite={satellite} onKeyDown={event => {
    if (event.key === 'Escape') { setSelectedSlot(null); setStatus(''); }
  }}>
    <div className="world" ref={host} />

    <header className="tour-title">
      <div className="brand"><span aria-hidden="true" className="brand-icon">⌂</span> Find My Shelter</div>
      <div className="place"><h1>{area.name}</h1><p>{area.area}</p></div>
    </header>

    <nav className="view-controls" aria-label="3D 탐색 모드">
      {(Object.keys(modeLabels) as ViewMode[]).map(key => <button key={key} disabled={!world} aria-pressed={mode === key} onClick={() => chooseMode(key)}>{modeLabels[key]}</button>)}
      <button className="recenter" aria-label="시작 위치로 돌아가기" title="시작 위치로 돌아가기" disabled={!world} onClick={() => world?.locate()}>⌖</button>
    </nav>

    <button className="analysis-toggle" aria-expanded={open} aria-controls="analysis-panel" onClick={() => setOpen(value => !value)}>{open ? '분석 접기' : '주거환경 분석'}</button>
    {open && <aside id="analysis-panel" className="analysis" aria-label="주거환경 분석">
      <div className="analysis-heading"><h2>주거환경 분석</h2><button aria-label="분석 접기" onClick={() => setOpen(false)}>−</button></div>
      <div className="analysis-tabs" aria-label="분석 항목">
        <button aria-pressed={tab === 'sun'} onClick={() => chooseTab('sun')}>일조 비교</button>
        <button aria-pressed={tab === 'nature'} onClick={() => chooseTab('nature')}>주변 자연환경</button>
        <button aria-pressed={tab === 'places'} onClick={() => chooseTab('places')}>생활·학교</button>
        {region === 'opo' && <button aria-pressed={tab === 'site'} onClick={() => chooseTab('site')}>단지 시설</button>}
      </div>

      {tab === 'sun' && <>
        <div className="date-row">
          <label>비교 날짜 <input aria-label="비교 날짜" type="date" min="1900-01-01" max="2100-12-31" value={date} onChange={event => {
            if (event.target.validity.valid) setDate(event.target.value);
          }} /></label>
          <button onClick={() => setDate(`${date.slice(0, 4) || '2026'}-12-21`)}>겨울</button>
          <button onClick={() => setDate(`${date.slice(0, 4) || '2026'}-06-21`)}>여름</button>
        </div>
        <div className="time-row">
          <label htmlFor="tour-time">그림자 시각</label><output htmlFor="tour-time">{timeLabel(minute)} <small>KST</small></output>
          <input id="tour-time" type="range" min={0} max={1439} step={1} value={minute} aria-valuetext={timeLabel(minute)} onChange={event => setMinute(Number(event.target.value))} />
          <div className="time-scale"><span>00시</span><span>06시</span><span>12시</span><span>18시</span><span>24시</span></div>
        </div>
      </>}

      {(tab === 'sun' || tab === 'nature') && <div className={tab === 'nature' ? 'locations nature-locations' : 'locations'}>
        {slots.map(slot => {
          const point = points[slot], report = reports[slot];
          const sample = moment[slot];
          const details = nature[slot];
          return <article key={slot} className={`site-card site-${slot}`}>
            <div className="site-row">
              <span className="slot">{slot}</span>
              <select aria-label={`지점 ${slot}`} value={point?.id ?? ''} disabled={!world} onChange={event => {
                const next = world?.presets.find(preset => preset.id === event.target.value);
                if (next) choosePoint(slot, next);
              }}>
                <option value="" disabled>지점 선택</option>
                {point?.id === 'custom' && <option value="custom">{point.label}</option>}
                {world?.presets.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
              </select>
              <button aria-label={`3D 공간에서 지점 ${slot} 선택`} title={`3D 공간에서 지점 ${slot} 선택`} aria-pressed={selectedSlot === slot} disabled={!world} onClick={() => {
                setSelectedSlot(selectedSlot === slot ? null : slot);
                setStatus('');
              }}>⌖</button>
            </div>
            {tab === 'sun' && report && sample && <>
              <div className="sun-total"><strong>{duration(report.sunMinutes)}</strong><span>모델상 직사광</span></div>
              <Timeline report={report} minute={minute} />
              <p className="site-status">{sample.status === 'sun' ? '모델상 직사광' : sample.status === 'night' ? '태양이 지평선 아래에 있어요' : sample.status === 'shade' ? `모델상 그늘 · ${sample.cause}` : `미판정 · ${sample.cause}`}</p>
              {report.unclassifiedMinutes > 0 && <p className="site-status">하루 중 미판정 {duration(report.unclassifiedMinutes)}</p>}
            </>}
            {tab === 'nature' && details && <dl className="nature-values">
              <div><dt>가까운 녹지 경계</dt><dd>{meters(details.green)}</dd></div>
              <div><dt>가까운 수계</dt><dd>{meters(details.water)}</dd></div>
              <div><dt>모델 표고</dt><dd>약 {Math.round(details.elevation)}m</dd></div>
              <div><dt>지형 예측 산포</dt><dd>{details.spread.toFixed(1)}m</dd></div>
            </dl>}
          </article>;
        })}
      </div>}

      {tab === 'sun' ? <>
        <div className="legend"><span><i className="strip-sun"/>직사광</span><span><i className="strip-shade"/>그늘</span><span><i className="strip-unknown"/>자료 한계</span></div>
        <details className="basis"><summary>계산 기준과 자료</summary>
          <p>맑은 하늘을 가정하고 지면에서 1.5m 높이의 지점을 10분 간격으로 계산합니다. 건물과 지형이 태양을 가리는지 검사합니다.</p>
          <p>건물 높이는 QGIS 편집본 후보값과 OSM에 기록된 높이를 사용합니다. 지형은 {world?.sources.terrain.name ?? 'GEDTM30'}의 약 {world?.sources.terrain.resolution ?? 30}m 표고 모델을 사용합니다. 실제 날씨와 수목은 계산에 반영하지 않습니다.</p>
          <p>모델 내 최대 건물 높이({world?.sources.referenceHeight.toLocaleString('ko-KR') ?? '—'}m)까지의 차폐를 검토합니다. 햇빛 방향에 높이 미확인 건물이 있거나 건물 표본 밖에서 차폐 가능성이 있으면 해당 시간을 미판정으로 남깁니다.</p>
          <p>막대는 00~24시입니다. 누적 시간은 10분 구간의 중앙 시점으로 계산하고, 시각을 옮길 때의 판정은 화면에 표시된 시각을 사용합니다.</p>
          <a href="https://github.com/hypnos3/suncalc3" target="_blank" rel="noreferrer">태양 위치 계산 · SunCalc3 ↗</a>
        </details>
      </> : tab === 'nature' && <>
        <div className="terrain-heading"><h3>방향별 시야와 지형 단면</h3>
          <select aria-label="시야와 지형 단면 방향" value={bearing} onChange={event => setBearing(Number(event.target.value))}>
            {bearings.map((label, i) => <option key={label} value={i * 45}>{label}쪽</option>)}
          </select>
        </div>
        <p className="horizon-caption">차폐각은 눈높이 {observationHeight}m에서 지형이나 건물이 수평선 위를 가리는 각도예요.</p>
        <TerrainSection profiles={profiles} onLook={(point, angle) => {
          setSelectedSlot(null);
          setStatus('');
          setMode('walk');
          setAccessId(null);
          world?.showGreenAccess(null);
          world?.lookFrom(point, bearing, angle);
        }} />
        {region === 'opo' && <><div className="imagery-row">
          <button aria-pressed={satellite} disabled={!world || imageStatus === 'loading'} onClick={toggleSatellite}>위성영상 {satellite ? '켜짐' : '꺼짐'}</button>
          <span role="status">{imageStatus === 'error' ? '영상을 열지 못했어요.' : imageStatus === 'loading' ? '불러오는 중…' : `${satelliteMetadata.acquired} · ${satelliteMetadata.resolution_m}m`}</span>
        </div>
        <button className="capture-comparison" disabled={!world || imageStatus === 'loading'} onClick={() => {
          setDate(satelliteMetadata.acquired);
          setMinute(captureMinute);
          if (!satellite) void toggleSatellite();
          chooseTab('sun');
        }}>위성 촬영 시각으로 일조 보기 · {timeLabel(captureMinute)} KST</button>
        <div className="green-access">
          <h3>공원 인근 도로 연결</h3>
          <p>단지 진입부 출발 · 점선은 보도 연결 미확인 구간이에요.</p>
          {greenAccess.routes.map(route => <div key={route.id} className="site-card access-card">
            <div className="access-heading"><strong>{route.name}</strong><span>{meters(route.lengthM)}</span></div>
            <p>{route.endLabel}{route.gapM !== null && ` · 등록 위치까지 직선 약 ${route.gapM}m`}</p>
            <button disabled={!world} aria-pressed={accessId === route.id} onClick={() => toggleGreenAccess(route.id)}>{accessId === route.id ? '경로 숨기기' : '경로 보기'}</button>
            <a href={route.referenceSource} target="_blank" rel="noreferrer">위치 출처 ↗</a>
          </div>)}
        </div></>}
        <details className="basis"><summary>자료와 계산 기준</summary>
          <p>지형 단면은 출발 지면을 0m로 두고 {horizonRange}m까지 50m 간격으로 표시합니다. {world?.sources.terrain.name ?? 'GEDTM30'}을 사용하며 표고 기준은 {world?.sources.terrain.datum ?? 'EGM2008'}입니다. 자료 기준 기간은 {world?.sources.terrain.epoch ?? '2006–2015'}입니다.</p>
          <p>차폐각은 선택한 한 방향으로 {horizonRange}m 안의 지형 표본과 모델에 높이가 있는 건물 지붕 중 가장 위에 보이는 각도입니다. 높이 미확인 건물은 별도로 표시합니다. 주변 건물 높이 자료의 범위가 제한되며 수목과 {horizonRange}m 밖의 지형은 별도 확인이 필요합니다.</p>
          <p>예측 산포는 지형 모델의 예측 변동입니다. 보도·옹벽·계단과 현장 표고 오차는 별도 확인이 필요합니다.</p>
          {world?.sources.terrain.relativeDifference != null && <p>기존 90m 자료와 중앙 기준점에 맞춰 비교한 상대 높이의 평균 절대 차이는 {world.sources.terrain.relativeDifference.toFixed(1)}m입니다.</p>}
          <a href={world?.sources.terrain.catalog ?? 'https://zenodo.org/records/15689805'} target="_blank" rel="noreferrer">지형 출처 · Ho &amp; Hengl / CC BY 4.0 ↗</a>
          <p>녹지와 수계 수치는 OpenStreetMap 스냅샷 ({world?.sources.osmSnapshot ?? '불러오는 중'})에 표시된 가장 가까운 경계·선까지의 직선거리입니다. 접근 가능 여부와 실제 보행 거리는 현장 확인이 필요합니다.</p>
          <p>공원 인근 경로는 OpenStreetMap에서 같은 노드로 이어진 도로의 길이입니다. 보도가 지도에 표시된 구간은 실선으로 그립니다. 공원 출입구와 전체 보행 경로는 확인 중입니다.</p>
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap 데이터 ↗</a>
        </details>
      </>}

      {tab === 'places' && <div className="place-explorer">
        <div className="place-explorer-heading"><span>동네 탐색</span><p>아래 장소를 선택해 지도에서 위치를 확인하세요.</p></div>
        <div className="place-filters" aria-label="장소 종류">{[['all','전체'],['beauty','올리브영'],['convenience','편의점'],['school','학교']].map(([id,label]) => <button key={id} aria-pressed={placeCategory === id} onClick={() => { setPlaceCategory(id); setSelectedPlaceId(null); }}>{label}</button>)}</div>
        <div className="place-list" aria-label="주변 장소 목록">{world?.places.filter(p => placeCategory === 'all' || p.category === placeCategory).map(p => <button className="place-row" aria-pressed={selectedPlaceId === p.id} key={p.id} onClick={() => selectPlace(p.id)}><span className={`place-kind place-kind-${p.category}`} aria-hidden="true">{p.category === 'school' ? '학' : p.category === 'beauty' ? '영' : '편'}</span><strong>{p.name}</strong><small>직선 {p.distance_m.toLocaleString()}m</small></button>)}</div>
        {selectedPlaceId && world?.places.find(p => p.id === selectedPlaceId) && (() => { const p = world.places.find(place => place.id === selectedPlaceId)!; return <section className="place-detail"><span>{p.category === 'school' ? '학교' : p.category === 'beauty' ? '생활용품' : '편의점'}</span><h3>{p.name}</h3><p>단지 기준 직선 약 {p.distance_m.toLocaleString()}m 지점입니다. 3D 지도가 이 위치를 중심으로 이동했어요.</p></section>; })()}
        <div className="place-note"><strong>학교 위치와 통학구역은 달라요</strong><p>현재는 학교 위치만 표시합니다. 배정 학교와 학군 경계는 공식 자료를 연결한 뒤 별도 레이어로 제공합니다.</p><a href="https://schoolzone.emac.kr/" target="_blank" rel="noreferrer">공식 학구도 확인 ↗</a></div>
        <details className="basis"><summary>장소 데이터 기준</summary><p>OpenStreetMap / OpenFreeMap 2026-11-15 지도 스냅샷. 현재 영업 여부·상호 변경은 확인이 필요하며, 모든 시설을 포함하지는 않습니다. 거리는 EPSG:5186 기준 단지 원점에서의 직선거리이며 도보거리가 아닙니다.</p><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors · ODbL ↗</a></details>
      </div>}

      {tab === 'site' && <div className="site-features">
        <div className="site-key"><span><i className="site-outline-key"/>OSM 단지 영역</span><span><i className="site-road-key"/>진입로와 단지 도로</span></div>
        <div className="site-card"><strong>수레실길에서 단지로</strong><p>운전 모드에서 수레실길 진입부와 교량을 지나 단지 도로로 들어갈 수 있어요.</p>
          <a href="https://www.openstreetmap.org/way/835665646" target="_blank" rel="noreferrer">교량 좌표 출처 ↗</a>
        </div>
        <div className="site-card"><strong>등록된 놀이시설</strong><ul>
          <li><a href="https://www.yugacrew.com/gyeonggi/gwangju/playground/29639" target="_blank" rel="noreferrer">놀이광장 ↗</a></li>
          <li><a href="https://www.yugacrew.com/gyeonggi/gwangju/playground/28626" target="_blank" rel="noreferrer">놀이의 테라스 ↗</a></li>
        </ul><p>두 시설의 공개 좌표가 같아 등록 위치를 하나로 표시했어요. 시설별 상세 위치는 확인 중입니다.</p></div>
        <details className="basis"><summary>단지 자료 기준</summary>
          <p>영역과 도로선은 OpenStreetMap 원본입니다. 교량 높이와 도로 폭은 화면용 추정입니다.</p>
          <a href="https://www.openstreetmap.org/way/835658915" target="_blank" rel="noreferrer">OSM 단지 영역 원본 ↗</a>
        </details>
      </div>}
    </aside>}

    {selectedSlot && <div className="selection-notice" role="status">
      <span>{status || `비교 지점 ${selectedSlot}에 넣을 실외 위치를 선택하세요.`}</span>
      {mode !== 'orbit' && <button onClick={useCurrentPosition}>현재 위치</button>}
      <button onClick={() => { setSelectedSlot(null); setStatus(''); }}>취소</button>
    </div>}

    {mode !== 'orbit' && <div className="movement" aria-label="이동 조작">
      {directions.map(([key, glyph, label]) => <button key={key} className={`move-${key}`} aria-label={label}
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); world?.movement(key, true); }}
        onLostPointerCapture={() => world?.movement(key, false)}
        onPointerUp={() => world?.movement(key, false)}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') world?.movement(key, true); }}
        onKeyUp={() => world?.movement(key, false)}
        onBlur={() => world?.movement(key, false)}>{glyph}</button>)}
    </div>}

    <div className="scene-instructions">{mode === 'orbit' ? '드래그로 회전 · 스크롤로 확대' : 'WASD로 이동 · 드래그로 둘러보기'}</div>

    {!world && <div className="loading" role="status">{error ? <><p>{error}</p><button onClick={() => { setError(''); setRetry(value => value + 1); }}>다시 열기</button></> : `${area.name}의 지형과 건물을 불러오는 중…`}</div>}

    <footer className="credits">
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a> · <a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap / OpenMapTiles</a> · <a href="https://zenodo.org/records/15689805" target="_blank" rel="noreferrer">GEDTM30 · Ho &amp; Hengl (CC BY 4.0)</a> · 실외 모델 추정
      {satellite && <> · <a href="https://registry.opendata.aws/sentinel-2-l2a-cogs/" target="_blank" rel="noreferrer">{satelliteMetadata.attribution}</a></>}
    </footer>
  </main>;
}
