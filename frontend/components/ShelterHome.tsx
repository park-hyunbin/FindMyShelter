'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { regions, type RegionId } from './data/regions';
import TourPlanner from './TourPlanner';
import './shelter-home.css';

function Opening() {
  return <main className="shelter-opening" role="status">3D 공간을 준비하는 중…</main>;
}

const Tour = dynamic(() => import('./OpoTour'), { ssr: false, loading: Opening });

function normalize(value: string) {
  return value.replace(/\s/g, '').toLowerCase();
}

export default function ShelterHome({ initialQuery = '' }: { initialQuery?: string }) {
  const [region, setRegion] = useState<RegionId | null>(null);
  const [query, setQuery] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    function syncRegion() {
      const params = new URLSearchParams(window.location.search);
      const requested = params.get('region');
      dialog.current?.close();
      setRegion(regions.find(entry => entry.id === requested)?.id ?? null);
    }

    syncRegion();
    const params = new URLSearchParams(window.location.search);
    if (!params.has('region') && (initialQuery || params.get('mode') === 'match')) {
      document.getElementById('tour-search')?.scrollIntoView();
    }
    window.addEventListener('popstate', syncRegion);
    return () => window.removeEventListener('popstate', syncRegion);
  }, [initialQuery]);

  const matches = regions.filter(entry =>
    normalize(`${entry.name}${entry.area}${entry.keywords}`).includes(normalize(query)),
  );

  function openPicker() {
    setQuery('');
    dialog.current?.showModal();
  }

  function changeRegion(next: RegionId | null) {
    dialog.current?.close();
    if (next === region) return;

    const url = new URL(window.location.href);
    if (next === null) url.searchParams.delete('region');
    else url.searchParams.set('region', next);
    url.hash = '';
    window.history.pushState(null, '', url);
    setRegion(next);
  }

  return <>
    <div hidden={region !== null}><TourPlanner initialQuery={initialQuery} onEnter={changeRegion} /></div>
    {region !== null && <Tour key={region} region={region} onChangeRegion={openPicker} />}
    <dialog id="region-picker" ref={dialog} className="region-picker" aria-labelledby="region-picker-title"
      onKeyDown={event => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
        event.preventDefault();
        dialog.current?.close();
      }}>
      <header>
        <h2 id="region-picker-title">지역 바꾸기</h2>
        <button type="button" onClick={() => dialog.current?.close()}>닫기</button>
      </header>
      <label htmlFor="region-query">지역 검색</label>
      <input id="region-query" type="search" value={query} onChange={event => setQuery(event.target.value)}
        placeholder="오포, 송파, 가락동" />
      {matches.length > 0 ? <ul>
        {matches.map(entry => <li key={entry.id}>
          <button type="button" onClick={() => changeRegion(entry.id)} aria-current={entry.id === region ? 'true' : undefined}>
            <strong>{entry.name}</strong>
            <small>{entry.area}</small>
            <span>{entry.id === region ? '현재 지역' : '입장'}</span>
          </button>
        </li>)}
      </ul> : <p role="status">검색 결과가 없어요.</p>}
      <button type="button" className="region-planner-return" onClick={() => {
        changeRegion(null);
        requestAnimationFrame(() => document.getElementById('explore-neighborhoods')?.scrollIntoView());
      }}>← 탐험 지도로 돌아가기</button>
      <a href="/polygons/">건물 데이터 검증 ↗</a>
    </dialog>
  </>;
}
