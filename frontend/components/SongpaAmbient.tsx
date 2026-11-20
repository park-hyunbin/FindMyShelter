import { useId } from 'react';
import { ambientArchive, ambientDayGroups, ambientDays, ambientRange, ambientSources, ambientStationDistance,
  ambientTime, type AmbientMoment } from './data/songpa-ambient';
import type { OpoWorld } from './opo-world';

const localDay = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'UTC' });
const referenceNames: Record<string, string> = { 'yangjae-footway': '대로 옆', 'ambient-inner': '단지 안쪽' };
const metrics = [{ label: '소음', unit: 'dB', index: 0 }, { label: '조도', unit: 'lx', index: 1 }] as const;

type AmbientScene = NonNullable<OpoWorld['ambientScene']>;

type Props = {
  moment: AmbientMoment;
  onTime: (moment: AmbientMoment) => void;
  onMap: () => void;
  onVisit: (id: string) => void;
  activeStopId: string | null;
  scene?: AmbientScene;
  reference?: AmbientScene['stops'][number];
  mapVisible: boolean;
};

export default function SongpaAmbient({ moment, onTime, onMap, onVisit, scene, activeStopId, reference, mapVisible }: Props) {
  const slider = useId();
  const time = ambientTime(moment.hour);
  return <section className="ambient-panel" aria-label="소음과 야간 환경">
    <article className="site-card">
      <h3>양재대로 쪽과 단지 안쪽</h3>
      <p>같은 시각에 두 곳을 눈높이에서 비교해요. 버튼의 거리는 양재대로 중심선까지의 직선거리예요.</p>
      <label className="ambient-date">관측 날짜 <select value={moment.day} onChange={event => onTime({ ...moment, day: event.target.value })}>
        {ambientDays.map(day => <option key={day} value={day}>{localDay.format(new Date(day))}</option>)}
      </select></label>
      <div className="time-row">
        <label htmlFor={slider}>센서 기록 시각</label>
        <output htmlFor={slider}>{time} <small>KST</small></output>
        <input id={slider} type="range" min={0} max={23} value={moment.hour} aria-valuetext={time}
          onChange={event => onTime({ ...moment, hour: Number(event.target.value) })} />
        <div className="time-scale"><span>00시</span><span>06시</span><span>12시</span><span>18시</span><span>23시</span></div>
      </div>
      <div className="ambient-stops">
        {scene?.stops.map(stop => <button key={stop.id} aria-pressed={stop.id === activeStopId} onClick={() => onVisit(stop.id)}>
          <span>{stop.name} 보기</span><b>약 {Math.round(stop.roadDistanceM)}m</b>
        </button>)}
        <button disabled={!scene} onClick={onMap}>도로와 센서 위치 지도</button>
      </div>
      {mapVisible && reference && <p>청록색 점선은 {reference.name}에서 센서까지의 직선거리를 표시해요.</p>}
      <p>가로등과 보안등은 서울시 도면에 기록된 위치를 참고했어요. 등기구 높이와 밤에 켜진 모습은 모형이며, 실제 밝기와 소음은 현장 확인이 필요해요.</p>
    </article>
    <article className="site-card">
      <h3>주변 센서 관측</h3>
      <p>서울시 S-DoT · {ambientArchive.start}~{ambientArchive.end}</p>
      <p>센서가 설치된 장소의 1시간 평균값이에요. 거리는 대로 옆과 단지 안쪽 관찰 지점에서 센서까지의 직선거리예요.</p>
      <div aria-live="polite">
        <table className="ambient-readings" aria-label={`${moment.day} ${time} KST 서울시 센서 기록`}>
          <thead><tr><th scope="col">측정 위치</th><th scope="col">평균 소음</th><th scope="col">평균 조도</th></tr></thead>
          <tbody>{ambientArchive.stations.map(station => {
            const reading = station.days[moment.day]?.[moment.hour];
            return <tr key={station.serial}>
              <th scope="row">{station.address}{scene?.stops.map(stop => <small key={stop.id}>
                {referenceNames[stop.id] ?? stop.name} {ambientStationDistance(stop.stationDistancesM[station.serial])}
              </small>)}</th>
              <td>{reading?.[0] == null ? '미기록' : `${reading[0]} dB`}</td>
              <td>{reading?.[1] == null ? '미기록' : `${reading[1]} lx`}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <details className="basis">
        <summary>같은 시각의 평일·주말 기록 범위</summary>
        <p>{time} KST에 기록한 일별 평균값 중 최솟값과 최댓값이에요. 전체 날짜 중 기록이 있는 날 수를 함께 표시해요.</p>
        <table className="ambient-readings ambient-ranges" aria-label={`${time} KST 평일과 주말의 소음·조도 기록 범위`}>
          <thead><tr><th scope="col">측정 위치</th>{ambientDayGroups.map(group => <th key={group.label} scope="col">{group.label}</th>)}</tr></thead>
          <tbody>{ambientArchive.stations.map(station => <tr key={station.serial}>
            <th scope="row">{station.address}</th>
            {ambientDayGroups.map(group => <td key={group.label}>{metrics.map(metric => {
              const { range, count } = ambientRange(station, group.days, moment.hour, metric.index);
              return <div key={metric.index}>
                {metric.label} {range === null ? '미기록' : `${range} ${metric.unit}`}
                <small>{count}/{group.days.length}일 기록</small>
              </div>;
            })}</td>)}
          </tr>)}</tbody>
        </table>
      </details>
      <details className="basis">
        <summary>자료 출처와 확인 범위</summary>
        <p>0 lx는 센서 원본 값이며 설치 환경의 영향을 받을 수 있어요. 매시 {ambientArchive.minute}분 기록이 비어 있으면 미기록으로 표시해요.</p>
        <a href={ambientSources.readings} target="_blank" rel="noreferrer">서울시 S-DoT 시간별 측정 원본 ↗</a>
        <a href={ambientSources.locations} target="_blank" rel="noreferrer">센서 설치 위치표 ↗</a>
        <a href={ambientSources.road} target="_blank" rel="noreferrer">양재대로 지도 ↗</a>
        <a href={ambientSources.sidewalk} target="_blank" rel="noreferrer">대로 옆 보행로 지도 ↗</a>
        <a href={ambientSources.lamps} target="_blank" rel="noreferrer">서울시 가로등·보안등 위치 도형 ↗</a>
      </details>
    </article>
  </section>;
}
