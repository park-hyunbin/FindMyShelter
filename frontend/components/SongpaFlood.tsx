import { floodDistance, floodHistory, floodSource, floodWaterSource, floodYears, type FloodView } from './data/songpa-flood';
import { songpaComplex } from './data/regions';
import { songpaEntrance } from './data/songpa-entrance';
import { songpaGrounds } from './data/songpa-grounds';

const drainageStops = [
  { id: songpaEntrance.main.id, name: songpaEntrance.main.name, check: '보도 가장자리의 빗물받이와 물이 고인 흔적을 확인해요.' },
  { id: songpaGrounds.points[1].id, name: songpaGrounds.points[1].name, check: '포장 경사가 향하는 쪽과 물이 모이는 곳을 확인해요.' },
  { id: songpaEntrance.garage.id, name: '102동 지하주차장 입구', check: '덮개 아래 진입부의 배수로와 차수 시설을 확인해요.' },
];

type Props = {
  year: string;
  view: FloodView;
  sceneReady: boolean;
  mapVisible: boolean;
  onView: (view: FloodView, year?: string) => void;
  onVisit: (id: string) => void;
};

export default function SongpaFlood({ year, view, sceneReady, mapVisible, onView, onVisit }: Props) {
  const record = floodHistory.years[year];
  const nearest = record.nearestM == null ? null : floodDistance(record.nearestM);
  const showingWater = view === 'pond' || view === 'river';
  return <section className="flood-panel" aria-label="물길과 침수 기록">
    <article className="site-card">
      <h3>서울시 침수흔적도</h3>
      <p>2010~2025년 공개 파일 · 지도상 단지 경계에서 {floodHistory.radiusM}m 안의 기록</p>
      <label className="ambient-date">기록 연도 <select value={year} onChange={event => onView('closest', event.target.value)}>
        {floodYears.map(value => <option value={value} key={value}>{value}년{floodHistory.years[value].nearestM == null ? ' · 주변 표시 기록 없음' : ''}</option>)}
      </select></label>
      <div className="flood-result" aria-live="polite">
        {record.overlap ? <p>지도상 단지 경계와 겹치는 기록이 있어요.</p> : nearest != null
          ? <p>가장 가까운 기록{record.nearestMonth && <>({year}년 {record.nearestMonth}월)</>}은 <strong>단지 경계 밖 {nearest}</strong>에 있어요.</p>
          : <p>이 연도의 공개 파일에서 범위 안에 표시할 기록이 없어요.</p>}
        {record.nearestPeriods.length > 0 && <div className="flood-periods">
          <p>가장 가까운 영역의 원본 날짜</p>
          <ul>{record.nearestPeriods.map(({ start, end }) => <li key={`${start}/${end ?? ''}`}>
            <time dateTime={start}>{start}</time>{end
              ? <>~<time dateTime={end}>{end}</time></> : ' 시작 · 종료일 미기록'}
          </li>)}</ul>
        </div>}
        <p>과거에 조사된 영역이에요. 단지 배수나 향후 침수 가능성을 보려면 별도 자료가 필요해요.</p>
      </div>
      {mapVisible && <div className="flood-legend">
        {(showingWater || nearest != null) && <span data-kind={showingWater ? 'water' : 'trace'}>{showingWater ? '선택한 수계' : '침수 기록 영역'}</span>}
        <span data-kind="boundary">지도상 단지 경계</span>
        {(showingWater || (nearest != null && !record.overlap)) && <span data-kind="distance">가장 가까운 두 점의 직선거리</span>}
      </div>}
      <div className="site-actions">
        <button disabled={!sceneReady} aria-pressed={mapVisible && view === 'closest'} onClick={() => onView('closest')}>단지 주변 보기</button>
        <button disabled={!sceneReady || nearest == null} aria-pressed={mapVisible && view === 'area'} onClick={() => onView('area')}>{floodHistory.radiusM}m 안 기록 전체</button>
      </div>
      <details className="basis">
        <summary>자료 범위와 산정 기준</summary>
        <p>{floodHistory.checkedOn} 조회. 2015년과 2021년은 서울시 목록에 파일이 없어요. 거리와 겹침은 투영 좌표계 EPSG:5186에서 계산했어요. 지도에서는 중첩 영역을 합치고, 거의 같은 범위의 기록은 원본 날짜를 각각 표시해요.</p>
        <a href={floodSource} target="_blank" rel="noreferrer">서울 열린데이터광장 · 침수흔적도 ↗</a>
        <a href={songpaComplex.boundary} target="_blank" rel="noreferrer">OpenStreetMap 단지 경계 ↗</a>
      </details>
    </article>
    <article className="site-card">
      <h3>주변 수계</h3>
      <p>지도상 단지 경계에서 연못 가장자리와 하천 중심선까지의 직선거리예요.</p>
      <div className="ambient-stops">
        {(['pond', 'river'] as const).map(key => <button key={key} disabled={!sceneReady} aria-pressed={mapVisible && view === key} onClick={() => onView(key)}>
          <span>{floodHistory.water[key].name} 보기</span><b>{floodDistance(floodHistory.water[key].distanceM)}</b>
        </button>)}
      </div>
      <div className="basis">
        <a href={floodWaterSource.pond} target="_blank" rel="noreferrer">OpenStreetMap 연못 ↗</a>
        <a href={floodWaterSource.river} target="_blank" rel="noreferrer">OpenStreetMap 탄천 ↗</a>
      </div>
    </article>
    <article className="site-card">
      <h3>비가 그친 뒤 확인할 곳</h3>
      {drainageStops.map(stop => <div key={stop.id}>
        <div className="site-actions"><button disabled={!sceneReady} onClick={() => onVisit(stop.id)}>{stop.name} 눈높이 보기</button></div>
        <p>{stop.check}</p>
      </div>)}
    </article>
  </section>;
}
