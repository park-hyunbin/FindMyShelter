import { floodHistory, floodSource, floodWaterSource, floodYears, type FloodView } from './data/songpa-flood';
import { songpaComplex } from './data/regions';

type Props = {
  year: string;
  view: FloodView;
  sceneReady: boolean;
  onView: (view: FloodView, year?: string) => void;
  onVisit: (id: string) => void;
};

export default function SongpaFlood({ year, view, sceneReady, onView, onVisit }: Props) {
  const record = floodHistory.years[year];
  const nearest = record.nearestM == null ? null : Math.round(record.nearestM / 10) * 10;
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
          ? <p>가장 가까운 기록{record.nearestMonth && <>({year}년 {record.nearestMonth}월)</>}은 <strong>단지 경계 밖 약 {nearest}m</strong>에 있어요.</p>
          : <p>이 연도의 공개 파일에서 범위 안에 표시할 기록이 없어요.</p>}
        <p>과거에 조사된 영역이에요. 단지 배수나 향후 침수 가능성을 보려면 별도 자료가 필요해요.</p>
      </div>
      <div className="flood-legend"><span data-kind={showingWater ? 'water' : 'trace'}>{showingWater ? '선택한 수계' : '침수 기록 영역'}</span><span data-kind="boundary">지도상 단지 경계</span></div>
      <div className="site-actions">
        <button disabled={!sceneReady} aria-pressed={view === 'closest'} onClick={() => onView('closest')}>단지 주변 보기</button>
        <button disabled={!sceneReady || nearest == null} aria-pressed={view === 'area'} onClick={() => onView('area')}>선택 연도 기록 전체</button>
      </div>
      <details className="basis">
        <summary>자료 범위와 산정 기준</summary>
        <p>{floodHistory.checkedOn} 조회. 2015년과 2021년은 서울시 목록에 파일이 없어요. 거리와 겹침은 투영 좌표계 EPSG:5186에서 계산했고, 중첩 기록은 지도에서 합쳐 표시해요.</p>
        <a href={floodSource} target="_blank" rel="noreferrer">서울 열린데이터광장 · 침수흔적도 ↗</a>
        <a href={songpaComplex.boundary} target="_blank" rel="noreferrer">OpenStreetMap 단지 경계 ↗</a>
      </details>
    </article>
    <article className="site-card">
      <h3>주변 수계</h3>
      <p>지도상 단지 경계에서 연못 가장자리와 하천 중심선까지의 직선거리예요.</p>
      <div className="ambient-stops">
        {(['pond', 'river'] as const).map(key => <button key={key} disabled={!sceneReady} aria-pressed={view === key} onClick={() => onView(key)}>
          <span>{floodHistory.water[key].name} 보기</span><b>약 {Math.round(floodHistory.water[key].distanceM / 10) * 10}m</b>
        </button>)}
      </div>
      <div className="basis">
        <a href={floodWaterSource.pond} target="_blank" rel="noreferrer">OpenStreetMap 연못 ↗</a>
        <a href={floodWaterSource.river} target="_blank" rel="noreferrer">OpenStreetMap 탄천 ↗</a>
      </div>
    </article>
    <article className="site-card">
      <h3>비가 그친 뒤 확인할 곳</h3>
      <p>단지 앞 보도 가장자리와 안쪽 포장로에서 물고임, 빗물받이, 지하주차장 차수 시설을 확인해요.</p>
      <div className="site-actions">
        <button disabled={!sceneReady} onClick={() => onVisit('approach')}>단지 앞 도로 보기</button>
        <button disabled={!sceneReady} onClick={() => onVisit('inner-paving')}>단지 안 포장 공간 보기</button>
      </div>
    </article>
  </section>;
}
