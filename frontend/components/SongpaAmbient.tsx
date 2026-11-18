import { useId } from 'react';
import { ambientArchive, ambientDays, ambientSources, ambientStationDistance, ambientTime, type AmbientMoment } from './data/songpa-ambient';
import type { OpoWorld } from './opo-world';

const localDay = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'UTC' });

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
      <p>3D는 하늘과 주변광의 변화를 표현해요. 조명과 단지 안 소음은 현장에서 확인해요.</p>
    </article>
    <article className="site-card">
      <h3>주변 센서 관측</h3>
      <p>서울시 S-DoT · {ambientArchive.start}~{ambientArchive.end}</p>
      {reference && <p>센서까지의 직선거리 · {reference.name} 기준</p>}
      <div aria-live="polite">
        <table className="ambient-readings" aria-label={`${moment.day} ${time} KST 서울시 센서 기록`}>
          <thead><tr><th scope="col">측정 위치</th><th scope="col">평균 소음</th><th scope="col">평균 조도</th></tr></thead>
          <tbody>{ambientArchive.stations.map(station => {
            const reading = station.days[moment.day]?.[moment.hour];
            const distance = reference?.stationDistancesM[station.serial];
            return <tr key={station.serial}>
              <th scope="row">{station.address}{distance !== undefined && <small>{ambientStationDistance(distance)}</small>}</th>
              <td>{reading?.[0] == null ? '미기록' : `${reading[0]} dB`}</td>
              <td>{reading?.[1] == null ? '미기록' : `${reading[1]} lx`}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <p>각 센서의 1시간 단위 평균값이에요. 두 측정값은 센서가 있는 장소에 해당해요.</p>
      <details className="basis">
        <summary>자료 출처와 확인 범위</summary>
        <p>0 lx는 센서가 기록한 값이에요. 빈 기록은 미기록으로 표시해요.</p>
        <a href={ambientSources.readings} target="_blank" rel="noreferrer">서울시 S-DoT 시간별 측정 원본 ↗</a>
        <a href={ambientSources.locations} target="_blank" rel="noreferrer">센서 설치 위치표 ↗</a>
        <a href={ambientSources.road} target="_blank" rel="noreferrer">양재대로 지도 ↗</a>
        <a href={ambientSources.sidewalk} target="_blank" rel="noreferrer">대로 옆 보행로 지도 ↗</a>
        <a href={ambientSources.lamps} target="_blank" rel="noreferrer">서울시 가로등 위치 자료 ↗</a>
      </details>
    </article>
  </section>;
}
