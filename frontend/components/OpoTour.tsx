'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { courtyard, courtyardGarden } from './opo-courtyard';
import { courtyardStairs } from './opo-garden';
import { loadOpoData, type CrossingLanding, type Point } from './opo-data';
import { entranceRoadView, entranceRoadViewDate, opoEntranceBridgeId } from './opo-entrance';
import { horizonChartStep, horizonRange, type DirectionProfile } from './opo-horizon';
import { routeAscent, routeTerrainStep, type RouteSlopeDirection, type RouteTerrainProfile, type RouteTerrainSample } from './opo-route-profile';
import { interval, nearSurfaceHeight, observationHeight, type LightReport, type LightSample } from './opo-sunlight';
import { sunGridSpacing, sunMapLegend, type SunMapCounts } from './opo-sun-map';
import { openOpoWorld, type OpoWorld, type SitePoint, type Slot, type ViewMode } from './opo-world';
import { facadeOffsetM, type FacadeView } from './opo-facades';
import satelliteMetadata from '../public/opo-sentinel.json';
import { songpaBusStop, songpaHomeLinks, songpaHospital, songpaStationAccess, songpaStationCrossings, songpaStationRouteId, visitRoutes } from './data/visit-routes';
import architecture from '../public/opo-architecture.json';
import { jamsilLeel, regions, seoulBiotopeSource, songpaComplex, type RegionId } from './data/regions';
import { songpaCourtyard, songpaFacilities, songpaFrontage, songpaGrounds, songpaJunction, songpaManagementFees, songpaPlayground } from './data/songpa-grounds';
import { songpaEntrance } from './data/songpa-entrance';
import { songpaStreets } from './data/songpa-streets';
import { ambientArchive, ambientTime, defaultAmbientMoment, type AmbientMoment } from './data/songpa-ambient';
import { latestLocalFloodYear, type FloodView } from './data/songpa-flood';
import { songpaSchool, songpaSchoolApproach } from './data/songpa-school';
import { songiPark, songiParkSurvey } from './data/songi-park';
import { songpaWinterCaptures, winterPixelGridSize, winterPixelSampleCount, type SongpaWinterCapture } from './data/songpa-winter-capture';
import { songpaArchitecture } from './data/songpa-architecture';
import { songpaRouteElevation } from './data/songpa-route-elevation';
import TourLive from './TourLive';
import SongpaAmbient from './SongpaAmbient';
import SongpaFlood from './SongpaFlood';
import SongpaChecklist, { useChecklistRecords } from './SongpaChecklist';
import type { ChecklistView } from './data/songpa-checklist';
import { useFieldVisits, type FieldScene } from './opo-field-visits';

const slots: Slot[] = ['A', 'B'];
const initialDate = '2026-12-21';
const seasonDates = [
  { label: '봄', day: '03-21' },
  { label: '여름', day: '06-21' },
  { label: '가을', day: '09-23' },
  { label: '겨울', day: '12-21' },
];
const capture = new Date(Date.parse(satelliteMetadata.acquired_at) + 9 * 3600000);
const captureMinute = capture.getUTCHours() * 60 + capture.getUTCMinutes();
type Points = Partial<Record<Slot, SitePoint>>;
type AnalysisTab = 'sun' | 'nature' | 'site' | 'places' | 'checklist' | 'ambient' | 'flood';
const modeLabels: Record<ViewMode, string> = { orbit: '조감', walk: '걷기', drive: '운전' };
const directions = [ ['up', '↑', '전진'], ['left', '←', '왼쪽'], ['down', '↓', '후진'], ['right', '→', '오른쪽'] ];
const bearings = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];

function timeLabel(minute: number) {
  const elapsed = Math.round(minute * 60_000);
  return new Date(elapsed).toISOString().slice(11, elapsed % 60_000 === 0 ? 16 : 19);
}

function duration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}시간 ${minutes % 60}분` : `${minutes}분`;
}

function meters(value: number) {
  return Number.isFinite(value) ? `약 ${Math.round(value / 10) * 10}m` : '자료 없음';
}

function crossingLandingLabel(landing: CrossingLanding | undefined, rangeM: number) {
  if (!landing || landing.gapM === null) return `${rangeM}m 안에서 미확인`;
  const surface = landing.surface === 'island' ? '교통섬' : '보도';
  if (landing.gapM === 0) return `${surface} 도형 맞닿음`;
  if (landing.gapM < 0.1) return `${surface}까지 0.1m 미만`;
  const rounded = Math.round(landing.gapM * 10) / 10;
  return `${surface}까지 약 ${rounded.toFixed(1)}m`;
}

function lightStatus(sample: LightSample) {
  if (sample.status === 'sun') return '모델상 직사광';
  if (sample.status === 'night') return '태양이 지평선 아래에 있어요';
  return `${sample.status === 'shade' ? '모델상 그늘' : '미판정'} · ${sample.cause}`;
}

function differentFloorLight(world: OpoWorld, point: Point, date: string, eye: LightSample) {
  const floor = world.lightNearSurface(point, date, eye.minute);
  return floor.status === eye.status ? undefined : lightStatus(floor);
}

const winterWalkStops = [
  { id: 'west-garden', shortName: '동 사이 산책로' },
  { id: 'playground-edge', shortName: '놀이터 옆' },
  { id: 'south-paving', shortName: '남쪽 포장로' },
];
const winterWalkHours = [13, 14, 15, 16, 17];
const winterStart = winterWalkHours[0] * 60;
const winterEnd = winterWalkHours[winterWalkHours.length - 1] * 60;
const winterMinutes = Array.from({ length: (winterEnd - winterStart) / interval + 1 }, (_, i) => winterStart + i * interval);
const winterWalkStatus = { sun: '직사광', shade: '그늘', unknown: '미판정', night: '일몰 후' };
type WinterWalkSelection = { id: string; hour: number };
type WalkLight = { date: string; minute: number; status: LightSample['status'] | 'outside'; text: string; floor?: string };

function winterSampleRanges(samples: LightSample[]) {
  const ranges: { first: number; last: number; status: LightSample['status'] }[] = [];
  for (const { minute, status } of samples) {
    const previous = ranges.at(-1);
    if (previous?.status === status) previous.last = minute;
    else ranges.push({ first: minute, last: minute, status });
  }
  return ranges;
}

function WinterWalk({ world, date, detailsRef, expanded, selection, onToggle, onSelect, onView, onSave }: {
  world: OpoWorld | null; date: string; detailsRef: React.RefObject<HTMLDetailsElement | null>;
  expanded: boolean; selection: WinterWalkSelection;
  onToggle: (expanded: boolean) => void; onSelect: (selection: WinterWalkSelection) => void;
  onView: (point: SitePoint, date: string, minute: number, trace: boolean) => void;
  onSave: (point: SitePoint, date: string, sample: LightSample) => void;
}) {
  const data = useMemo(() => winterWalkStops.map(stop => {
    const point = world?.presets.find(preset => preset.id === stop.id);
    const samples = point && world && expanded && date ? winterMinutes.map(minute => world.lightAt(point, date, minute)) : [];
    return { ...stop, point, samples };
  }), [world, date, expanded]);
  const stop = data.find(item => item.id === selection.id);
  const sample = stop?.samples.find(result => result.minute === selection.hour * 60);
  const selectedPoint = stop?.point;
  const floor = useMemo(() => world && selectedPoint && sample ? differentFloorLight(world, selectedPoint, date, sample) : undefined,
    [world, selectedPoint, date, sample]);

  return <details ref={detailsRef} className="season-compare winter-walk" open={expanded}
    onToggle={event => onToggle(event.currentTarget.open)}>
    <summary>겨울 오후 산책 비교</summary>
    <p className="season-caption">{date} · 한국 시간 · 보행면 위 {observationHeight}m · 맑은 날 모델</p>
    <table aria-label="겨울 오후 세 지점 모델 일조">
      <thead><tr><th scope="col">시각</th>{data.map(item => <th key={item.id} scope="col">{item.shortName}</th>)}</tr></thead>
      <tbody>{winterWalkHours.map(hour => <tr key={hour}>
        <th scope="row"><time>{timeLabel(hour * 60)}</time></th>
        {data.map(item => {
          const result = item.samples[(hour * 60 - winterStart) / interval];
          const label = result ? winterWalkStatus[result.status] : '—';
          return <td key={item.id}><button type="button" disabled={!result} data-status={result?.status}
            aria-label={`${item.point?.label ?? item.shortName} ${timeLabel(hour * 60)} ${label}`}
            aria-pressed={item.id === selection.id && hour === selection.hour}
            onClick={() => onSelect({ id: item.id, hour })}>{label}</button></td>;
        })}
      </tr>)}</tbody>
    </table>
    {sample && selectedPoint && stop && <div className="winter-walk-result">
      <strong>{selectedPoint.label} · {timeLabel(sample.minute)}</strong>
      <p>{lightStatus(sample)}</p>
      {floor && <p>발밑 · {floor}</p>}
      <p>{interval}분 간격 모델 표본</p>
      <ul className="winter-sample-ranges" aria-label="오후 일조 변화">
        {winterSampleRanges(stop.samples).map(({ first, last, status }) => <li key={first} data-status={status}>
          <span>{first === last ? timeLabel(first) : `${timeLabel(first)}~${timeLabel(last)}`}</span>
          <span>{winterWalkStatus[status]}</span>
        </li>)}
      </ul>
      <div className="site-actions">
        <button type="button" onClick={() => onView(selectedPoint, date, sample.minute, false)}>같은 시각에 걸어 보기</button>
        {sample.status !== 'night' && <button type="button" onClick={() => onView(selectedPoint, date, sample.minute, true)}>
          {sample.status === 'shade' ? '차폐 경로 보기' : sample.status === 'unknown' ? '미판정 방향 보기' : '태양 방향 보기'}
        </button>}
        <button type="button" onClick={() => onSave(selectedPoint, date, sample)}>현장 메모에 담기</button>
      </div>
    </div>}
    <p className="season-caption">눈높이와 판정이 다른 때는 발밑도 표시해요. 수목·구름의 영향과 실제 그늘 경계는 현장에서 확인해 주세요.</p>
  </details>;
}

function WinterCapture({ world, capture, onCaptureChange, onCompare, detailsRef }: {
  world: OpoWorld | null; capture: SongpaWinterCapture; onCaptureChange: (date: string) => void;
  onCompare: () => void; detailsRef: React.RefObject<HTMLDetailsElement | null>;
}) {
  const [expanded, setExpanded] = useState(false);
  const points = useMemo(() => capture.points.map((point, index) => {
    const preset = world?.presets.find(candidate => candidate.id === point.id);
    const model = expanded && preset ? world?.lightNearSurface(preset, capture.date, capture.exactMinute) : undefined;
    const samples = expanded ? world?.winterPixel(point.pixel, capture.date, capture.exactMinute) : undefined;
    return { ...point, slot: slots[index], model, samples };
  }), [capture, expanded, world]);
  const statuses = ['sun', 'shade', 'unknown', 'night', 'excluded'] as const;
  const statusLabels = { ...winterWalkStatus, night: '야간', excluded: '실외 분석 제외' };
  return <details ref={detailsRef} className="season-compare winter-capture"
    onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>겨울 위성영상과 비교</summary>
    <p>비교에 사용한 세 장면은 모두 오전 11시대에 촬영됐어요. 겨울 오후의 그늘 경계는 같은 시각의 관찰 자료가 필요해요.</p>
    <label className="winter-capture-date">촬영일
      <select value={capture.date} onChange={event => onCaptureChange(event.target.value)}>
        {songpaWinterCaptures.map(item => <option key={item.date} value={item.date}>{item.date}</option>)}
      </select>
    </label>
    <p className="season-caption"><time dateTime={capture.acquiredAt}>{capture.date} {capture.clock} KST</time> · Sentinel-2 · {capture.resolutionM}m 픽셀</p>
    <figure>
      <img src={capture.image} width={capture.width} height={capture.height}
        alt="가락동부센트레빌 겨울 위성영상. A는 101동 남서쪽 실외, B는 단지 중앙 포장로." loading="lazy" />
      {points.map(({ id, slot, pixel: [x, y] }) => <div key={id} className={`winter-cell site-${slot}`} aria-hidden="true"
        style={{ left: `${x / capture.width * 100}%`, top: `${y / capture.height * 100}%`,
          width: `${100 / capture.width}%`, height: `${100 / capture.height}%` }}>
        <span className="slot">{slot}</span>
      </div>)}
    </figure>
    <ul className="winter-observations">
      {points.map(({ id, slot, label, displayBrightness, model, samples }) => <li key={id}>
        <strong>{slot} · {label}</strong>
        <span>영상 표시 밝기 · {displayBrightness} / 255</span>
        <span>바닥 모델 중앙점 · {model ? lightStatus(model) : '계산 중'}</span>
        {samples && <>
          <div className="winter-pixel-grid" style={{ gridTemplateColumns: `repeat(${winterPixelGridSize}, 1fr)` }} aria-hidden="true">
            {samples.cells.map((status, index) => <i key={index} data-status={status} />)}
          </div>
          <span>픽셀 안 모델 표본 {winterPixelSampleCount}개 · {statuses
            .filter(status => samples.counts[status] > 0).map(status => `${statusLabels[status]} ${samples.counts[status]}개`).join(' · ')}</span>
          {samples.unknownCauses.length > 0 && <span>미판정 사유 · {samples.unknownCauses.join(' · ')}</span>}
        </>}
      </li>)}
    </ul>
    <div className="site-actions"><button type="button" disabled={!points.every(point => point.model)} onClick={onCompare}>같은 촬영 시각의 눈높이 일조 보기</button></div>
    <p>같은 10m 픽셀을 사용했고, 두 위치의 20m 장면분류는 비식생(등급 5)이에요. RGB 표시 밝기에는 바닥 재질과 수목의 영향이 섞여 있어요.</p>
    <p>픽셀 안의 모델 표본은 바닥 위 {nearSurfaceHeight * 100}cm, 3D 일조 화면은 눈높이 {observationHeight}m에서 계산해요.</p>
    <a href={capture.source} target="_blank" rel="noreferrer">촬영 원본과 메타데이터 ↗</a>
    <small>{capture.attribution}</small>
  </details>;
}

function Timeline({ report, minute, label, onTime }: {
  report: LightReport; minute: number; label: string; onTime: (minute: number) => void;
}) {
  const runs: { status: string; length: number; start: number }[] = [];
  report.samples.forEach((sample, i) => {
    const last = runs[runs.length - 1];
    if (last?.status === sample.status) last.length++;
    else runs.push({ status: sample.status, length: 1, start: i });
  });
  return <div className="timeline">
    {runs.map(run => <span aria-hidden="true" key={run.start} className={`strip-${run.status}`} style={{ flexGrow: run.length }} />)}
    <i aria-hidden="true" style={{ left: `${minute / 14.4}%` }} />
    <input aria-label={label} type="range" min={0} max={1439} step={1}
      value={Math.floor(minute)} aria-valuetext={`${timeLabel(minute)} KST`} onChange={event => onTime(Number(event.target.value))} />
  </div>;
}

function SeasonalSunlight({ world, point, year, minute, onTime, onPreview }: {
  world: OpoWorld; point: SitePoint; year: string; minute: number;
  onTime: (minute: number) => void; onPreview: (date: string) => void;
}) {
  const [reports, setReports] = useState<Partial<Record<string, LightReport>>>({});

  useEffect(() => {
    let index = 0;
    let frame: number;
    function nextDay() {
      const { day } = seasonDates[index++];
      const date = `${year}-${day}`;
      const report = world.report(point, date);
      setReports(previous => ({ ...previous, [date]: report }));
      if (index < seasonDates.length) frame = requestAnimationFrame(nextDay);
    }
    frame = requestAnimationFrame(nextDay);
    return () => cancelAnimationFrame(frame);
  }, [world, point, year]);

  return <ol className="season-days" aria-label="같은 지점의 계절별 일조 결과">
    {seasonDates.map(({ label, day }) => {
      const date = `${year}-${day}`;
      const report = reports[date];
      const sample = report && world.lightAt(point, date, minute);
      return <li key={date} className="site-card season-day">
        <div className="season-day-heading"><strong>{label}</strong><time dateTime={date}>{day.replace('-', '.')}</time>
          {report && <b>{duration(report.sunMinutes)} 직사광</b>}
        </div>
        {report && sample ? <>
          <Timeline report={report} minute={minute} label={`${label} 비교 시각`} onTime={onTime} />
          <p>{timeLabel(minute)} KST · {lightStatus(sample)}</p>
          <div className="season-day-footer">
            <small>하루 중 미판정 {duration(report.unclassifiedMinutes)}</small>
            <button type="button" className="light-trace" aria-label={`${label} 일조를 3D에서 보기`}
              disabled={sample.status === 'night'} onClick={() => onPreview(date)}>3D에서 보기 ↗</button>
          </div>
        </> : <p>계산 중…</p>}
      </li>;
    })}
  </ol>;
}

function TerrainSection({ profiles, onLook }: {
  profiles: { slot: Slot; point: SitePoint; profile: DirectionProfile }[];
  onLook: (point: SitePoint, angle: number) => void;
}) {
  const envelope = Math.max(10, ...profiles.flatMap(({ profile }) => profile.heights.map(value => Math.abs(value ?? 0))));
  return <div className="terrain-profiles">
    {profiles.map(({ slot, point, profile: { heights: values, hit, terrainAngleBelowBuilding, nearestHeightGap, terrainRange, buildingRange } }) => {
      const peak = Math.round(Math.max(...values.map(value => value ?? 0)));
      const last = values.at(-1);
      const end = last == null ? null : Math.round(last);
      const incompleteRange = buildingRange < horizonRange || terrainRange < horizonRange;
      const cutoff = hit && (hit.angle < 0.1 ? '0.1° 미만' : `약 ${hit.angle.toFixed(1)}°`);
      return <div key={slot} className={`profile-${slot}`}>
        <div className="profile-title"><b>{slot} · {point.label}</b><span>지형 최대 상승 약 {peak}m</span></div>
        <div className="profile-plot" aria-hidden="true">
          {values.map((value, i) => value === null ? <i key={i} style={{ visibility: 'hidden' }} />
            : <i key={i} style={{ height: `${Math.abs(value) / envelope * 48}%`, top: `${value > 0 ? 50 - value / envelope * 48 : 50}%` }} />)}
        </div>
        <div className="profile-title plot-scale"><span>0m</span><span>{horizonRange}m{end !== null && ` · 고도차 ${end > 0 ? '+' : ''}${end}m`}</span></div>
        <div className="horizon-result">
          <strong>{hit ? `자료상 차폐각 ${cutoff}`
            : nearestHeightGap !== null ? '높이 자료 부족 · 차폐 여부 미판정'
              : incompleteRange ? '확인 범위에서 차폐 없음' : '모델상 수평선 위 차폐 없음'}</strong>
          {hit && <small>{hit.source} · 약 {Math.round(hit.distance)}m</small>}
          {terrainAngleBelowBuilding !== null && <small>지형만 적용 시 약 {terrainAngleBelowBuilding.toFixed(1)}°</small>}
          {nearestHeightGap && <small className="horizon-gap">높이 미확인 · {nearestHeightGap.label} · 약 {Math.round(nearestHeightGap.distance)}m{hit && ' · 추가 차폐 가능'}</small>}
          {buildingRange < horizonRange && <small>건물 자료 약 {Math.round(buildingRange)}m까지 · 이후 미판정</small>}
          {terrainRange < horizonRange && <small>지형 자료 약 {Math.round(terrainRange)}m까지 · 이후 미판정</small>}
        </div>
        <button className="eye-view" aria-label={`${slot} 지점 ${point.label} 눈높이로 보기`} onClick={() => onLook(point, hit?.angle ?? 0)}>눈높이로 보기</button>
      </div>;
    })}
  </div>;
}

function RouteTerrain({ profile, selected, direction, startLabel, onSelect, onSlope, onLook }: {
  profile: RouteTerrainProfile; selected: number; startLabel: string; onSelect: (index: number) => void;
  direction: RouteSlopeDirection | null; onSlope: (direction: RouteSlopeDirection, index: number) => void;
  onLook: (sample: Pick<RouteTerrainSample, 'position' | 'bearing'>) => void;
}) {
  const sample = profile.samples[selected];
  if (!sample) return null;
  const elevations = profile.samples.map(point => point.elevation);
  const minimum = Math.min(...elevations), maximum = Math.max(...elevations);
  const span = Math.max(10, maximum - minimum);
  const x = (distance: number) => 8 + distance / profile.length * 284;
  const y = (height: number) => 67 - (height - minimum) / span * 52;
  const line = profile.samples.map(point => `${x(point.distance)},${y(point.elevation)}`).join(' ');
  const difference = profile.samples.at(-1)!.elevation - profile.samples[0].elevation;
  const { outbound, returning } = routeAscent(profile);
  const { survey, steepest, returnSteepest } = profile;
  const slope = direction === 'outbound' ? steepest : direction === 'returning' ? returnSteepest : undefined;
  const parkEntry = survey?.entranceSample === undefined ? undefined : profile.samples[survey.entranceSample];
  const parkRise = parkEntry ? profile.samples.at(-1)!.elevation - parkEntry.elevation : undefined;
  const step = survey ? songpaRouteElevation.routeStepM : routeTerrainStep;
  return <div className="route-terrain" data-route-section="profile" tabIndex={-1}>
    <strong>경로 주변 지형 단면{survey ? ' · 서울시 수치지형도' : ''}</strong>
    <div className="route-terrain-scale"><span>표고 약 {Math.round(maximum)}m</span><span>{step}m 간격 표본</span></div>
    <svg viewBox="0 0 300 80" aria-hidden="true">
      <polygon className="route-terrain-fill" points={`8,75 ${line} 292,75`} />
      {slope && <rect className="route-slope-band" x={x(slope.start)} y="5" width={x(slope.end) - x(slope.start)} height="70" />}
      <polyline points={line} />
      {!slope && <>
        <line x1={x(sample.distance)} x2={x(sample.distance)} y1="5" y2="75" />
        <circle cx={x(sample.distance)} cy={y(sample.elevation)} r="3.3" />
      </>}
    </svg>
    <div className="route-terrain-scale"><span>{startLabel} · 0m</span><span>종점 · {Math.round(profile.length).toLocaleString()}m</span></div>
    <label>단면에서 위치 선택
      <input aria-label="경로의 지형 표본 선택" type="range" min={0} max={profile.samples.length - 1} step={1}
        value={selected} aria-valuetext={`출발에서 ${Math.round(sample.distance)}m, 모델 표고 약 ${Math.round(sample.elevation)}m`}
        onChange={event => onSelect(Number(event.target.value))} />
    </label>
    <dl>
      {slope ? <div><dt>선택한 30m의 평균 오르막</dt><dd>+{slope.gradient.toFixed(1)}%</dd></div>
        : <>
          <div><dt>출발점부터</dt><dd>{Math.round(sample.distance)}m</dd></div>
          <div><dt>선택 지형의 표고</dt><dd>약 {Math.round(sample.elevation)}m</dd></div>
          {sample.gradient !== null && <div><dt>가는 방향 약 {Math.round(sample.gradientDistance)}m 지형 변화율</dt>
            <dd>{sample.gradient > 0 ? '+' : ''}{sample.gradient.toFixed(1)}%</dd></div>}
          {sample.spread !== undefined && <div><dt>지형 예측 산포</dt><dd>{sample.spread.toFixed(1)}m</dd></div>}
          {sample.nearestInputM !== undefined && <div><dt>가장 가까운 계산 입력</dt><dd>약 {Math.round(sample.nearestInputM)}m</dd></div>}
        </>}
      <div><dt>모델 누적 상승</dt><dd>가는 길 약 {Math.round(outbound)}m · 오는 길 약 {Math.round(returning)}m</dd></div>
    </dl>
    <p>종점 지형은 출발 지형보다 약 {Math.round(Math.abs(difference))}m {difference >= 0 ? '높아요' : '낮아요'}.</p>
    {parkEntry && parkRise !== undefined && <p>공원 남쪽 진입부부터 안쪽 보행로까지 약 {Math.round(profile.length - parkEntry.distance)}m 구간에서 모델 지형이 약 {Math.abs(parkRise).toFixed(1)}m {parkRise >= 0 ? '높아져요' : '낮아져요'}.</p>}
    {survey && <div className="site-actions">
      {steepest && <button aria-pressed={direction === 'outbound'} onClick={() => onSlope('outbound', steepest.index)}>가는 길 오르막 · {Math.round(steepest.start)}~{Math.round(steepest.end)}m · +{steepest.gradient.toFixed(1)}%</button>}
      {returnSteepest && <button aria-pressed={direction === 'returning'} onClick={() => onSlope('returning', returnSteepest.index)}>오는 길 오르막 · 종점부터 {Math.round(profile.length - returnSteepest.end)}~{Math.round(profile.length - returnSteepest.start)}m · +{returnSteepest.gradient.toFixed(1)}%</button>}
      {profile.samples.map((point, index) => point.contourM !== undefined
        ? <button key={point.distance} aria-pressed={!slope && selected === index} onClick={() => onSelect(index)}>{point.contourM}m 등고선 교차점 · 출발 {Math.round(point.distance)}m</button>
        : null)}
    </div>}
    {slope ? <>
      <p>노란색이 그래프와 3D에 표시된 30m 구간이에요.</p>
      <button className="route-look" onClick={() => onLook(slope.view)}>오르막 시작점 눈높이로 보기 ↗</button>
    </> : <>
      <button className="route-look" onClick={() => onLook(sample)}>선택 위치 눈높이로 보기 ↗</button>
      {survey && <button className="route-look" onClick={() => onLook({ position: sample.position, bearing: sample.bearing + 180 })}>오는 방향 눈높이로 보기 ↗</button>}
    </>}
    {survey ? <>
      <p>서울시 1:{songpaRouteElevation.scale.toLocaleString('ko-KR')} 수치지형도의 등고선과 표고점을 삼각망으로 보간했어요. 주변 표고점 {survey.checkedSpots}개를 하나씩 빼고 예측했을 때 평균 절대차는 약 {survey.meanErrorM.toFixed(1)}m였어요.</p>
      <p>실제 보도 경사, 계단·옹벽·교량 단차는 현장 확인이 필요해요.</p>
      <a href={songpaRouteElevation.source} target="_blank" rel="noreferrer">서울시 등고선과 표고점 원본 ↗</a>
    </> : <p>약 30m 지형 모델의 표고와 변화율입니다. 실제 보도 경사, 계단·옹벽·교량 단차는 현장 대조가 필요합니다.</p>}
  </div>;
}

export default function OpoTour({region = 'opo', onChangeRegion}: {region?: RegionId; onChangeRegion?: () => void}) {
  const area = regions.find(r => r.id === region)!;
  const access = visitRoutes[region];
  const field = useFieldVisits(region === 'songpa');
  const checklist = useChecklistRecords(region === 'songpa');
  const host = useRef<HTMLDivElement>(null);
  const pickSlot = useRef<Slot | null>(null);
  const analysisPanel = useRef<HTMLElement>(null);
  const activeAccessCard = useRef<HTMLDivElement>(null);
  const pendingAnalysisSection = useRef<{ tab: AnalysisTab; selector: string } | null>(null);
  const [returnChecklistItem, setReturnChecklistItem] = useState<string | null>(null);
  const winterDetails = useRef<HTMLDetailsElement>(null);
  const winterWalkDetails = useRef<HTMLDetailsElement>(null);
  const [showWinterEvidence, setShowWinterEvidence] = useState(false);
  const [showWinterWalk, setShowWinterWalk] = useState(false);
  const [winterViewing, setWinterViewing] = useState(false);
  const [walkLight, setWalkLight] = useState<WalkLight | null>(null);
  const [showVisitPlan, setShowVisitPlan] = useState(false);
  const [winterWalkOpen, setWinterWalkOpen] = useState(false);
  const [winterWalkSelection, setWinterWalkSelection] = useState<WinterWalkSelection>({ id: 'playground-edge', hour: 15 });
  const [world, setWorld] = useState<OpoWorld | null>(null);
  const [mode, setMode] = useState<ViewMode>('walk');
  const [walkingAtEyeLevel, setWalkingAtEyeLevel] = useState(true);
  const [date, setDate] = useState(initialDate);
  const [seasonOpen, setSeasonOpen] = useState(false);
  const [seasonSlot, setSeasonSlot] = useState<Slot>('A');
  const [minute, setMinute] = useState(840);
  const [points, setPoints] = useState<Points>({});
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [lightSlot, setLightSlot] = useState<Slot | null>(null);
  const [showSunMap, setShowSunMap] = useState(false);
  const [sunMapResult, setSunMapResult] = useState<{ date: string; minute: number; counts: SunMapCounts } | null>(null);
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const [placeCategory, setPlaceCategory] = useState('all');
  const [facadeId, setFacadeId] = useState<string | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [schoolZoneVisible, setSchoolZoneVisible] = useState(false);
  const [tab, setTab] = useState<AnalysisTab>(region === 'songpa' ? 'checklist' : region === 'jamsil-leel' ? 'site' : 'sun');
  const [accessId, setAccessId] = useState<string | null>(null);
  const [accessSample, setAccessSample] = useState(0);
  const [accessSlope, setAccessSlope] = useState<RouteSlopeDirection | null>(null);
  const [homeStep, setHomeStep] = useState<number | null>(null);
  const [bearing, setBearing] = useState(0);
  const [satellite, setSatellite] = useState(false);
  const [treeCoverVisible, setTreeCoverVisible] = useState(false);
  const [imageStatus, setImageStatus] = useState<'loading' | 'error' | 'idle'>('idle');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [ambientMoment, setAmbientMoment] = useState<AmbientMoment>(defaultAmbientMoment);
  const [ambientStopId, setAmbientStopId] = useState<string | null>(null);
  const [ambientReferenceId, setAmbientReferenceId] = useState<string | null>(null);
  const [floodYear, setFloodYear] = useState(latestLocalFloodYear);
  const [floodView, setFloodView] = useState<FloodView>('closest');
  const [floodStopId, setFloodStopId] = useState<string | null>(null);
  const [winterCaptureDate, setWinterCaptureDate] = useState(songpaWinterCaptures[0].date);
  const winterCapture = songpaWinterCaptures.find(capture => capture.date === winterCaptureDate) ?? songpaWinterCaptures[0];
  const ambientStop = world?.ambientScene?.stops.find(stop => stop.id === ambientStopId);
  const ambientReference = world?.ambientScene?.stops.find(stop => stop.id === ambientReferenceId)
    ?? world?.ambientScene?.stops.at(-1);
  const otherAmbientStop = ambientStop && world?.ambientScene?.stops.find(stop => stop.id !== ambientStop.id);
  const sceneDate = ambientStop ? ambientMoment.day : date;
  const sceneMinute = ambientStop ? ambientMoment.hour * 60 + ambientArchive.minute : minute;
  const winterStreet = winterViewing && tab === 'sun' && mode === 'walk';
  const guidedAccessId = tab === 'nature' && mode === 'walk' && homeStep !== null ? accessId : null;

  const [street, setStreet] = useState({ name: region === 'opo' ? '수레실길' : region === 'jamsil-leel' ? jamsilLeel.roadName : songpaComplex.roadName, speed: 0, touring: false });

  useEffect(() => {
    const controller = new AbortController();
    let active: OpoWorld | undefined;
    loadOpoData(controller.signal, region).then(data => {
      if (controller.signal.aborted || !host.current) return;
      active = openOpoWorld(host.current, data, (location, source) => {
        const slot = pickSlot.current;
        if (!slot || !active) return;
        if (!active.canAnalyze(location)) {
          setStatus('분석 범위 안의 실외 지점을 선택해 주세요.');
          return;
        }
        const label = source === 'sun-grid' ? '일조 지도에서 고른 표본' : '직접 선택한 지점';
        setPoints(current => ({ ...current, [slot]: { ...location, id: 'custom', label } }));
        setSelectedSlot(null);
        setStatus('');
      });
      const options = active.presets;
      const courtyardPoints = region === 'songpa' ? options.filter(point => point.id === 'west-garden' || point.id === 'playground-edge') : [];
      setPoints({
        A: courtyardPoints.find(point => point.id === 'west-garden') ?? options[0],
        B: courtyardPoints.find(point => point.id === 'playground-edge') ?? options.find(point => point.id === '104동') ?? options.at(-1),
      });
      active.setMode('walk');
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
    if (world && sceneDate) world.light(sceneDate, sceneMinute);
  }, [world, sceneDate, sceneMinute]);

  useEffect(() => {
    world?.setStudyLighting(winterStreet);
  }, [world, winterStreet]);

  useEffect(() => {
    if (!world) return;
    let sampledPosition: Point | undefined;
    function refresh() {
      if (!world) return;
      const next = world.streetStatus();
      setStreet(old => old.name === next.name && old.speed === next.speed && old.touring === next.touring ? old : next);
      if (!winterStreet || !date) return;
      const position = world.position();
      if (position === sampledPosition) return;
      sampledPosition = position;
      const sample = world.canAnalyze(position) ? world.lightAt(position, date, minute) : null;
      const status = sample?.status ?? 'outside';
      const text = sample ? lightStatus(sample) : '일조 분석 범위 밖';
      const floor = sample ? differentFloorLight(world, position, date, sample) : undefined;
      setWalkLight(old => old?.date === date && old.minute === minute && old.status === status && old.text === text && old.floor === floor
        ? old : { date, minute, status, text, floor });
    }
    refresh();
    const clock = window.setInterval(refresh, 210);
    return () => window.clearInterval(clock);
  }, [world, winterStreet, date, minute]);

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
    if (open) world?.walkStick(0, 0);
  }, [world, open]);

  useEffect(() => {
    world?.showSiteDetails(open && tab === 'site');
  }, [world, open, tab]);

  useEffect(() => {
    const categories = placeCategory === 'all' ? ['beauty', 'convenience', 'school'] : [placeCategory];
    world?.showPlaces(open && tab === 'places' && mode === 'orbit' && !schoolZoneVisible ? categories : [], selectedPlaceId);
  }, [world, open, tab, mode, placeCategory, schoolZoneVisible, selectedPlaceId]);

  useEffect(() => {
    world?.showSchoolZone(open && tab === 'places' && mode === 'orbit' && schoolZoneVisible);
  }, [world, open, tab, mode, schoolZoneVisible]);

  useEffect(() => {
    if (!world || !open || tab !== 'places' || mode !== 'orbit' || schoolZoneVisible) return;
    if (selectedPlaceId) world.focusPlace(selectedPlaceId);
    else world.frameNearbyPlaces(placeCategory);
  }, [world, open, tab, mode, schoolZoneVisible, placeCategory, selectedPlaceId]);

  useEffect(() => {
    const active = tab === 'ambient';
    world?.showAmbient(active && (open || Boolean(ambientStop)), active && open && mode === 'orbit', ambientReference?.id);
  }, [world, open, tab, mode, ambientStop, ambientReference?.id]);

  useEffect(() => {
    world?.showFlood(open && tab === 'flood' && mode === 'orbit' ? floodYear : null, floodView,
      tab === 'flood' && mode === 'walk' ? floodStopId : null);
  }, [world, open, tab, mode, floodYear, floodView, floodStopId]);

  useEffect(() => {
    world?.markGreenAccess(accessId, accessSample, accessSlope);
  }, [world, accessId, accessSample, accessSlope, mode]);

  useEffect(() => {
    world?.showGuidedWalk(guidedAccessId);
  }, [world, guidedAccessId]);

  useEffect(() => {
    if (open && tab === 'nature' && accessId && !pendingAnalysisSection.current) {
      activeAccessCard.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [accessId, open, tab]);

  useEffect(() => {
    if (!showWinterEvidence || !open || tab !== 'sun' || !winterDetails.current) return;
    winterDetails.current.open = true;
    winterDetails.current.scrollIntoView({ block: 'start' });
    winterDetails.current.querySelector('summary')?.focus({ preventScroll: true });
    setShowWinterEvidence(false);
  }, [showWinterEvidence, open, tab]);

  useEffect(() => {
    if (!showWinterWalk || !open || tab !== 'sun' || !winterWalkDetails.current) return;
    winterWalkDetails.current.scrollIntoView({ block: 'start' });
    winterWalkDetails.current.querySelector('summary')?.focus({ preventScroll: true });
    setShowWinterWalk(false);
  }, [showWinterWalk, open, tab]);

  useEffect(() => {
    if (!open || tab !== 'checklist') return;
    const checkId = showVisitPlan ? 'visit-plan' : returnChecklistItem;
    if (!checkId) return;
    const item = analysisPanel.current?.querySelector<HTMLDetailsElement>(`[data-check-id="${checkId}"]`);
    if (!item) return;
    item.open = true;
    item.scrollIntoView({ block: 'start' });
    item.querySelector('summary')?.focus({ preventScroll: true });
    setReturnChecklistItem(null);
    if (showVisitPlan) setShowVisitPlan(false);
  }, [showVisitPlan, open, tab, returnChecklistItem]);

  useEffect(() => {
    const pending = pendingAnalysisSection.current;
    if (!open || pending?.tab !== tab) return;
    const section = analysisPanel.current?.querySelector<HTMLElement>(pending.selector);
    if (!section) return;
    pendingAnalysisSection.current = null;
    section.scrollIntoView({ block: 'start' });
    section.focus({ preventScroll: true });
  }, [open, tab, accessId, placeCategory]);

  const lightPoint = lightSlot ? points[lightSlot] : undefined;
  useEffect(() => {
    world?.showLightPath(lightPoint && date && tab === 'sun' && !selectedSlot ? lightPoint : null, date, minute, lightSlot ?? 'A', true);
  }, [world, lightPoint, date, minute, lightSlot, tab, selectedSlot]);
  useEffect(() => {
    if (!showSunMap || !date || tab !== 'sun' || mode !== 'orbit') return;
    setSunMapResult(null);
    return world?.sunMap?.render(date, minute, counts => setSunMapResult({ date, minute, counts }));
  }, [world, date, minute, mode, showSunMap, tab]);

  const reports = useMemo(() => {
    const result: Partial<Record<Slot, LightReport>> = {};
    if (world && date && open && tab === 'sun') for (const slot of slots) {
      if (points[slot]) result[slot] = world.report(points[slot], date);
    }
    return result;
  }, [world, points, date, open, tab]);

  const moment = useMemo(() => {
    const result: Partial<Record<Slot, LightSample>> = {};
    if (world && date && (open || lightSlot !== null) && tab === 'sun') for (const slot of slots) {
      if (points[slot]) result[slot] = world.lightAt(points[slot], date, minute);
    }
    return result;
  }, [world, date, open, tab, points, minute, lightSlot]);

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

  const facade = world?.facades.find(view => view.id === facadeId) ?? world?.facades[0];
  const facing = useMemo(() => {
    if (!world || !open || tab !== 'site' || !facade) return;
    const { nearest, range } = world.buildingAhead(facade);
    const { hit, nearestHeightGap } = world.directionProfile(facade, facade.bearing);
    return {
      building: nearest ? `앞 건물 · ${nearest.name} · 직선 약 ${Math.round(nearest.distance)}m`
        : `앞 건물 · 자료 범위 약 ${Math.round(range)}m 안에서 미확인`,
      horizon: hit ? `자료상 차폐각 ${hit.angle < 0.1 ? '0.1° 미만' : `약 ${hit.angle.toFixed(1)}°`} · ${hit.source}`
        : nearestHeightGap ? '높이 자료 부족 · 차폐 여부 미판정' : '확인 범위에서 수평선 위 차폐 없음',
      heightGap: nearestHeightGap && `높이 미확인 · ${nearestHeightGap.label} · 약 ${Math.round(nearestHeightGap.distance)}m${hit ? ' · 추가 차폐 가능' : ''}`,
    };
  }, [world, facade, tab, open]);

  function chooseMode(next: ViewMode) {
    setWinterViewing(false);
    setAmbientStopId(null);
    setHomeStep(null);
    setShowSunMap(false);
    setLightSlot(null);
    setSelectedSlot(null);
    setStatus('');
    setMode(next);
    world?.setMode(next);
    if (next !== 'orbit') {
      hideTreeCover();
      world?.focus();
      if (window.matchMedia('(max-width: 780px)').matches) setOpen(false);
    }
  }

  function chooseTab(next: AnalysisTab) {
    if (pendingAnalysisSection.current?.tab !== next) pendingAnalysisSection.current = null;
    if (next !== 'sun') {
      setShowSunMap(false);
      setWinterViewing(false);
    }
    setLightSlot(null);
    setSelectedSlot(null);
    setStatus('');
    if (next !== 'nature') {
      hideTreeCover();
      setAccessId(null);
      world?.showGreenAccess(null);
    }
    if (next !== tab) analysisPanel.current?.scrollTo(0, 0);
    if (next !== 'ambient') setAmbientStopId(null);
    if (next !== 'flood') setFloodStopId(null);
    if (next !== 'places') setSchoolZoneVisible(false);
    if (next !== tab && (next === 'ambient' || next === 'flood' || next === 'places')) chooseMode('orbit');
    setTab(next);
  }

  function openFloodLocation(view: FloodView, year = floodYear) {
    if (mode === 'orbit' && year === floodYear && view === floodView) world?.showFlood(year, view);
    setFloodYear(year);
    setFloodView(view);
    setFloodStopId(null);
    chooseMode('orbit');
  }

  function selectPlace(id: string) {
    if (id === selectedPlaceId && mode === 'orbit' && !schoolZoneVisible) world?.focusPlace(id);
    setSchoolZoneVisible(false);
    setSelectedPlaceId(id);
    chooseMode('orbit');
  }

  function hideTreeCover() {
    setTreeCoverVisible(false);
    world?.showTreeCover(false);
  }

  function toggleTreeCover() {
    if (!world?.sources.treeCover) return;
    const enabled = !treeCoverVisible;
    setTreeCoverVisible(enabled);
    setSelectedSlot(null);
    setStatus('');
    if (enabled) setMode('orbit');
    world.showTreeCover(enabled);
  }

  function showAccessRoute(next: string | null) {
    if (!world) return;
    setHomeStep(null);
    setAccessId(next);
    if (next !== accessId) {
      setAccessSample(0);
      setAccessSlope(null);
    }
    setSelectedSlot(null);
    setStatus('');
    if (next) {
      setMode('orbit');
    }
    world.showGreenAccess(next);
  }

  function lookFromPoint(point: Point, direction: number, sightlineAngle?: number) {
    if (!world) return;
    setSelectedSlot(null);
    setStatus('');
    hideTreeCover();
    setWalkingAtEyeLevel(true);
    world.setWalkingCamera(true);
    world.lookFrom(point, direction, sightlineAngle);
    setMode('walk');
    if (window.matchMedia('(max-width: 780px)').matches) setOpen(false);
  }

  function viewFacade(view: FacadeView) {
    if (!world) return;
    pendingAnalysisSection.current = { tab: 'site', selector: '[data-site-card="facades"]' };
    lookFromPoint(view, view.bearing);
    setStreet(world.streetStatus());
    world.focus();
  }

  function lookAtRoutePoint(point: Pick<RouteTerrainSample, 'position' | 'bearing'>) {
    lookFromPoint(point.position, point.bearing);
  }

  function viewSchoolGate(routeId: string) {
    const view = world?.greenAccessProfiles.find(route => route.id === routeId)?.schoolView;
    if (!world || !view) return false;
    if (accessId !== routeId) showAccessRoute(routeId);
    const point = { ...view.position, label: songpaSchoolApproach.location };
    lookFromPoint(point, view.bearing);
    setStreet(world.streetStatus());
    world.focus();
    return true;
  }

  function visitAmbientStop(id: string) {
    const stop = world?.ambientScene?.stops.find(stop => stop.id === id);
    if (!world || !stop) return;
    setAmbientStopId(stop.id);
    setAmbientReferenceId(stop.id);
    lookFromPoint(stop.position, stop.bearing);
    setStreet(world.streetStatus());
    world.focus();
  }

  function viewHomeStop(routeId: string, index: number) {
    const stop = world?.greenAccessProfiles.find(route => route.id === routeId)?.homeWalk?.stops[index];
    if (!world || !stop) return;
    if (routeId !== accessId || homeStep === null || mode !== 'walk') showAccessRoute(routeId);
    setHomeStep(index);
    setAccessSlope(stop.id === 'return-uphill' ? 'returning' : null);
    const point = { ...stop.position, label: stop.name };
    lookFromPoint(point, stop.bearing);
    setStreet(world.streetStatus());
  }

  function openAccessRoute(id: string) {
    chooseTab('nature');
    showAccessRoute(id);
  }

  function choosePoint(slot: Slot, point: SitePoint) {
    setPoints(current => ({ ...current, [slot]: point }));
    setSelectedSlot(null);
    setStatus('');
  }

  function inspectLight(slot: Slot, previewDate?: string) {
    if (!world || !points[slot]) return;
    if (!previewDate && lightSlot === slot) { setLightSlot(null); return; }
    if (previewDate) setDate(previewDate);
    setShowSunMap(false);
    setLightSlot(slot);
    setSelectedSlot(null);
    setAccessId(null);
    setStatus('');
    world.showGreenAccess(null);
    setMode('orbit');
    if (window.matchMedia('(max-width: 780px)').matches) setOpen(false);
  }

  function showComplexSunMap() {
    setWinterViewing(false);
    if (!world?.sunMap) return;
    if (!date) setDate(initialDate);
    setLightSlot(null);
    setSelectedSlot(null);
    setStatus('');
    setAccessId(null);
    world.showGreenAccess(null);
    world.sunMap.focus();
    setMode('orbit');
    setShowSunMap(true);
  }

  function compareWinterCapture() {
    if (!world?.sunMap) return;
    const [a, b] = winterCapture.points.map(point => world.presets.find(preset => preset.id === point.id));
    if (!a || !b) return;
    chooseTab('sun');
    showComplexSunMap();
    setDate(winterCapture.date);
    setMinute(winterCapture.exactMinute);
    setPoints({ A: a, B: b });
  }

  function openWinterWalk() {
    chooseTab('sun');
    setWinterWalkOpen(true);
    setShowWinterWalk(true);
  }

  function openVisitPlan() {
    chooseTab('checklist');
    setOpen(true);
    setShowVisitPlan(true);
  }

  function saveWinterVisit(point: SitePoint, modelDate: string, sample: LightSample) {
    field.save({
      scene: { kind: 'winter', pointId: point.id, date: modelDate, minute: sample.minute },
      place: point.label, finding: lightStatus(sample),
    });
    openVisitPlan();
  }

  function openFieldVisit(scene: FieldScene) {
    if (!world) return false;
    if (scene.kind === 'facade') {
      const view = world.facades.find(item => item.id === scene.viewId);
      if (!view) return false;
      setReturnChecklistItem('visit-plan');
      chooseTab('site');
      setFacadeId(view.id);
      viewFacade(view);
      return true;
    }
    if (scene.kind === 'home') {
      const stops = world.greenAccessProfiles.find(route => route.id === scene.routeId)?.homeWalk?.stops;
      const index = stops?.findIndex(stop => stop.id === scene.stopId) ?? -1;
      if (index < 0) return false;
      setReturnChecklistItem('visit-plan');
      chooseTab('nature');
      viewHomeStop(scene.routeId, index);
      return true;
    }
    if (scene.kind === 'school-gate') {
      setReturnChecklistItem('visit-plan');
      chooseTab('nature');
      return viewSchoolGate(scene.routeId);
    }
    const point = world.presets.find(item => item.id === scene.pointId);
    if (!point || !world.destinations.some(item => item.id === point.id)) return false;
    setReturnChecklistItem('visit-plan');
    openWinterWalk();
    setWinterWalkSelection({ id: point.id, hour: scene.minute / 60 });
    viewWinterWalk(point, scene.date, scene.minute, false);
    return true;
  }

  function viewWinterWalk(point: SitePoint, winterDate: string, at: number, trace: boolean) {
    if (!world) return;
    setDate(winterDate);
    setMinute(at);
    choosePoint('A', point);
    if (!trace) {
      const sample = world.lightAt(point, winterDate, at);
      setWalkLight({ date: winterDate, minute: at, status: sample.status, text: lightStatus(sample),
        floor: differentFloorLight(world, point, winterDate, sample) });
      visitAtEyeLevel(point.id, point);
      return;
    }
    setWinterViewing(false);
    setShowSunMap(false);
    setAccessId(null);
    world.showGreenAccess(null);
    setLightSlot('A');
    setMode('orbit');
    if (window.matchMedia('(max-width: 780px)').matches) setOpen(false);
  }

  function useCurrentPosition() {
    if (!world || !selectedSlot) return;
    const position = world.position();
    if (!world.canAnalyze(position)) {
      setStatus('분석 범위 안의 실외 지점으로 이동해 주세요.');
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

  function walkStick(element: HTMLDivElement, x: number, y: number) {
    element.style.setProperty('--stick-x', `${x * 26}px`);
    element.style.setProperty('--stick-y', `${y * 26}px`);
    world?.walkStick(x, y);
  }

  function visit(id: string, observation?: SitePoint) {
    if (!world) return;
    const next = world.goTo(id, observation);
    if (!next) return;
    setWinterViewing(Boolean(observation));
    setAmbientStopId(null);
    setFloodStopId(null);
    hideTreeCover();
    setShowSunMap(false);
    setLightSlot(null);
    setMode(next);
    setSelectedSlot(null);
    setAccessId(null);
    setStatus('');
    world.showGreenAccess(null);
    if (window.matchMedia('(max-width: 780px)').matches) setOpen(false);
    return true;
  }

  function visitAtEyeLevel(id: string, observation?: SitePoint) {
    if (!world || !visit(id, observation)) return;
    setWalkingAtEyeLevel(true);
    world.setWalkingCamera(true);
    world.focus();
    return true;
  }

  function openChecklistView(target: ChecklistView, checkId: string) {
    if (!world) return;
    setReturnChecklistItem(checkId);
    switch (target) {
      case 'complex':
        chooseTab('site');
        chooseMode('orbit');
        world.locate();
        break;
      case 'paving':
      case 'parking':
      case 'facades':
        pendingAnalysisSection.current = { tab: 'site', selector: `[data-site-card="${target}"]` };
        chooseTab('site');
        break;
      case 'entrance':
      case 'garage':
        pendingAnalysisSection.current = { tab: 'site', selector: '[data-site-card="entrance"]' };
        chooseTab('site');
        visitAtEyeLevel(target === 'garage' ? songpaEntrance.garage.id : songpaEntrance.main.id);
        break;
      case 'sun':
        pendingAnalysisSection.current = { tab: 'sun', selector: '.sun-map-control' };
        chooseTab('sun');
        showComplexSunMap();
        break;
      case 'winter-walk':
        openWinterWalk();
        break;
      case 'winter-capture':
        compareWinterCapture();
        setShowWinterEvidence(true);
        break;
      case 'horizon':
        pendingAnalysisSection.current = { tab: 'nature', selector: '.terrain-heading' };
        chooseTab('nature');
        break;
      case 'ambient':
        chooseTab('ambient');
        break;
      case 'flood':
        chooseTab('flood');
        break;
      case 'station-home':
        chooseTab('nature');
        viewHomeStop(songpaStationRouteId, 0);
        break;
      case 'station-route':
      case 'park-route':
        pendingAnalysisSection.current = { tab: 'nature', selector: '[data-route-selected] .route-comparison' };
        openAccessRoute(target === 'station-route' ? songpaStationRouteId : songiPark.routeId);
        break;
      case 'station-access':
        pendingAnalysisSection.current = { tab: 'nature', selector: '.return-walk' };
        openAccessRoute(songpaStationRouteId);
        break;
      case 'park-entry':
        pendingAnalysisSection.current = { tab: 'nature', selector: '[data-route-section="park-entry"]' };
        openAccessRoute(songiPark.routeId);
        break;
      case 'park-profile':
      case 'station-profile':
      case 'school-profile':
        pendingAnalysisSection.current = { tab: 'nature', selector: '[data-route-section="profile"]' };
        openAccessRoute(target === 'park-profile' ? songiPark.routeId : target === 'station-profile' ? songpaStationRouteId : songpaSchool.routeId);
        break;
      case 'hospital-route':
        pendingAnalysisSection.current = { tab: 'nature', selector: '[data-route-section="hospital-entry"]' };
        openAccessRoute(songpaHospital.routeId);
        break;
      case 'bus-route':
        pendingAnalysisSection.current = { tab: 'nature', selector: '[data-route-section="bus-stop"]' };
        openAccessRoute(songpaBusStop.routeId);
        break;
      case 'school-route':
        pendingAnalysisSection.current = { tab: 'nature', selector: '[data-route-section="school-crossing"]' };
        openAccessRoute(songpaSchool.routeId);
        break;
      case 'school':
      case 'places':
        if (target === 'places') pendingAnalysisSection.current = { tab: 'places', selector: '.place-explorer-heading' };
        setPlaceCategory(target === 'school' ? 'school' : 'all');
        setSelectedPlaceId(null);
        chooseTab('places');
        setSchoolZoneVisible(target === 'school');
        break;
    }
  }

  const seasonYear = date.slice(0, 4) || initialDate.slice(0, 4);
  const seasonPoint = points[seasonSlot];
  const buildingRegister = world?.sources.register;
  const parkingSpaces = songpaFacilities.surfaceParking + songpaFacilities.undergroundParking;
  const managementTotal = songpaManagementFees.charges.reduce((sum, charge) => sum + charge.won, 0);
  const placeOrigin = world?.placeOrigin ?? (region === 'songpa' ? songpaEntrance.main.name : '단지 원점');
  const mapCounts = sunMapResult && date === sunMapResult.date && minute === sunMapResult.minute ? sunMapResult.counts : null;
  const homeWalk = guidedAccessId ? world?.greenAccessProfiles.find(route => route.id === guidedAccessId)?.homeWalk : null;
  const currentHomeStop = homeStep === null ? null : homeWalk?.stops[homeStep];

  return <main className="tour" data-mode={mode} data-satellite={satellite} onKeyDown={event => {
    if (event.key === 'Escape') { setSelectedSlot(null); setStatus(''); }
  }}>
    <div className="world" ref={host} />

    <header className="tour-title">
      <div className="brand"><span aria-hidden="true" className="brand-icon">⌂</span> Find My Shelter</div>
      <div className="place"><h1>{area.name}</h1><p>{area.area}</p></div>
      {(onChangeRegion || region === 'opo' || mode !== 'orbit' || world) && <div className="street-controls">
        {onChangeRegion && <button className="region-return" type="button" aria-haspopup="dialog" aria-controls="region-picker" onClick={onChangeRegion}>지역 바꾸기</button>}
        {(region === 'opo' || world?.destinations.length) ? <select aria-label="동네에서 장소로 이동" value="" disabled={!world} onChange={event => visit(event.target.value)}>
          <option value="" disabled>동네에서 장소로 이동</option>
          {world?.destinations.map(place => <option key={place.id} value={place.id}>{place.name}</option>)}
        </select> : null}
        {mode !== 'orbit' && <span className="street-position">{street.name}{mode === 'drive' && <b>{street.speed} km/h</b>}</span>}
        {world && <TourLive world={world} region={region} />}
      </div>}
    </header>

    {homeWalk && currentHomeStop && accessId && homeStep !== null && <section className="light-inspection walk-preview" aria-label="귀갓길 체험">
      <div aria-live="polite"><strong>{homeStep + 1}/{homeWalk.stops.length} · {currentHomeStop.name}</strong>
        <p>{currentHomeStop.evidence}</p></div>
      <ul className="walk-legend" aria-label="귀갓길 선 표시">
        <li><i aria-hidden="true" />보도 표기</li>
        <li><i className="walk-gap" aria-hidden="true" />연결 미확인</li>
        <li><i className="walk-aerial" aria-hidden="true" />영상 대조 · 위치 근사</li>
        {homeWalk.gardenDistances && <li><i className="walk-shared" aria-hidden="true" />보행·차량 공용 포장</li>}
      </ul>
      <div className="walk-preview-actions">
        <button type="button" disabled={homeStep === 0} onClick={() => viewHomeStop(accessId, homeStep - 1)}>이전</button>
        <button type="button" disabled={homeStep === homeWalk.stops.length - 1} onClick={() => viewHomeStop(accessId, homeStep + 1)}>다음</button>
        <button type="button" onClick={() => { showAccessRoute(accessId); setOpen(true); }}>경로 지도</button>
        {currentHomeStop.id === 'courtyard-walk' && <button type="button" onClick={() => {
          setWinterWalkSelection({ id: 'west-garden', hour: 15 });
          openWinterWalk();
          setOpen(true);
        }}>이 지점의 겨울 오후 일조 보기</button>}
        <button type="button" onClick={() => {
          const route = access.routes.find(item => item.id === accessId);
          field.save({
            scene: { kind: 'home', routeId: accessId, stopId: currentHomeStop.id },
            place: `${currentHomeStop.name} · ${route?.comparisonLabel ?? '보도 위주 경로'}`,
            finding: currentHomeStop.evidence,
          });
          openVisitPlan();
        }}>현장 메모에 담기</button>
      </div>
    </section>}

    {lightSlot && lightPoint && moment[lightSlot] && <section className="light-inspection" aria-label="선택한 햇빛 경로">
      <div aria-live="polite"><strong>{lightPoint.label}</strong><p>{date} · {timeLabel(minute)} KST</p>
        <p>{lightStatus(moment[lightSlot])}</p></div>
      <button aria-label="햇빛 경로 닫기" onClick={() => setLightSlot(null)}>×</button>
    </section>}
    {winterStreet && <section className="light-inspection" aria-label="겨울 일조 산책 시각">
      <div><strong>{date} · {timeLabel(minute)} KST</strong><p>건물·지형 그림자 · 보행면 위 {observationHeight}m</p>
        {walkLight?.date === date && walkLight.minute === minute && <div aria-live="polite">
          <p className="walking-light" data-status={walkLight.status}>현재 위치 · {walkLight.text}</p>
          {walkLight.floor && <p>발밑 · {walkLight.floor}</p>}
        </div>}
      </div>
    </section>}
    {ambientStop && <section className="light-inspection walk-preview" aria-label="소음·야간 3D 장면">
      <div aria-live="polite"><strong>{ambientStop.name}</strong>
        <p>{ambientMoment.day} · {ambientTime(ambientMoment.hour)} KST · 하늘과 조명 모형</p></div>
      <div className="walk-preview-actions">
        {!open && otherAmbientStop && <button type="button" onClick={() => visitAmbientStop(otherAmbientStop.id)}>{otherAmbientStop.name} 보기</button>}
        <button type="button" aria-label="관측 시각 미리보기 닫기" onClick={() => setAmbientStopId(null)}>닫기</button>
      </div>
    </section>}

    <nav className="view-controls" aria-label="3D 탐색 모드">
      {(Object.keys(modeLabels) as ViewMode[]).map(key => <button key={key} disabled={!world} aria-pressed={mode === key} onClick={() => chooseMode(key)}>{modeLabels[key]}</button>)}
      {mode === 'walk' && <button disabled={!world} aria-pressed={walkingAtEyeLevel} onClick={() => {
        if (!world) return;
        setWalkingAtEyeLevel(!walkingAtEyeLevel);
        world.setWalkingCamera(!walkingAtEyeLevel);
        world.focus();
      }}>눈높이</button>}
      <button className="recenter" aria-label="시작 위치로 돌아가기" title="시작 위치로 돌아가기" disabled={!world} onClick={() => {
        setAmbientStopId(null);
        setHomeStep(null);
        world?.locate();
      }}>⌖</button>
    </nav>
    {Boolean(world?.tripLength) && <button className="street-trip" aria-pressed={street.touring}
      title={`단지 입구에서 수레실 정류장을 거쳐 능평도서관까지 약 ${world?.tripLength}m`} onClick={() => {
        if (!world) return;
        setShowSunMap(false);
        setLightSlot(null);
        setSelectedSlot(null);
        setAccessId(null);
        world.showGreenAccess(null);
        hideTreeCover();
        const touring = world.toggleTrip();
        setMode('drive');
        setStreet(current => ({ ...current, touring }));
      }}>{street.touring ? '드라이브 정지' : '동네 드라이브'}</button>}

    <button className="analysis-toggle" aria-expanded={open} aria-controls="analysis-panel" onClick={() => {
      if (!open && tab === 'sun' && winterWalkOpen) setShowWinterWalk(true);
      setOpen(!open);
    }}>{open ? '분석 접기' : '주거환경 분석'}</button>
    {open && <aside id="analysis-panel" ref={analysisPanel} className="analysis" aria-label="주거환경 분석">
      <div className="analysis-heading"><h2>주거환경 분석</h2><button aria-label="분석 접기" onClick={() => setOpen(false)}>−</button></div>
      {returnChecklistItem && tab !== 'checklist' && <button className="checklist-return" type="button"
        onClick={() => chooseTab('checklist')}>체크리스트 항목으로 돌아가기</button>}
      <div className="analysis-tabs" aria-label="분석 항목">
        {region === 'songpa' && <button className="checklist-tab" aria-pressed={tab === 'checklist'} onClick={() => chooseTab('checklist')}>임장 체크리스트</button>}
        <button aria-pressed={tab === 'sun'} onClick={() => chooseTab('sun')}>일조 비교</button>
        <button aria-pressed={tab === 'nature'} onClick={() => chooseTab('nature')}>주변 자연환경</button>
        <button aria-pressed={tab === 'places'} onClick={() => chooseTab('places')}>생활·학교</button>
        <button aria-pressed={tab === 'site'} onClick={() => chooseTab('site')}>{region === 'opo' ? '단지 시설' : '단지 정보'}</button>
        {region === 'songpa' && <button className="ambient-tab" aria-pressed={tab === 'ambient'} onClick={() => chooseTab('ambient')}>소음·야간</button>}
        {region === 'songpa' && <button aria-pressed={tab === 'flood'} onClick={() => chooseTab('flood')}>물길·침수</button>}
      </div>

      {region === 'songpa' && tab === 'checklist' && <SongpaChecklist onView={openChecklistView} sceneReady={Boolean(world)}
        checklist={checklist} field={field} onOpenField={openFieldVisit} onShowField={openVisitPlan} />}
      {region === 'songpa' && tab === 'ambient' && <SongpaAmbient moment={ambientMoment} onTime={setAmbientMoment} scene={world?.ambientScene}
        activeStopId={ambientStopId} reference={ambientReference} mapVisible={mode === 'orbit'} onVisit={visitAmbientStop} onMap={() => {
          chooseMode('orbit');
          if (mode === 'orbit') world?.showAmbient(true, true, ambientReference?.id);
        }} />}
      {region === 'songpa' && tab === 'flood' && <SongpaFlood year={floodYear} view={floodView} sceneReady={Boolean(world)} mapVisible={mode === 'orbit'}
        distances={world?.floodDistances} activeStopId={mode === 'walk' ? floodStopId : null}
        onView={openFloodLocation} onVisit={id => { if (visitAtEyeLevel(id)) setFloodStopId(id); }} />}

      {tab === 'sun' && <>
        {region === 'jamsil-leel' && <p>잠실 르엘의 동별 높이는 확인 중이에요. 건물 높이 자료가 빠져 그림자를 확정할 수 없는 시간대는 미판정으로 표시해요.</p>}
        <div className="date-row">
          <label>비교 날짜 <input aria-label="비교 날짜" type="date" min="1900-01-01" max="2100-12-31" value={date} onChange={event => {
            if (event.target.validity.valid) setDate(event.target.value);
          }} /></label>
          <button onClick={() => setDate(`${date.slice(0, 4) || '2026'}-12-21`)}>겨울</button>
          <button onClick={() => setDate(`${date.slice(0, 4) || '2026'}-06-21`)}>여름</button>
        </div>
        <div className="time-row">
          <label htmlFor="tour-time">그림자 시각</label><output htmlFor="tour-time">{timeLabel(minute)} <small>KST</small></output>
          <input id="tour-time" type="range" min={0} max={1439} step={1} value={Math.floor(minute)} aria-valuetext={timeLabel(minute)} onChange={event => setMinute(Number(event.target.value))} />
          <div className="time-scale"><span>00시</span><span>06시</span><span>12시</span><span>18시</span><span>24시</span></div>
        </div>
        <div className="legend"><span><i className="strip-sun"/>직사광</span><span><i className="strip-shade"/>그늘</span><span><i className="strip-unknown"/>미판정</span><span><i className="strip-night"/>야간</span></div>
        {region === 'songpa' && <>
          <WinterWalk world={world} date={`${date.slice(0, 4) || initialDate.slice(0, 4)}-12-21`}
            detailsRef={winterWalkDetails} expanded={winterWalkOpen} selection={winterWalkSelection}
            onToggle={setWinterWalkOpen} onSelect={selection => {
              if (selection.id !== winterWalkSelection.id || selection.hour !== winterWalkSelection.hour) setLightSlot(null);
              setWinterWalkSelection(selection);
            }} onView={viewWinterWalk} onSave={saveWinterVisit} />
          <WinterCapture world={world} capture={winterCapture} onCaptureChange={setWinterCaptureDate}
            onCompare={compareWinterCapture} detailsRef={winterDetails} />
        </>}
        <details className="season-compare" open={seasonOpen} onToggle={event => setSeasonOpen(event.currentTarget.open)}>
          <summary>같은 지점의 계절별 일조</summary>
          {seasonOpen && <>
            <label className="season-point">
              <span>비교 지점</span>
              <select aria-label="계절 비교 지점" value={seasonSlot} onChange={event => setSeasonSlot(event.target.value as Slot)}>
                {slots.map(slot => <option key={slot} value={slot} disabled={!points[slot]}>{slot} · {points[slot]?.label ?? '지점 미선택'}</option>)}
              </select>
            </label>
            <p className="season-caption">{seasonYear}년 계절 대표일 · 관측 높이 {observationHeight}m<br/>일조 막대를 눌러 공통 시각을 바꿀 수 있어요.</p>
            {world && seasonPoint && <SeasonalSunlight
              key={`${seasonSlot}-${seasonPoint.x}-${seasonPoint.z}-${seasonYear}`}
              world={world} point={seasonPoint} year={seasonYear} minute={minute} onTime={setMinute}
              onPreview={nextDate => inspectLight(seasonSlot, nextDate)} />}
          </>}
        </details>
        {world?.sunMap && <section className="sun-map-control" tabIndex={-1} aria-label="단지 일조 분포">
          <button aria-pressed={showSunMap} disabled={!date} onClick={() => showSunMap ? setShowSunMap(false) : showComplexSunMap()}>단지 일조 분포</button>
          {showSunMap && (date ? mapCounts ? <>
            <p role="status">{timeLabel(minute)} · {Object.values(mapCounts).reduce((sum, count) => sum + count, 0)}개 실외 표본</p>
            <ul className="sun-map-key">
              {(mapCounts.night ? ['night'] as const : ['sun', 'building', 'terrain', 'unknown'] as const).map(kind => (
                <li key={kind}><i aria-hidden="true" data-shape={sunMapLegend[kind].shape} style={{ color: sunMapLegend[kind].color }} />
                  {sunMapLegend[kind].name} <strong>{mapCounts[kind]}</strong></li>
              ))}
            </ul>
            <p>{sunGridSpacing}m 간격으로 뽑은 점에서 계산했어요. A·B 옆 ⌖를 누른 뒤 지도 위 점을 선택하면 하루 일조를 비교할 수 있어요.</p>
          </> : <p role="status">일조 분포 계산 중…</p> : <p role="status">비교 날짜를 입력해 주세요.</p>)}
        </section>}
      </>}

      {(tab === 'sun' || tab === 'nature') && <div className={tab === 'nature' ? 'locations nature-locations' : 'locations'}>
        {slots.map(slot => {
          const point = points[slot], report = reports[slot];
          const sample = moment[slot];
          const details = nature[slot];
          const traceLabel = sample?.status === 'shade' ? '그늘 원인 보기' : sample?.heightGap ? '미판정 건물 보기' : '햇빛 방향 보기';
          return <article key={slot} className={`site-card site-${slot}`} tabIndex={-1}>
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
              <Timeline report={report} minute={minute} label={`지점 ${slot} 일조 시간 선택`} onTime={setMinute} />
              <p className="site-status">{lightStatus(sample)}</p>
              {sample.obstruction && <p className="site-status">차폐 지점까지 광선 거리 약 {Math.round(sample.obstruction.distance)}m</p>}
              {sample.heightGap && <p className="site-status">약 {Math.round(sample.heightGap.distance)}m 앞 · 이 건물이 햇빛을 가리려면 모델상 약 {Math.round(sample.heightGap.requiredHeight)}m 이상이어야 해요.</p>}
              <button className="light-trace" aria-label={`${slot} 지점 ${traceLabel}`}
                aria-pressed={lightSlot === slot} disabled={sample.status === 'night' && lightSlot !== slot}
                onClick={() => inspectLight(slot)}>{traceLabel} ↗</button>
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
       <details className="basis"><summary>계산 기준과 자료</summary>
          <p>맑은 하늘을 가정하고 지면에서 1.5m 높이의 지점을 10분 간격으로 계산합니다. 건물과 지형이 태양을 가리는지 검사합니다.</p>
          <p>3D 경로는 관측 지점에서 태양 방향으로 보낸 광선입니다. 그늘일 때 처음 닿은 건물 체적 또는 지형을 표시합니다. 점선은 자료 한계로 판정하지 못한 방향을 표시합니다.</p>
          <p>미판정에 영향을 주는 건물이 있으면 가장 가까운 건물의 지면 윤곽과 거리, 광선에 닿기 위한 모델상 최소 건물 높이를 표시합니다.</p>
          {region === 'songpa' && <p>눈높이는 포장과 보도를 포함한 모델 바닥 위 {observationHeight}m입니다. 겨울 산책에서 발밑 판정은 같은 바닥 위 5cm에서 계산합니다.</p>}
          {buildingRegister && <p>대상 주동은 건축HUB 표제부({buildingRegister.source.dataMonth})의 등록 높이로 건물 체적을 단순화해 계산합니다. 주변 건물은 QGIS 편집본 후보값과 OSM 높이를 사용합니다.</p>}
          <p>{world?.sources.localTerrain ? '단지 주변 지형은 서울시 등고선·표고점을 10m 간격으로 보간하고 외곽은 GEDTM30과 연결했어요.' :
            `지형은 ${world?.sources.terrain.name ?? 'GEDTM30'}의 약 ${world?.sources.terrain.resolution ?? 30}m 표고 모델입니다.`} 수목의 그늘은 현장에서 따로 확인해야 합니다.</p>
          <p>모델 내 최대 건물 높이({world?.sources.referenceHeight.toLocaleString('ko-KR') ?? '—'}m)까지의 차폐를 검토합니다. 햇빛 방향에 높이 미확인 건물이 있거나 건물 표본 밖에서 차폐 가능성이 있으면 해당 시간을 미판정으로 남깁니다.</p>
          <p>막대는 00~24시입니다. 누적 시간은 10분 구간의 중앙 시점으로 계산하고, 시각을 옮길 때의 판정은 화면에 표시된 시각을 사용합니다.</p>
          {world?.sunMap && <p>단지 일조 분포는 지도에 표시된 단지 경계 안의 {sunGridSpacing}m 간격 실외 표본에서 계산합니다. 표본 사이의 값은 추정하지 않으며, 표본 간격과 표고 자료의 해상도는 서로 다릅니다.</p>}
          <a href="https://github.com/hypnos3/suncalc3" target="_blank" rel="noreferrer">태양 위치 계산 · SunCalc3 ↗</a>
          {buildingRegister && <a href={buildingRegister.source.url} target="_blank" rel="noreferrer">주동 등록 높이 · 국토교통부 건축HUB ↗</a>}
          {region === 'songpa' && <a href="https://data.seoul.go.kr/dataList/OA-22424/S/1/datasetView.do" target="_blank" rel="noreferrer">높이 미기재 확인 · 서울시 건축물대장 표제부 ↗</a>}
        </details>
      </> : tab === 'nature' && <>
        <div className="terrain-heading" tabIndex={-1}><h3>방향별 시야와 지형 단면</h3>
          <select aria-label="시야와 지형 단면 방향" value={bearing} onChange={event => setBearing(Number(event.target.value))}>
            {bearings.map((label, i) => <option key={label} value={i * 45}>{label}쪽</option>)}
          </select>
        </div>
        <p className="horizon-caption">차폐각은 {region === 'songpa' ? '서 있는 바닥' : '모델 지면'}에서 {observationHeight}m 높이로 봤을 때 지형이나 건물이 수평선 위를 가리는 각도예요.</p>
        <TerrainSection profiles={profiles} onLook={(point, angle) => {
          setHomeStep(null);
          setAccessId(null);
          world?.showGreenAccess(null);
          lookFromPoint(point, bearing, angle);
          world?.focus();
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
        {world?.sources.treeCover && <>
          <div className="imagery-row">
            <button type="button" aria-pressed={treeCoverVisible} onClick={toggleTreeCover}>수목 피복</button>
            <span>{world.sources.treeCover.year}년 · {world.sources.treeCover.resolution}m</span>
          </div>
          {treeCoverVisible && <p className="tree-cover-legend">
            <i aria-hidden="true" /> 연두색은 위성 자료에서 나무가 덮인 곳으로 분류된 영역이에요.
          </p>}
        </>}
        </>}
        {access.routes.length > 0 && <section className="green-access" aria-label="주변 접근 경로">
          <h3>{region === 'songpa' ? '주변 시설 방향 경로' : '공원 인근 도로 연결'}</h3>
          <p>{access.startLabel} 출발 · 실선은 지도에 보행로·보도가 표시된 구간, 점선은 보도 미확인 구간이에요.</p>
          {access.retrieved && <p>지도 확인 {access.retrieved} · 노란 고리는 지도상 횡단 구간이에요. 단지 출입구와 신호 대기는 현장에서 확인해 주세요.</p>}
          {access.routes.filter(route => !route.variantOf).map(primary => {
            const alternative = access.routes.find(route => route.variantOf === primary.id);
            const route = alternative?.id === accessId ? alternative : primary;
            const hospital = route.id === songpaHospital.routeId ? songpaHospital : null;
            const accessDetails = world?.greenAccessProfiles.find(item => item.id === route.id);
            const profile = accessDetails?.profile;
            const crossing = accessDetails?.crossingView;
            const entrance = accessDetails?.entranceView;
            const schoolRoute = route.id === songpaSchoolApproach.routeId;
            const busView = accessDetails?.stopView;
            const home = accessDetails?.homeWalk;
            const crossingLandings = home?.crossingLandings;
            const selected = accessId === route.id;
            const routeVisible = selected && mode === 'orbit';
            return <div key={primary.id} ref={selected ? activeAccessCard : undefined}
              data-route-selected={selected || undefined} className="site-card access-card">
              <div className="access-heading"><strong>{schoolRoute ? '서울신가초 교문 앞' : route.name}</strong>
                <span>{schoolRoute ? `약 ${Math.round(route.lengthM + songpaSchoolApproach.walkM)}m`
                  : access.retrieved ? `${route.lengthM.toLocaleString()}m` : meters(route.lengthM)}</span></div>
              {alternative && <table className="route-comparison" tabIndex={-1}>
                <caption>같은 출발점과 종점 · 모델 누적 상승</caption>
                <thead><tr><th scope="col">경로</th><th scope="col">거리</th><th scope="col">가는 길 ↑</th><th scope="col">오는 길 ↑</th></tr></thead>
                <tbody>{[primary, alternative].map(option => {
                  const optionProfile = world?.greenAccessProfiles.find(item => item.id === option.id)?.profile;
                  const ascent = optionProfile?.survey ? routeAscent(optionProfile) : undefined;
                  return <tr key={option.id}>
                    <th scope="row"><button disabled={!world} aria-pressed={accessId === option.id} onClick={() => showAccessRoute(option.id)}>{option.comparisonLabel ?? '보도 위주 경로'}</button></th>
                    <td>{option.lengthM}m</td>
                    <td>{ascent ? `약 ${Math.round(ascent.outbound)}m` : '—'}</td>
                    <td>{ascent ? `약 ${Math.round(ascent.returning)}m` : '—'}</td>
                  </tr>;
                })}</tbody>
              </table>}
              <p>{schoolRoute ? `${songpaSchoolApproach.location} 보도까지` : route.endLabel}
                {route.gapM !== null && ` · ${hospital ? '조사 출입구' : '등록 위치'}까지 직선 약 ${route.gapM}m`}</p>
              {route.crossings && <p>보행로·보도 표기 약 {Math.round(route.walkwayM + (schoolRoute ? songpaSchoolApproach.walkM : 0)).toLocaleString()}m · 지도상 횡단 구간 {route.crossings.length}개</p>}
              {access.retrieved && route.lengthM > route.walkwayM && <p className="route-missing-sidewalk">약 {route.lengthM - route.walkwayM}m는 지도에 보도 표시가 없어요. 3D 지도에서 주황 점선으로 표시해요.</p>}
              {route.parkEntrance && <p>같은 출발점에서 남쪽 진입부까지 경로 약 {route.parkEntrance.routeM}m · 직선 약 {route.parkEntrance.directM}m</p>}
              {!hospital && route.stepWays !== undefined && <p>지도상 보행 경로의 계단 기록 {route.stepWays ? `${route.stepWays}개` : '없음'} · {home ? '역 출구 계단은 아래 참고' : '실제 턱·계단은 현장 확인'}</p>}
              <button disabled={!world} aria-pressed={routeVisible} onClick={() => showAccessRoute(routeVisible ? null : route.id)}>{routeVisible ? '경로 숨기기' : hospital ? '도로 연결과 출입구 보기' : '경로 보기'}</button>
              <a href={route.referenceSource} target="_blank" rel="noreferrer">위치 출처 ↗</a>
              {home && <section className="route-terrain return-walk" tabIndex={-1} aria-label="송파역에서 단지로 돌아오는 길">
                <strong>송파역에서 정문과 단지 안까지</strong>
                <p><b>{songpaStationAccess.exit}</b>는 체험 시작점이에요. 서울교통공사 안내도에 계단과 자전거 경사로가 표시돼 있어요.</p>
                <p><b>엘리베이터</b>는 {songpaStationAccess.elevator}에서 {songpaStationAccess.elevatorFloors}을 연결해요. 서울시 좌표를 보도 위에 표시했어요. 가동 여부와 승강기 문 앞 단차는 현장에서 확인해 주세요.</p>
                <a href={songpaStationAccess.guide} target="_blank" rel="noreferrer">서울교통공사 송파역 안내도 ({songpaStationAccess.guideDate}) ↗</a>
                <a href={songpaStationAccess.elevatorSource} target="_blank" rel="noreferrer">국가철도공단 설치 목록 ({songpaStationAccess.elevatorDate}) ↗</a>
                <a href={songpaStationAccess.elevatorLocation.source} target="_blank" rel="noreferrer">서울시 엘리베이터 위치 ({songpaStationAccess.elevatorLocation.sourceYear}년 기준) ↗</a>
                {home.crossingSignals && <>
                  <a href={home.crossingSignals.inventorySource} target="_blank" rel="noreferrer">서울시 횡단보도 시설 목록 ({home.crossingSignals.inventoryRecorded}) ↗</a>
                  <a href={home.crossingSignals.poleSource} target="_blank" rel="noreferrer">서울시 보행등 위치 (파일 갱신 {home.crossingSignals.poleFileUpdated}) ↗</a>
                </>}
                <ul className="walk-legend">
                  <li><i className="walk-mapped" aria-hidden="true" />지도상 보도 경로 {route.walkwayM}m · 양재대로60길 일부는 서울시 보도면을 따라 표시</li>
                  <li><i className="walk-mapped" aria-hidden="true" />2번 출구 앞 약 {songpaHomeLinks.stationExit.lengthM}m · 같은 서울시 보도면 안에 위치</li>
                  {route.id === songpaStationRouteId && <>
                    <li><i className="walk-mapped" aria-hidden="true" />양재대로 횡단보도 {songpaStationCrossings.crossings.length}곳과 연결 보도 · 서울시 도형 기준</li>
                    <li><i className="walk-aerial" aria-hidden="true" />교통섬 안의 보행로 · 항공영상에서 확인한 포장 위치</li>
                    <li><i className="walk-gap" aria-hidden="true" />횡단보도와 교통섬이 맞닿는 곳의 짧은 점선 · 연결부 턱은 현장 확인</li>
                  </>}
                  {home.frontageM !== null && <li><i className="walk-aerial" aria-hidden="true" />정문 블록 포장까지 서쪽 보도 약 {home.frontageM}m · {songpaEntrance.capturedIn} 로드뷰 대조 · 폭과 턱 높이는 근사</li>}
                  <li><i className="walk-gap" aria-hidden="true" />정문 {home.frontageM !== null ? `차단기 옆 약 ${home.gateLinkM}m 구간의 실제 보행 연결 미확인` : `방향 약 ${home.gateLinkM}m의 연결 미확인`}</li>
                  <li><i className="walk-aerial" aria-hidden="true" />단지 안 포장 공간까지 약 {home.insideM}m · 항공영상 기반 추정</li>
                  {home.gardenDistances && <>
                    <li><i className="walk-aerial" aria-hidden="true" />103·104동 사이 산책로까지 보행 포장 약 {Math.round(home.gardenDistances.walk)}m</li>
                    {home.gardenDistances.shared > 0 && <li><i className="walk-shared" aria-hidden="true" />같은 구간의 보행·차량 공용 포장 약 {Math.round(home.gardenDistances.shared)}m</li>}
                    {home.gardenDistances.gap > 0 && <li><i className="walk-gap" aria-hidden="true" />산책로 방향의 포장·보행 연결 미확인 약 {Math.round(home.gardenDistances.gap)}m</li>}
                  </>}
                </ul>
                {home.crossingSignals && <p>
                  보행등 있음 {home.crossingSignals.installed}곳 · 없음 {home.crossingSignals.absent}곳
                  {home.crossingSignals.unknown > 0 && ` · 미확인 ${home.crossingSignals.unknown}곳`}
                  {home.crossingSignals.heads > 0 && ` · 서울시 좌표로 보행등 ${home.crossingSignals.heads}개 표시`}
                  {' · 실제 점등 시각과 대기 시간은 현장 확인'}
                </p>}
                {crossingLandings && <details className="basis">
                  <summary>횡단보도 도색과 보도 사이</summary>
                  <table className="route-comparison">
                    <caption>양재대로 횡단 순서 · 단지에서 송파역 방향</caption>
                    <thead><tr><th scope="col">횡단부</th><th scope="col">단지 쪽</th><th scope="col">역 쪽</th></tr></thead>
                    <tbody>{crossingLandings.pairs.map((pair, index) =>
                      <tr key={index}><th scope="row">{index + 1}번째</th>
                        <td>{crossingLandingLabel(pair?.[0], crossingLandings.rangeM)}</td>
                        <td>{crossingLandingLabel(pair?.[1], crossingLandings.rangeM)}</td>
                      </tr>)}
                    </tbody>
                  </table>
                  <p>도색 끝에서 서울시 보도·교통섬 도형에 닿는 곳까지 경로를 따라 잰 거리예요. 실제 턱·경사로·유효 폭은 현장에서 확인해 주세요.</p>
                  {crossingLandings.hasView && <div className="site-actions">
                    <button type="button" onClick={() =>
                      viewHomeStop(route.id, home.stops.findIndex(stop => stop.id === 'crossing-landing-gap'))}>가장 먼 보도 접속부 보기</button>
                  </div>}
                </details>}
                {route.id === songpaStationRouteId && <p>거리와 경사는 OpenStreetMap 경로와 서울시 표고를 기준으로 계산했어요.</p>}
                <div className="site-actions">
                  <button type="button" onClick={() => viewHomeStop(route.id, 0)}>귀갓길 체험 시작</button>
                  {home.gardenDistances && <button type="button" onClick={() =>
                    viewHomeStop(route.id, home.stops.findIndex(stop => stop.id === 'courtyard-walk'))}>103·104동 사이까지 이어 보기</button>}
                  {home.crossingSignals?.viewReady && <button type="button" onClick={() =>
                    viewHomeStop(route.id, home.stops.findIndex(stop => stop.id === 'yangjae-crossing'))}>보행등 있는 횡단보도 보기</button>}
                  <button type="button" onClick={() => {
                    if (!world) return;
                    if (!selected) showAccessRoute(route.id);
                    setHomeStep(null);
                    lookAtRoutePoint(home.elevator);
                    setStreet(world.streetStatus());
                    world.focus();
                  }}>지상 엘리베이터 위치 보기</button>
                </div>
                <a href={songpaEntrance.sidewalkGeometry} target="_blank" rel="noreferrer">서울시 보도면 원본 ↗</a>
                {route.id === songpaStationRouteId && <>
                  <a href={songpaStationCrossings.source} target="_blank" rel="noreferrer">서울시 횡단보도면 원본 ↗</a>
                  <a href={songpaStationCrossings.islandSource} target="_blank" rel="noreferrer">서울시 교통섬 도형 원본 ↗</a>
                </>}
                {home.frontageM !== null && <a href={songpaEntrance.frontage.roadview} target="_blank" rel="noreferrer">정문 방향 보도 로드뷰 ↗</a>}
                <a href={songpaHomeLinks.gateApproach.source} target="_blank" rel="noreferrer">정문 앞 도로 원본 ↗</a>
                <a href={songpaGrounds.metadata} target="_blank" rel="noreferrer">단지 항공영상 촬영 정보 ↗</a>
              </section>}
              {selected && busView && <div className="route-terrain" data-route-section="bus-stop" tabIndex={-1}>
                <strong>정류소 {songpaBusStop.ars} · 서울시 {songpaBusStop.referenceDate} 자료</strong>
                <p>주황 점선으로 표시한 정문 앞 약 {songpaHomeLinks.gateApproach.lengthM}m는 보도 연결이 미확인된 구간이에요.</p>
                <div className="site-actions"><button type="button" onClick={() => {
                  const point = { ...busView.position, label: '정류소 앞 보행로' };
                  lookFromPoint(point, busView.bearing);
                  if (world) setStreet(world.streetStatus());
                  world?.focus();
                }}>정류소 앞 눈높이 보기</button></div>
              </div>}
              {selected && hospital && <div className="route-terrain" data-route-section="hospital-entry" tabIndex={-1}>
                <strong>보조출입구 조사 · {hospital.referenceDate}</strong>
                <p>{hospital.address} · 경사로 설치, 조사 기준 5° 이하 경사, 문폭 1m 이상, 문 하부 단차 없음.</p>
                <p>보라색 점선은 도로 종점과 조사 출입구 사이의 직선거리예요. 보도 연결과 현재 개방 여부는 현장에서 확인해 주세요.</p>
                {entrance && <div className="site-actions"><button type="button" onClick={() => {
                  const point = { ...entrance.position, label: '송이로14길 도로 종점' };
                  lookFromPoint(point, entrance.bearing);
                  world?.showAccessEntrance(route.id);
                  if (world) setStreet(world.streetStatus());
                  world?.focus();
                }}>도로 종점에서 출입구 방향 보기</button></div>}
                <a href={hospital.source} target="_blank" rel="noreferrer">서울시 보행자 출입구 조사 ↗</a>
              </div>}
              {selected && crossing && <div data-route-section="school-crossing" tabIndex={-1}>
                <div className="site-actions"><button onClick={() => lookAtRoutePoint(crossing)}>송이로 횡단보도 눈높이 보기</button>
                  {accessDetails?.schoolView && <button onClick={() => viewSchoolGate(route.id)}>교문 앞 눈높이 보기</button>}
                </div>
                {schoolRoute && <div className="route-terrain">
                  <strong>송이로 횡단보도에서 교문 앞까지</strong>
                  {accessDetails?.schoolSignal?.installed === true && <p>송이로 횡단보도는 서울시 목록에 보행등이 등록돼 있어요.
                    {accessDetails.schoolSignal.heads === 0 && ' 이 횡단보도에 대응하는 보행등 좌표는 확인되지 않았어요.'}</p>}
                  <p>학교 쪽 보도 {songpaSchoolApproach.walkM}m를 서울시 보도면 안에서 이어 그렸어요. 보도 끝에서 문주까지 약 {songpaSchoolApproach.unmappedM}m는 점선으로 표시했어요.</p>
                  <p>담장과 문주는 서울시 도형을 따르고 높이와 외장은 근사로 표현했어요. 현재 개방 여부와 턱, 등교 시간 신호 대기는 현장에서 확인해 주세요.</p>
                  {profile && <p>경사 단면은 횡단보도 학교 쪽까지 약 {route.lengthM}m에 대한 계산이에요.</p>}
                  {accessDetails?.schoolView && <div className="site-actions"><button onClick={() => {
                    field.save({ scene: { kind: 'school-gate', routeId: route.id }, place: songpaSchoolApproach.location,
                      finding: `서울시 보도면과 문주 사이 약 ${songpaSchoolApproach.unmappedM}m · 턱과 개방 여부 현장 확인` });
                    openVisitPlan();
                  }}>교문 앞을 현장 메모에 담기</button></div>}
                  <a href={songpaSchoolApproach.sidewalkSource} target="_blank" rel="noreferrer">서울시 보도면 ({songpaSchoolApproach.sidewalkArchiveDate}) ↗</a>
                  {accessDetails?.schoolSignal && <a href={accessDetails.schoolSignal.source} target="_blank" rel="noreferrer">서울시 횡단보도 시설 목록 ({accessDetails.schoolSignal.date}) ↗</a>}
                  <a href={songpaSchoolApproach.wallsSource} target="_blank" rel="noreferrer">서울시 담장·문주 ({songpaSchoolApproach.wallsArchiveDate}) ↗</a>
                  <a href={songpaSchoolApproach.roadview} target="_blank" rel="noreferrer">출입구 과거 로드뷰 ({songpaSchoolApproach.roadviewDate}) ↗</a>
                </div>}
              </div>}
              {selected && route.parkEntrance && <div className="route-terrain" data-route-section="park-entry" tabIndex={-1}>
                <strong>송이공원 진입부와 산책로</strong>
                <div className="site-actions">
                  {world?.parkViews.map(view => <button key={view.name} onClick={() => lookAtRoutePoint(view)}>{view.name} 눈높이 보기</button>)}
                </div>
                <p>{songiPark.aerialDate} 항공영상과 지상 사진을 참고해 진입부 포장, 산책로 일부와 수목을 표현했어요. 길의 폭과 수목 높이는 근사예요. 현재 개방 여부와 계단·노면 경사는 현장에서 확인해 주세요.</p>
                <p>공원 앞 두 횡단보도와 보도는 서울시 도형을 따라 그렸어요. 짧은 점선은 도색 끝과 보도 사이의 연결을 확인할 수 없는 곳이에요. 거리와 지형 단면은 지도 경로 기준이에요.</p>
                <a href={songiPark.aerialMetadata} target="_blank" rel="noreferrer">항공영상 촬영 정보 ↗</a>
                <a href={songiPark.groundPhotos} target="_blank" rel="noreferrer">공원 지상 사진 ↗</a>
                <a href={songiParkSurvey.sidewalkSource} target="_blank" rel="noreferrer">서울시 공원 앞 보도면 ↗</a>
                <a href={songiParkSurvey.crosswalkSource} target="_blank" rel="noreferrer">서울시 송이로·양재대로 횡단보도 도형 ↗</a>
              </div>}
              {selected && profile && <RouteTerrain profile={profile} selected={accessSample} direction={accessSlope} startLabel={access.startLabel}
                onSelect={index => { setAccessSample(index); setAccessSlope(null); }}
                onSlope={(direction, index) => { setAccessSample(index); setAccessSlope(direction); }} onLook={lookAtRoutePoint} />}
            </div>;
          })}
        </section>}
        <details className="basis"><summary>자료와 계산 기준</summary>
          <p>3D와 같은 지형 표면에서 출발 지면을 0m로 두고 최대 {horizonRange}m까지 {horizonChartStep}m 간격으로 단면을 표시합니다. {world?.sources.localTerrain ?
            '단지 주변은 서울시 수치지형도에서 보간하고 외곽은 GEDTM30과 연결했어요.' :
            `${world?.sources.terrain.name ?? 'GEDTM30'}을 사용하며 표고 기준은 ${world?.sources.terrain.datum ?? 'EGM2008'}입니다. 자료 기준 기간은 ${world?.sources.terrain.epoch ?? '2006–2015'}입니다.`}</p>
          <p>차폐각은 같은 방향에 있는 3D 지형의 삼각면 경계와 높이 자료가 있는 건물 지붕에서 구해요. 건물·지형 자료가 끝나는 거리와 높이 미확인 건물을 따로 표시해요. 수목이나 먼 지형이 가리는 정도는 현장에서 확인해 주세요.</p>
          <p>예측 산포는 지형 모델의 예측 변동입니다. 보도·옹벽·계단과 현장 표고 오차는 별도 확인이 필요합니다.</p>
          {world?.sources.terrain.relativeDifference != null && <p>기존 90m 자료와 중앙 기준점에 맞춰 비교한 상대 높이의 평균 절대 차이는 {world.sources.terrain.relativeDifference.toFixed(1)}m입니다.</p>}
          <a href={world?.sources.terrain.catalog ?? 'https://zenodo.org/records/15689805'} target="_blank" rel="noreferrer">지형 출처 · Ho &amp; Hengl / CC BY 4.0 ↗</a>
          {world?.sources.localTerrain && <a href={world.sources.localTerrain.source} target="_blank" rel="noreferrer">서울시 등고선과 표고점 · 공공누리 1유형 ↗</a>}
          <p>녹지와 수계 수치는 OpenStreetMap 스냅샷 ({world?.sources.osmSnapshot ?? '불러오는 중'})에 표시된 가장 가까운 경계·선까지의 직선거리입니다. 접근 가능 여부와 실제 보행 거리는 현장 확인이 필요합니다.</p>
          <p>경로 길이는 OpenStreetMap에서 같은 노드로 이어진 도로·보행로를 따라 계산합니다. 보도 표기와 횡단 구간은 지도 자료이며, 현장 연결과 통행 여건은 별도 확인이 필요합니다.</p>
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap 데이터 ↗</a>
          {world?.sources.treeCover && <>
            <p>수목 피복은 {world.sources.treeCover.year}년 Sentinel‑2 기반 {world.sources.treeCover.resolution}m 토지피복의 나무 분류입니다. 3D 나무는 이 범위 안에 모형으로 배치했으며 개별 위치·수종·높이는 추정입니다. 일조와 시야 계산은 지형과 건물 자료를 사용합니다.</p>
            <a href={world.sources.treeCover.catalog} target="_blank" rel="noreferrer">{world.sources.treeCover.source} · 토지피복 ↗</a>
            <a href={world.sources.treeCover.license} target="_blank" rel="noreferrer">토지피복 이용 조건 · CC BY 4.0 ↗</a>
          </>}
        </details>
      </>}

      {tab === 'places' && <div className="place-explorer">
        {region === 'songpa' && <article className="place-note school-zone-card" aria-label="공식 초등학교 통학구역">
          <span>초등학교 통학구역 · {songpaSchool.referenceDate}</span>
          <h3>{songpaSchool.school}</h3>
          <p>지도상 가락동부센트레빌 경계 전체가 {songpaSchool.zoneName}에 들어가요.</p>
          {schoolZoneVisible && mode === 'orbit' && <div className="school-legend"><span>통학구역 경계</span><span>지도상 단지 경계</span></div>}
          <div className="site-actions">
            <button aria-pressed={schoolZoneVisible && mode === 'orbit'} disabled={!world} onClick={() => {
              const next = !schoolZoneVisible || mode !== 'orbit';
              setSchoolZoneVisible(next);
              setSelectedPlaceId(null);
              if (next) chooseMode('orbit');
            }}>통학구역 지도</button>
            <button disabled={!world} onClick={() => openAccessRoute(songpaSchool.routeId)}>통학 방향 경로</button>
          </div>
          <details className="basis">
            <summary>공식 자료 확인</summary>
            <p>취학·전학 시점의 통학구역은 {songpaSchool.districtOffice} 안내에서 확인할 수 있어요.</p>
            <a href={songpaSchool.zoneSource} target="_blank" rel="noreferrer">한국교육시설안전원 통학구역 원본 ↗</a>
            <a href={songpaSchool.associationSource} target="_blank" rel="noreferrer">학교·학구도 연계 자료 ↗</a>
            <a href={songpaSchool.schoolSource} target="_blank" rel="noreferrer">서울신가초 찾아오시는 길 ↗</a>
          </details>
        </article>}
        <div className="place-explorer-heading" tabIndex={-1}>
          <h3>주변 생활시설</h3><p>{placeOrigin}에서의 직선거리 · 가까운 순</p>
        </div>
        <div className="place-filters" aria-label="장소 종류">{[['all','전체'],['beauty','올리브영'],['convenience','편의점'],['school','학교']].map(([id,label]) => <button key={id} aria-pressed={placeCategory === id} onClick={() => {
          setPlaceCategory(id);
          setSelectedPlaceId(null);
          setSchoolZoneVisible(false);
          chooseMode('orbit');
        }}>{label}</button>)}</div>
        <div className="place-list" aria-label="주변 장소 목록">
          {world?.places.filter(place => placeCategory === 'all' || place.category === placeCategory).map(place =>
            <button className="place-row" aria-pressed={selectedPlaceId === place.id} key={place.id} onClick={() => selectPlace(place.id)}>
              <span className={`place-kind place-kind-${place.category}`} aria-hidden="true">{place.category === 'school' ? '학' : place.category === 'beauty' ? '영' : '편'}</span>
              <strong>{place.name}</strong><small>직선 {place.distance_m.toLocaleString()}m</small>
            </button>)}
        </div>
        {region === 'opo' && <div className="place-note"><strong>공식 통학구역</strong><p>취학 주소의 통학구역은 학구도에서 확인할 수 있어요.</p><a href="https://schoolzone.emac.kr/" target="_blank" rel="noreferrer">공식 학구도 확인 ↗</a></div>}
        <details className="basis"><summary>장소 데이터 기준</summary><p>OpenStreetMap / OpenFreeMap 지도 스냅샷 ({world?.sources.osmSnapshot ?? '불러오는 중'}). 현재 영업 여부와 상호는 확인이 필요합니다. 거리는 EPSG:5186 기준 {placeOrigin}에서의 직선거리입니다.</p><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors · ODbL ↗</a></details>
      </div>}

      {region === 'jamsil-leel' && tab === 'site' && <div className="site-features">
        <article className="site-card">
          <h3>{jamsilLeel.name}</h3>
          <p>{jamsilLeel.address} · {jamsilLeel.towerCount}개 동 · {jamsilLeel.households.toLocaleString('ko-KR')}세대 · 최고 {jamsilLeel.maxFloors}층</p>
          <div className="site-actions">
            <button disabled={!world} onClick={() => chooseMode('orbit')}>단지 전체 보기</button>
            {jamsilLeel.entrances.map(stop => <button key={stop.id}
              disabled={!world?.destinations.some(destination => destination.id === stop.id)}
              onClick={() => visitAtEyeLevel(stop.id)}>{stop.name} 보기</button>)}
          </div>
          <p>101~113동은 지도 윤곽을 따라 배치했어요. 외관과 높이는 참고용 모델이에요. 단지 안쪽 산책로와 정원은 공개 조경도에서 위치를 맞춘 근사예요.</p>
          <p>도로와 보도는 서울시 도형을 우선 사용해요. 보행 신호등은 설치 기록과 지주 좌표가 일치하는 곳에 표시해요.</p>
          <a href={jamsilLeel.info} target="_blank" rel="noreferrer">롯데건설 사업개요 ↗</a>
          <a href={jamsilLeel.boundary} target="_blank" rel="noreferrer">OpenStreetMap 단지 경계 ↗</a>
          <a href="https://www.lottecastle.co.kr/APT/AT00424/16291/download/view.do" target="_blank" rel="noreferrer">롯데건설 조경설계 ↗</a>
          <a href={jamsilLeel.referenceFloorsSource} target="_blank" rel="noreferrer">외형 참고 층수 ↗</a>
        </article>
      </div>}

      {region === 'songpa' && tab === 'site' && <div className="site-features">
        <article className="site-card">
          <h3>{songpaComplex.name}</h3>
          <p>{songpaComplex.address} · 5개 동 · {songpaFacilities.households}세대</p>
          <p>공개 배치 자료에서 101~105동 위치를 대조했어요. 사진에 보이는 103·104동의 청색 띠와 창호를 반영했고, 눈높이에서 창틀과 창턱의 깊이를 볼 수 있어요.</p>
          <p>창호와 번호판의 위치, 지붕의 세부 치수는 근사예요. 일조는 지도 윤곽과 높이 표본의 단순화한 체적으로 계산해요.</p>
          <p>점선은 지도상 주거 영역이에요.</p>
          <div className="site-actions">
            <button disabled={!world} onClick={() => { chooseMode('orbit'); world?.locate(); }}>5개 동 조감 보기</button>
            <button disabled={!world} onClick={() => visit('inner-paving')}>동 사이에서 외관 보기</button>
            <button disabled={!world} onClick={() => visit('approach')}>단지 앞 도로 보기</button>
            {songpaStreets.views.map(stop => <button key={stop.id}
              disabled={!world?.destinations.some(destination => destination.id === stop.id)} onClick={() => visit(stop.id)}>{stop.name} 보기</button>)}
          </div>
          <div className="basis">
            <a href={songpaComplex.info} target="_blank" rel="noreferrer">서울시 공동주택 단지 정보 ↗</a>
            <a href={songpaArchitecture.layout} target="_blank" rel="noreferrer">주동 배치 참고 지도 ↗</a>
            <a href={songpaArchitecture.photos} target="_blank" rel="noreferrer">단지 지상 사진 ↗</a>
            <a href={songpaComplex.boundary} target="_blank" rel="noreferrer">OpenStreetMap 단지 경계 ↗</a>
            <a href={songpaStreets.roadview} target="_blank" rel="noreferrer">양재대로60길 교차로 로드뷰 ↗</a>
            <a href={world?.sources.streets ?? songpaComplex.road} target="_blank" rel="noreferrer">OpenStreetMap 도로와 차로 수 ↗</a>
            {world?.sources.roadMarkings && <>
              <p>도로와 보도는 지도에서 만들고, 차선과 횡단보도는 서울시 {world.sources.roadMarkings.archiveDate} 도형을 우선 사용했어요. {world.sources.roadMarkings.inventoryDate} 대장에 없는 횡단보도는 현재 상태를 확인해야 해요.</p>
              <a href={world.sources.roadMarkings.lanes} target="_blank" rel="noreferrer">서울시 차선 선형 ↗</a>
              <a href={world.sources.roadMarkings.crosswalks} target="_blank" rel="noreferrer">서울시 횡단보도 도형 ↗</a>
              <a href={world.sources.roadMarkings.inventory} target="_blank" rel="noreferrer">서울시 횡단보도 시설 대장 ↗</a>
            </>}
          </div>
        </article>
        <article className="site-card" data-site-card="facades" tabIndex={-1}>
          <h3>동별 외벽과 앞 건물</h3>
          {facade && <label className="facade-select">
            동과 외벽 방향
            <select value={facade.id} onChange={event => setFacadeId(event.target.value)}>
              {songpaComplex.towers.map(({ dong }) => {
                const sides = world?.facades.filter(view => view.dong === dong);
                return sides?.length ? <optgroup key={dong} label={dong}>
                  {sides.map(view => <option key={view.id} value={view.id}>{dong} {view.direction}쪽 · {Math.round(view.bearing) % 360}°</option>)}
                </optgroup> : null;
              })}
            </select>
          </label>}
          {facade && facing && <div aria-live="polite">
            <p>{facing.building}</p>
            <p>{facing.horizon}</p>
            {facing.heightGap && <p>{facing.heightGap}</p>}
          </div>}
          <p>외벽 가운데에서 바깥쪽 {facadeOffsetM}m, 모델 바닥 위 {observationHeight}m에서 봐요. 앞 건물은 이 방향에서 가장 먼저 만나는 건물이에요. 차폐각은 지형과 높이가 확인된 건물이 시야를 가장 높이 가리는 각도예요.</p>
          <div className="site-actions">
            <button disabled={!world || !facade} onClick={() => facade && viewFacade(facade)}>이 방향을 눈높이로 보기</button>
            <button disabled={!world || !facade} onClick={() => {
              if (!facade) return;
              chooseMode('orbit');
              choosePoint('B', facade);
              pendingAnalysisSection.current = { tab: 'sun', selector: '.site-card.site-B' };
              chooseTab('sun');
            }}>이 지점을 일조 비교 B에 넣기</button>
            <button disabled={!facade || !facing} onClick={() => {
              if (!facade || !facing) return;
              field.save({
                scene: { kind: 'facade', viewId: facade.id },
                place: facade.label,
                finding: [`실외 모델 눈높이 ${observationHeight}m`, facing.building, facing.horizon, facing.heightGap].filter(Boolean).join(' / '),
                note: '관심 층·호수의 거실 창은 어느 방향인가요?\n창에서 보이는 앞동과 방문 시각의 채광은 어떤가요?\n창호·누수·결로·곰팡이·수압·층간소음은 어떤가요?',
              });
              openVisitPlan();
            }}>이 방향을 현장 메모에 담기</button>
          </div>
          <details className="basis">
            <summary>공급 141㎡·170㎡ 기본형 평면도</summary>
            <p>두 기본형 모두 방 4개와 욕실 2개가 있고 거실이 발코니와 맞닿아 있어요. 170㎡는 1번 방 옆에 드레스실이 표시돼요.</p>
            <p>동·호수별 창 방향, 층별 채광과 실내 상태는 현장에서 확인해 주세요.</p>
            {songpaArchitecture.planTypes.map(({ area, url }) => <a key={area} href={url} target="_blank" rel="noreferrer">
              공급 {area}㎡ KB부동산 평면도 열기
            </a>)}
            <a href={songpaArchitecture.basicPlans} target="_blank" rel="noreferrer">KB부동산 단지 페이지에서 타입 비교</a>
            <a href={songpaArchitecture.builder} target="_blank" rel="noreferrer">시공사 가락동 센트레빌 단지 안내 ↗</a>
          </details>
        </article>
        <article className="site-card" data-site-card="paving" tabIndex={-1}>
          <h3>단지 안 산책로와 놀이터</h3>
          <p>103·104동 사이 보행로와 화단, 원형 앉음벽을 지나 조합놀이대와 그네를 볼 수 있어요.</p>
          <p>103동 앞 포장 연결과 현관 외관은 공개 사진을 참고해 재현했어요. 현관의 정확한 위치와 단차는 현장에서 확인해 보세요.</p>
          <p>시설번호 {songpaPlayground.facilityNo} · {songpaPlayground.registered}</p>
          <p>항공영상과 공식 시설 사진을 참고했어요. 놀이기구와 보행로의 배치·치수는 근사예요. 현재 기구 상태와 단차는 현장에서 확인해 보세요.</p>
          <div className="site-actions">
            {songpaCourtyard.views.map(stop => <button key={stop.id}
              disabled={!world?.destinations.some(destination => destination.id === stop.id)} onClick={() => visitAtEyeLevel(stop.id)}>{stop.name} 보기</button>)}
            {songpaGrounds.points.map(stop => <button key={stop.id}
              disabled={!world?.destinations.some(destination => destination.id === stop.id)} onClick={() => visit(stop.id)}>{stop.name} 보기</button>)}
            <button disabled={!world} onClick={openWinterWalk}>겨울 오후 산책 비교</button>
          </div>
          <div className="basis">
            <a href={songpaPlayground.source} target="_blank" rel="noreferrer">행정안전부 놀이시설 등록과 사진 ↗</a>
            <a href={songpaCourtyard.groundPhoto} target="_blank" rel="noreferrer">103·104동 사이 보행로 사진 ↗</a>
            <a href={songpaCourtyard.aerialReference} target="_blank" rel="noreferrer">놀이터 표기가 보이는 단지 항공사진 ↗</a>
            <a href={songpaCourtyard.seatRecord} target="_blank" rel="noreferrer">104동 조경시설 공고 ↗</a>
            <a href={songpaGrounds.source} target="_blank" rel="noreferrer">World Imagery 항공영상 ↗</a>
            <a href={songpaGrounds.metadata} target="_blank" rel="noreferrer">{songpaGrounds.captureDate} 촬영 · 영상 메타데이터 ↗</a>
          </div>
        </article>
        <article className="site-card" data-site-card="entrance" tabIndex={-1} aria-label="정문과 지하주차장 입구">
          <h3>정문과 지하주차장 입구</h3>
          <p>송파대로32길 서쪽 보도를 따라 정문을 볼 수 있어요. 보도 끝 높이는 차단기 옆 블록 포장에 맞췄어요. 102동 쪽 시점은 양재대로60길 서쪽 보도 위에 있어요.</p>
          <p>양재대로60길 교차로의 횡단보도 세 곳과 정문 차도 경계는 서울시 수치지형도와 항공영상을 대조했어요. 보도 단차, 덮개 아래 실제 경사와 차수시설, 방문차량 입차 조건은 현장 확인이 필요해요.</p>
          <p>{songpaEntrance.capturedIn} 로드뷰에서 확인한 정문 앞 흰색 횡단 표시와 블록 포장, 차량 차단기를 도로 경계에 맞춰 그렸어요. 배치와 치수는 근사이며 차단기 모습은 촬영 당시를 참고했어요.</p>
          {world?.sources.roadMarkings?.paintedHumps && <p>정문 앞과 송이로14길의 노랑·흰색 감속 표시는 서울시 도형에 맞춘 노면 도색이에요.</p>}
          <p>102·105동 앞 철책과 양재대로60길·송이로14길 가로수는 서울시 수치지형도 위치를 사용했어요. 나무 높이와 수관은 모형이며, 계절별 그늘과 시야는 실제와 다를 수 있어요.</p>
          <div className="site-actions">
            {[songpaEntrance.main, songpaEntrance.garage].map(stop => <button key={stop.id}
              disabled={!world?.destinations.some(destination => destination.id === stop.id)} onClick={() => visitAtEyeLevel(stop.id)}>{stop.name} 보기</button>)}
          </div>
          <div className="basis">
            <a href={songpaEntrance.roadGeometry} target="_blank" rel="noreferrer">{songpaEntrance.roadGeometryLabel} · 도로 경계</a>
            <a href={songpaJunction.crossingSource} target="_blank" rel="noreferrer">서울시 양재대로60길 교차로 횡단보도 도형 ↗</a>
            {world?.sources.roadMarkings?.paintedHumps && <a href={world.sources.roadMarkings.paintedHumps} target="_blank" rel="noreferrer">서울시 감속 표시 도형 ↗</a>}
            <a href={songpaFrontage.fenceSource} target="_blank" rel="noreferrer">서울시 철책 위치 도형 ↗</a>
            <a href={songpaFrontage.treeSource} target="_blank" rel="noreferrer">서울시 가로수 위치 도형 ↗</a>
            <a href={songpaGrounds.metadata} target="_blank" rel="noreferrer">덮개와 식재 범위 참고 항공영상 ↗</a>
            <a href={songpaEntrance.main.roadview} target="_blank" rel="noreferrer">카카오맵 정문 로드뷰 ↗</a>
            <a href={songpaEntrance.garage.roadview} target="_blank" rel="noreferrer">카카오맵 주차장 덮개 로드뷰 ↗</a>
            <a href={songpaEntrance.record} target="_blank" rel="noreferrer">송파구 분리수거함 위치 기록 · 102동 지하주차장 입구 ↗</a>
          </div>
        </article>
        <article className="site-card" data-site-card="parking" tabIndex={-1} aria-label="주차와 관리 공시">
          <h3>주차와 관리</h3>
          <p>{parkingSpaces}면 · 세대당 {(parkingSpaces / songpaFacilities.households).toFixed(2)}면</p>
          <p>지상 {songpaFacilities.surfaceParking}면 · 지하 {songpaFacilities.undergroundParking}면 · 승강기 {songpaFacilities.lifts}대</p>
          <p>동 사이 지상 주차 구간은 항공영상과 사진을 참고해 일부 재현했어요. 화면의 차량은 주차 공간의 크기를 보여주는 예시예요.</p>
          <div className="site-actions"><button disabled={!world} onClick={() => visitAtEyeLevel('inner-paving')}>지상 주차 구간 눈높이 보기</button></div>
          <p>{songpaFacilities.sharedFacilities.join(' · ')}</p>
          <p>관리사무소·경로당·자전거보관소 위치와 방문 주차 조건은 현장 확인이 필요해요.</p>
          <div className="basis">
            <strong>관리비 · {songpaManagementFees.month} 발생분</strong>
            <p>공용관리비는 주거전용면적 ㎡당 약 {Math.round(songpaManagementFees.commonPerSquareMeter).toLocaleString('ko-KR')}원이에요.</p>
            <table className="tower-register">
              <thead><tr><th scope="col">항목</th><th scope="col">단지 전체 금액</th></tr></thead>
              <tbody>{songpaManagementFees.charges.map(charge => <tr key={charge.label}>
                <th scope="row">{charge.label}</th><td>{charge.won.toLocaleString('ko-KR')}원</td>
              </tr>)}</tbody>
              <tfoot><tr><th scope="row">합계</th><td>{managementTotal.toLocaleString('ko-KR')}원</td></tr></tfoot>
            </table>
            <p>세대별 고지액은 면적과 사용량 등에 따라 달라요.</p>
            <a href={songpaManagementFees.source} target="_blank" rel="noreferrer">K-apt 관리비 원문 조회 ↗</a>
            <p>관리비 → 우리단지 관리비등 조회에서 가락동부센트레빌과 발생월을 선택하세요. {songpaManagementFees.checkedOn} 확인</p>
          </div>
          <div className="basis">
            <p>{songpaFacilities.checkedOn} 조회 · 단지코드 {songpaFacilities.complexCode}</p>
            <a href={songpaFacilities.management} target="_blank" rel="noreferrer">K-apt 관리시설정보 ↗</a>
            <a href={songpaPlayground.source} target="_blank" rel="noreferrer">행정안전부 놀이시설 등록 ↗</a>
          </div>
        </article>
      </div>}

      {region === 'opo' && tab === 'site' && <div className="site-features">
        <div className="site-key"><span><i className="site-outline-key"/>OSM 단지 영역</span><span><i className="site-road-key"/>진입로와 단지 도로</span></div>
        {buildingRegister && <div className="site-card">
          <strong>주동 높이와 층수</strong>
          <p>건축물대장 표제부 · {buildingRegister.source.dataMonth} 기준</p>
          <table className="tower-register">
            <thead><tr><th scope="col">주동</th><th scope="col">등록 높이</th><th scope="col">지상층</th></tr></thead>
            <tbody>{buildingRegister.towers.map(row => <tr key={row.dong}>
              <th scope="row">{row.dong}</th><td>{row.heightM.toFixed(2)}m</td><td>{row.aboveGroundFloors}층</td>
            </tr>)}</tbody>
          </table>
          <details className="basis"><summary>도형과 부속시설 자료</summary>
            <p>대장의 건축면적과 3D에 쓰는 평면 윤곽 면적은 동별로 다릅니다. 정확한 외벽 윤곽과 지면 단차는 현장 대조가 필요합니다.</p>
            <table className="tower-register">
              <thead><tr><th scope="col">주동</th><th scope="col">대장 면적</th><th scope="col">3D 도형 면적</th></tr></thead>
              <tbody>{buildingRegister.towers.map(row => <tr key={row.dong}>
                <th scope="row">{row.dong}</th><td>{row.registeredFootprintM2.toFixed(2)}㎡</td><td>{row.outlineAreaM2.toFixed(2)}㎡</td>
              </tr>)}</tbody>
            </table>
            <p>같은 필지의 등록 부속시설</p>
            <ul>{buildingRegister.facilities.map(row => <li key={row.name}>
              {row.name} · {row.aboveGroundFloors ? `지상 ${row.aboveGroundFloors}층` : `지하 ${row.belowGroundFloors}층`}
            </li>)}</ul>
            <p>{architecture.method}</p>
            <ul>{architecture.references.map(reference => <li key={reference.image}>
              <a href={reference.image} target="_blank" rel="noreferrer">{reference.name} ↗</a>
            </li>)}</ul>
          </details>
          <a href={buildingRegister.source.url} target="_blank" rel="noreferrer">건축HUB 표제부 · 능평동 917번지 ↗</a>
        </div>}
        <div className="site-card"><strong>정문과 진입교</strong>
          <p>{entranceRoadViewDate} 로드뷰를 참고해 석재 아치와 경비실, 흰 난간, 보도와 횡단보도를 모델링했어요. 시설물의 세부 치수와 정확한 단차는 추정입니다.</p>
          <div className="site-actions"><button disabled={!world} onClick={() => visit('approach')}>정문 앞으로 이동</button></div>
          <ul>
            <li><a href={entranceRoadView} target="_blank" rel="noreferrer">정문 현장 로드뷰 ↗</a></li>
            <li><a href={`https://www.openstreetmap.org/way/${opoEntranceBridgeId}`} target="_blank" rel="noreferrer">진입교 좌표 출처 ↗</a></li>
          </ul>
        </div>
        <div className="site-card">
          <strong>{courtyard.name}</strong>
          <p>공개 사진을 참고해 원형으로 내려가는 계단, 파란 놀이터, 세 단의 석재 물길과 목재 계단을 모델링했어요. 시설물의 세부 치수와 단차는 추정입니다.</p>
          <div className="site-actions">
            <button disabled={!world} onClick={() => visit(courtyard.id)}>중정 둘러보기</button>
            <button disabled={!world} onClick={() => visit(courtyardGarden.id)}>남쪽 정원 보기</button>
            <button disabled={!world} onClick={() => visit(courtyardStairs.id)}>계단 위에서 보기</button>
            <button disabled={!world?.presets.some(point => point.id === courtyard.id)} onClick={() => {
              const point = world?.presets.find(point => point.id === courtyard.id);
              if (!point) return;
              choosePoint('A', point);
              chooseTab('sun');
            }}>중정 일조 보기</button>
          </div>
          <ul>{courtyard.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.name} ↗</a></li>)}</ul>
        </div>
        <div className="site-card"><strong>등록된 놀이시설</strong><ul>
          <li><a href="https://www.yugacrew.com/gyeonggi/gwangju/playground/29639" target="_blank" rel="noreferrer">놀이광장 ↗</a></li>
          <li><a href="https://www.yugacrew.com/gyeonggi/gwangju/playground/28626" target="_blank" rel="noreferrer">놀이의 테라스 ↗</a></li>
        </ul><p>두 시설은 단지의 같은 등록 주소를 사용합니다. 사진에서 보이는 포장 공간과 개별 시설명은 추가 대조가 필요합니다.</p></div>
        <details className="basis"><summary>단지 자료 기준</summary>
          <p>지도와 건축물 자료로 건물 윤곽·높이와 도로·보행로·정류장을 표현합니다. 높이 미확인 건물은 층수나 용도로 높이를 추정하고 둘 다 없으면 윤곽을 표시합니다. 포장 재질, 난간 형태, 수변 식생과 기록이 없는 도로 폭·교량 높이는 화면용 추정입니다.</p>
          <a href={world?.sources.streets ?? 'https://www.openstreetmap.org/#map=16/37.3508/127.1642'} target="_blank" rel="noreferrer">OSM 동네 원본 ↗</a>
          <a href="/tour-materials/CREDITS.txt" target="_blank" rel="noreferrer">3D 재질 및 오픈소스 출처 ↗</a>
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
    {mode === 'walk' && !open && !selectedSlot && <div className="walk-stick" role="group" aria-label="걷기 조이스틱"
      onPointerDown={event => {
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const element = event.currentTarget;
        if (!element.hasPointerCapture(event.pointerId)) return;
        const bounds = element.getBoundingClientRect();
        const x = event.clientX - bounds.left - bounds.width / 2;
        const y = event.clientY - bounds.top - bounds.height / 2;
        const distance = Math.max(27, Math.hypot(x, y));
        walkStick(element, Math.abs(x) < 3 ? 0 : x / distance, Math.abs(y) < 3 ? 0 : y / distance);
      }}
      onPointerUp={event => walkStick(event.currentTarget, 0, 0)}
      onPointerCancel={event => walkStick(event.currentTarget, 0, 0)}
      onLostPointerCapture={event => walkStick(event.currentTarget, 0, 0)}><span aria-hidden="true" /></div>}

    <div className="scene-instructions">{mode === 'orbit' ? '드래그로 회전 · 스크롤로 확대'
      : mode === 'drive' ? 'W/S 가속·후진 · A/D 조향' : '바닥을 눌러 이동 · WASD로 걷기 · 드래그로 둘러보기'}</div>

    {!world && <div className="loading" role="status">{error ? <><p>{error}</p><button onClick={() => { setError(''); setRetry(value => value + 1); }}>다시 열기</button></> : `${area.name}의 지형과 건물을 불러오는 중…`}</div>}

    <footer className="credits">
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a> · <a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap / OpenMapTiles</a> · <a href="https://zenodo.org/records/15689805" target="_blank" rel="noreferrer">GEDTM30 · Ho &amp; Hengl (CC BY 4.0)</a> · 실외 모델 추정
      {region === 'opo' && <> · <a href="https://registry.opendata.aws/sentinel-2-l2a-cogs/" target="_blank" rel="noreferrer">{satelliteMetadata.attribution}</a></>}
      {region === 'songpa' && <> · <a href="https://openlab.eseoul.go.kr/" target="_blank" rel="noreferrer">{songpaEntrance.roadGeometryLabel}</a>
        {' · '}<a href={seoulBiotopeSource} target="_blank" rel="noreferrer">서울시 도시생태현황도 2025</a></>}
    </footer>
  </main>;
}
