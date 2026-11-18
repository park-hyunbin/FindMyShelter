'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { regions, type RegionId } from './data/regions';
import './shelter-home.css';

const Tour = dynamic(() => import('./OpoTour'), { ssr: false,
  loading: () => <div className="shelter-opening" role="status">선택한 동네의 탐험 도구를 준비하고 있어요…</div> });

export default function ShelterHome() {
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<RegionId | null>(null);
  if (selected) return <div className="shelter-exploring"><Tour key={selected} region={selected} onExit={() => setSelected(null)}/></div>;
  const needle = query.trim().replace(/\s/g, '').toLowerCase();
  const matches = regions.filter(r => `${r.name}${r.area}${r.keywords}`.replace(/\s/g, '').toLowerCase().includes(needle));
  return <main className="shelter-home">
    <header className="shelter-nav"><a href="/">⌂ Find My Shelter</a><span>나의 작은 세계를 발견하는 지도</span><a href="/polygons/">데이터 검증 ↗</a></header>
    <section className="shelter-hero">
      <div className="shelter-orbit" aria-hidden="true"><span>⌂</span><i/><i/><i/></div>
      <p className="shelter-eyebrow">A SMALL WORLD, YOUR SHELTER</p>
      <h1>모든 집에는 아직 발견되지 않은<br/><em>작은 우주가 있어.</em></h1>
      <p className="shelter-intro">산의 모양, 동네의 길, 집 앞의 작은 풍경까지.<br/>실제 지형 데이터 위에서 나의 보금자리를 둘러보세요.</p>
      <form className="shelter-search" onSubmit={e => { e.preventDefault(); setSearched(true); }}><label htmlFor="shelter-query">어느 동네를 둘러볼까요?</label><div><input id="shelter-query" value={query} onChange={e => { setQuery(e.target.value); setSearched(false); }} placeholder="오포 롯데캐슬, 송파, 가락동"/><button type="submit">임장구역 찾기 ↗</button></div><small>현재 준비된 오포·송파 표본을 검색할 수 있어요.</small></form>
    </section>
    <section className="shelter-regions" aria-label="임장구역 검색 결과"><div className="shelter-section-title"><h2>{searched ? '찾은 임장구역' : '먼저 발견해 볼 동네'}</h2><span>선택한 구역만 불러와요</span></div>
      {searched && matches.length === 0 && <p className="shelter-empty">이 지역은 아직 준비되지 않았어요. 현재는 오포와 송파 표본을 탐험할 수 있습니다.</p>}
      <div className="shelter-region-list">{(searched ? matches : regions).map((r, i) => <article key={r.id} className="shelter-region"><div className={`shelter-map-art art-${r.id}`} aria-hidden="true"><i/><i/><i/><b>0{i + 1}</b></div><div><span className="shelter-region-area">{r.area}</span><h3>{r.name}</h3><p>{r.description}</p><small>실제 건물 {r.count}개 · DEM · 도로 · 주변 장소</small></div><button onClick={() => setSelected(r.id)}>이 동네 탐험하기 ↗</button></article>)}</div>
    </section>
    <footer className="shelter-footer"><p>지형은 데이터로, 보금자리는 나의 이야기로.</p><small>현재는 수기 검증 전 데이터 표본입니다. 풍수 해석은 전통·문화적 관점이며 미래의 건강·재물·주택가치를 예측하지 않습니다.</small></footer>
  </main>;
}
