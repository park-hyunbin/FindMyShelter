'use client';

import { useEffect, useState } from 'react';

type Geometry = 'complete' | 'partial' | 'outline_pending' | 'register_pending';

type Entry = {
  kaptCode: string;
  district: string;
  name: string;
  address: string | null;
  geometry: Geometry;
  tour: {
    region: string;
    walkingRoutes: number;
    walkingRoutesWithElevation: number;
  } | null;
};

type DistrictTotals = {
  catalog: number;
  fullOutlines: number;
  scenes: number;
  withWalkingRoutes: number;
  withRouteProfiles: number;
};

type Catalog = {
  snapshotDate: string;
  registerMonth: string;
  footprintDate: string;
  districts: Record<string, DistrictTotals>;
  complexes: Entry[];
};

const PAGE_SIZE = 30;
const geometryLabels: Record<Geometry, string> = {
  complete: '전 주동 윤곽 연결',
  partial: '일부 주동 윤곽 연결',
  outline_pending: '주동 윤곽 연결 대기',
  register_pending: '건축물대장 연결 대기',
};

function normalize(text: string) {
  return text.normalize('NFC').toLowerCase().replace(/\s/g, '');
}

export default function SeoulCatalog() {
  const [data, setData] = useState<Catalog>();
  const [failed, setFailed] = useState(false);
  const [district, setDistrict] = useState('');
  const [query, setQuery] = useState('');
  const [scenesOnly, setScenesOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);

  useEffect(() => {
    const request = new AbortController();
    fetch('/datasets/seoul-tour-catalog.json', { signal: request.signal })
      .then(response => {
        if (!response.ok) throw new Error('Catalog request failed');
        return response.json() as Promise<Catalog>;
      })
      .then(setData)
      .catch(() => { if (!request.signal.aborted) setFailed(true); });
    return () => request.abort();
  }, []);

  if (failed) return <p role="alert">단지 목록을 불러오지 못했어요. 페이지를 새로고침해 주세요.</p>;
  if (!data) return <p role="status">서울 단지 목록을 불러오는 중…</p>;

  const districtTotals = Object.values(data.districts);
  const count = (key: keyof DistrictTotals) => district
    ? data.districts[district][key]
    : districtTotals.reduce((sum, row) => sum + row[key], 0);
  const search = normalize(query);
  const matches = data.complexes.filter(entry =>
    (!district || entry.district === district) && (!scenesOnly || entry.tour) &&
    (!search || normalize(`${entry.name} ${entry.address ?? ''} ${entry.kaptCode}`).includes(search)),
  ).sort((a, b) => Number(Boolean(b.tour)) - Number(Boolean(a.tour)));

  return <>
    <div className="seoul-catalog-filters">
      <label>자치구<select value={district} onChange={event => { setDistrict(event.target.value); setLimit(PAGE_SIZE); }}>
        <option value="">서울 전체</option>
        {Object.keys(data.districts).map(name => <option key={name}>{name}</option>)}
      </select></label>
      <label>단지 검색<input type="search" value={query}
        placeholder="단지명, 도로명주소 또는 단지코드"
        onChange={event => { setQuery(event.target.value); setLimit(PAGE_SIZE); }} /></label>
      <label className="seoul-catalog-checkbox"><input type="checkbox" checked={scenesOnly}
        onChange={event => { setScenesOnly(event.target.checked); setLimit(PAGE_SIZE); }} /> 3D 임장만 보기</label>
    </div>

    <dl className="seoul-catalog-totals" aria-label={`${district || '서울 전체'} 데이터 현황`}>
      <div><dt>단지 목록</dt><dd>{count('catalog').toLocaleString('ko-KR')}</dd></div>
      <div><dt>전 주동 윤곽 연결</dt><dd>{count('fullOutlines').toLocaleString('ko-KR')}</dd></div>
      <div><dt>3D 임장</dt><dd>{count('scenes').toLocaleString('ko-KR')}</dd></div>
      <div><dt>보행 경로 제공</dt><dd>{count('withWalkingRoutes').toLocaleString('ko-KR')}</dd></div>
      <div><dt>경로 고도 단면 제공</dt><dd>{count('withRouteProfiles').toLocaleString('ko-KR')}</dd></div>
    </dl>

    <p className="seoul-catalog-results" role="status">검색 결과 {matches.length.toLocaleString('ko-KR')}곳</p>
    {matches.length > 0 ? <ul className="seoul-catalog-list">
      {matches.slice(0, limit).map(entry => <li key={entry.kaptCode}>
        <div>
          <h2>{entry.name}</h2>
          <p>{entry.address ?? `${entry.district} · 도로명주소 미확인`}</p>
        </div>
        <div className="seoul-catalog-availability">
          {entry.tour ? <>
            <p>{entry.tour.walkingRoutes > 0
              ? `보행 경로 ${entry.tour.walkingRoutes}개 · 고도 단면 ${entry.tour.walkingRoutesWithElevation}개`
              : '보행 경로 자료 준비 중'}</p>
            <a href={`/?region=${encodeURIComponent(entry.tour.region)}`}
              aria-label={`${entry.name} 3D 임장 시작`}>3D 임장 시작</a>
          </> : <p>{geometryLabels[entry.geometry]}</p>}
        </div>
      </li>)}
    </ul> : <p>검색 조건에 해당하는 단지가 없어요.</p>}
    {limit < matches.length && <button className="seoul-catalog-more" type="button"
      onClick={() => setLimit(current => current + PAGE_SIZE)}>단지 더 보기</button>}

    <footer className="seoul-catalog-source">
      <p>K-apt 아파트 계열 목록 {data.snapshotDate} 기준. 소규모 단지 등 원본에 빠진 곳이 있을 수 있어요.</p>
      <p>건축물대장 {data.registerMonth} · 서울시 건물면 {data.footprintDate}.</p>
    </footer>
  </>;
}
