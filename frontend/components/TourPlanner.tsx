import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Image from 'next/image';
import { Button, Checkbox, Input, NoData, Tag } from 'animal-island-ui';
import 'animal-island-ui/style';
import ExploreAreaMenu from './ExploreAreaMenu';
import TradeHistoryChart from './TradeHistoryChart';
import ShelterNav from './ShelterNav';
import VillageMap, { tourMapAreas, type MapComplexId, type TourMapArea } from './VillageMap';
import { catalogScene, jamsilLeel, regions, type RegionId } from './data/regions';
import gwangjuComplexes from './data/gwangju-map-complexes.generated.json';
import snapshot from './data/tour-complexes.generated.json';
import transactions from './data/tour-transactions.generated.json';
import { geometryLabels, useSeoulCatalog } from './data/use-seoul-catalog';
import {
  evaluateTour, parkingRatio, preferences, readManwon, readSaleBudget, summarizeTransactions, tenures,
  type ComplexFacts, type Criteria, type PreferenceId, type Tenure, type Transaction,
} from './data/tour-matching';
import './tour-planner.css';

const initial: Criteria = { maxPrice: null, maxMonthly: null, tenure: 'sale', features: [] };
const catalogPageSize = 15;
const states = {
  match: { label: '선택한 조건 충족', order: 0 },
  unknown: { label: '확인할 조건 있음', order: 1 },
  unfiltered: { label: '조건 설정 없음', order: 2 },
  'no-match': { label: '선택한 조건과 다름', order: 3 },
} as const;
const checkLabels = { match: '충족', 'no-match': '불충족', unknown: '미확인' };
const number = new Intl.NumberFormat('ko-KR');
const areaNumber = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });
const addressAliases: Partial<Record<RegionId, string>> = { opo: '경기도 광주시', songpa: '서울특별시 송파구', 'jamsil-leel': '서울특별시 송파구' };
const scenePostcards = new Set<RegionId>(['opo', 'songpa', 'jamsil-leel', 'seoul-a13880407']);
const complexFacts: Partial<Record<MapComplexId, ComplexFacts>> = {
  ...snapshot.complexes,
  'jamsil-leel': { code: '', households: jamsilLeel.households, parkingSpaces: null, corridorType: null, playground: null, evCharging: null },
};
const transactionHistory: Partial<Record<MapComplexId, Transaction[]>> = transactions.complexes;
const mapComplexes = [
  ...regions.map(region => ({ id: region.id, name: region.name, area: region.area,
    keywords: `${region.keywords} ${addressAliases[region.id] ?? ''}`, tourId: region.id,
    kaptCode: complexFacts[region.id]?.code ?? '', footprint: null })),
  ...gwangjuComplexes.map(complex => ({ id: complex.id as `gwangju-a${string}`, name: complex.name, area: complex.address,
    keywords: complex.keywords, tourId: null, kaptCode: complex.kaptCode, footprint: complex })),
];
const complexesById = new Map(mapComplexes.map(complex => [complex.id, complex]));
const featureLabels: Record<PreferenceId, string> = {
  parking: '세대당 주차 2대+',
  ev: '전기차 충전',
  playground: '놀이터',
};
const budgetInputs = [
  { id: 'cash', label: '보유 자금' },
  { id: 'loan', label: '사용할 대출금' },
  { id: 'reserve', label: '빼둘 비용·여유 자금' },
] as const;

function plannedAmount(value: string) {
  return !value.trim() || /^0+$/.test(value.trim()) ? 0 : readManwon(value);
}

function compact(value: string) {
  return value.normalize('NFC').replace(/\s+/g, '').toLowerCase();
}

function won(amount: number) {
  if (amount < 10000) return `${number.format(amount)}만 원`;
  const eok = Math.floor(amount / 10000);
  const man = amount % 10000;
  return man ? `${number.format(eok)}억 ${number.format(man)}만 원` : `${number.format(eok)}억 원`;
}

function transactionPrice(record: Transaction) {
  return record.monthly === null ? won(record.amount) : `${won(record.amount)} / 월 ${won(record.monthly)}`;
}

function missingTransaction(id: MapComplexId, tenure: Tenure) {
  if (id === 'jamsil-leel' && tenure === 'sale') return '아파트 매매 조회 기록 없음';
  return Object.hasOwn(transactionHistory, id)
    ? `조회 자료에 ${tenures[tenure]} 기록 없음` : `${tenures[tenure]} 실거래 자료 미확인`;
}

function Icon({ kind }: { kind: 'compass' | 'search' | 'calculator' | 'building' }) {
  const paths = {
    compass: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18Zm3.8 5.2-2.1 5.5-5.5 2.1 2.1-5.5 5.5-2.1Z',
    search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13Zm4.7 11.2L20 20',
    calculator: 'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm1 5h8m-8 4h1m6 0h1m-8 4h1m6 0h1',
    building: 'M5 21V7l7-4 7 4v14H5Zm4-11h.01M15 10h.01M9 14h.01M15 14h.01M10 21v-3h4v3',
  };
  return <svg className="planner-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d={paths[kind]} /></svg>;
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <div className="planner-field"><label htmlFor={id}>{label}</label>{children}</div>;
}

export default function TourPlanner({ initialQuery, onEnter }: {
  initialQuery: string; onEnter: (region: RegionId) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [appliedQuery, setAppliedQuery] = useState(initialQuery);
  const [tenure, setTenure] = useState<Tenure>('sale');
  const [budget, setBudget] = useState('');
  const [saleEok, setSaleEok] = useState('');
  const [saleTenMillions, setSaleTenMillions] = useState('');
  const [monthly, setMonthly] = useState('');
  const [funds, setFunds] = useState({ cash: '', loan: '', reserve: '' });
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [features, setFeatures] = useState<PreferenceId[]>([]);
  const [criteria, setCriteria] = useState<Criteria>(initial);
  const [selected, setSelected] = useState<MapComplexId>(() => {
    const initialTerms = initialQuery.trim().split(/\s+/).filter(Boolean).map(compact);
    return mapComplexes.find(region => {
      const address = compact(`${region.name} ${region.area} ${region.keywords} ${region.kaptCode}`);
      return initialTerms.every(term => address.includes(term));
    })?.id ?? regions[0].id;
  });
  const [exploreArea, setExploreArea] = useState(() =>
    tourMapAreas.find(area => !area.parent && area.villages.some(village => village.id === selected)) ?? tourMapAreas[0]);
  const [tradesOnly, setTradesOnly] = useState(false);
  const [selectedCatalogCode, setSelectedCatalogCode] = useState<string | null>(null);
  const [detailFilter, setDetailFilter] = useState<{ region: MapComplexId; tenure: Tenure } | null>(null);
  const [tradePhase, setTradePhase] = useState('');
  const [scenesOnly, setScenesOnly] = useState(false);
  const [catalogLimit, setCatalogLimit] = useState(catalogPageSize);
  const [catalogRequested, requestCatalog] = useState(Boolean(initialQuery));
  const [priceDrafts, setPriceDrafts] = useState<Partial<Record<MapComplexId, string>>>({});
  const [prices, setPrices] = useState<Partial<Record<MapComplexId, number | null>>>({});
  const [priceErrors, setPriceErrors] = useState<Partial<Record<MapComplexId, boolean>>>({});
  const [budgetError, setBudgetError] = useState(false);
  const [monthlyError, setMonthlyError] = useState(false);
  const results = useRef<HTMLElement>(null);
  const { catalog, catalogFailed } = useSeoulCatalog(catalogRequested);

  useEffect(() => {
    if (catalogRequested || !results.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) requestCatalog(true);
    });
    observer.observe(results.current);
    return () => observer.disconnect();
  }, [catalogRequested]);

  const [cash, loan, reserve] = budgetInputs.map(({ id }) => plannedAmount(funds[id]));
  const plannedBudget = cash === null || loan === null || reserve === null || !Number.isSafeInteger(cash + loan)
    ? null : Math.max(0, cash + loan - reserve);

  const terms = useMemo(() => appliedQuery.trim().split(/\s+/).filter(Boolean).map(compact), [appliedQuery]);
  const explored = complexesById.get(selected) ?? mapComplexes[0];
  const areaLabel = exploreArea.name.split(' · ').at(-1);
  const areaRegions = useMemo(() => new Set(exploreArea.villages.map(village => village.id)), [exploreArea]);
  const areaDistricts = useMemo(() => new Set(regions.filter(region => areaRegions.has(region.id))
    .flatMap(region => {
      const district = region.area.match(/^서울(?:특별시)?\s+(\S+구)\s/)?.[1];
      return district ? [district] : [];
    })), [areaRegions]);
  const hasBudget = criteria.maxPrice !== null || criteria.maxMonthly !== null;
  const showCatalog = !exploreArea.parent && areaDistricts.size > 0 && !scenesOnly && !tradesOnly;
  const catalogMatches = useMemo(() => {
    if (!showCatalog || !catalog) return [];
    return catalog.complexes.filter(entry => {
      if (entry.tour || !areaDistricts.has(entry.district)) return false;
      const searchable = compact(`서울 ${entry.district} ${entry.name} ${entry.address ?? ''} ${entry.kaptCode}`);
      return terms.every(term => searchable.includes(term));
    });
  }, [showCatalog, catalog, terms, areaDistricts]);
  const areaComplexes = mapComplexes.filter(region => areaRegions.has(region.id));
  function matchesTerms(region: typeof explored, searchTerms: string[]) {
    const entry = catalog?.complexes.find(item => item.tour?.region === region.id);
    const searchable = compact(`${region.name} ${region.area} ${region.keywords} ${region.kaptCode}
      ${entry?.name ?? ''} ${entry?.kaptCode ?? ''}`);
    return searchTerms.every(term => searchable.includes(term));
  }
  const areaRows = areaComplexes.map(region => {
    const scene = region.tourId ? catalogScene(region.tourId) : undefined;
    const facts = complexFacts[region.id] ?? { code: scene?.kaptCode ?? '', households: scene?.households ?? null,
      parkingSpaces: null, corridorType: null, playground: null, evCharging: null };
    const price = prices[region.id] ?? null;
    const result = evaluateTour(facts, criteria, price === null ? null : { amount: price, kind: 'entered-listing' });
    const history = summarizeTransactions(transactionHistory[region.id] ?? [], criteria);
    return { region, facts, price, history, ...result };
  });
  const rows = areaRows.filter(({ region, history }) => (!scenesOnly || region.tourId) && matchesTerms(region, terms)
    && (!tradesOnly || (hasBudget ? history.withinBudget : history.records).length > 0))
    .sort((left, right) => states[left.status].order - states[right.status].order
    || Number(right.history.withinBudget.length > 0) - Number(left.history.withinBudget.length > 0));
  const exploredHouseholds = complexFacts[explored.id]?.households ?? (explored.tourId ? catalogScene(explored.tourId)?.households : null);
  const exploredTrade = transactionHistory[explored.id]?.find(record => record.kind === criteria.tenure);
  const catalogSelection = selectedCatalogCode ? catalogMatches.find(entry => entry.kaptCode === selectedCatalogCode) : undefined;
  const selectedRow = areaRows.find(row => row.region.id === selected);
  const activeDetail = catalogSelection
    ? { name: catalogSelection.name, address: catalogSelection.address ?? `서울 ${catalogSelection.district} · 도로명주소 미확인` }
    : selectedRow && { name: selectedRow.region.name, address: selectedRow.region.area };

  function selectComplex(id: MapComplexId) {
    setSelectedCatalogCode(null);
    setSelected(id);
  }

  function showSelectedDetail() {
    const panel = document.getElementById('planner-candidate-panel');
    panel?.focus({ preventScroll: true });
    panel?.scrollIntoView({ block: 'start' });
  }

  function selectArea(area: TourMapArea) {
    if (area.id === exploreArea.id) return;
    setExploreArea(area);
    selectComplex((area.villages.find(village => village.id === selected) ?? area.villages[0]).id as MapComplexId);
    setQuery('');
    setAppliedQuery('');
    setDetailFilter(null);
    setCatalogLimit(catalogPageSize);
  }

  function usePlannedBudget() {
    if (!plannedBudget) return;
    if (tenure === 'sale') {
      const eok = Math.floor(plannedBudget / 10000);
      const tenMillions = plannedBudget % 10000 / 1000;
      setSaleEok(eok ? String(eok) : '');
      setSaleTenMillions(tenMillions ? String(tenMillions) : '');
    } else {
      setBudget(number.format(plannedBudget));
    }
    setBudgetError(false);
    setBudgetOpen(false);
    document.getElementById('planner-budget')?.focus();
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const sale = tenure === 'sale';
    const maxPrice = sale ? readSaleBudget(saleEok, saleTenMillions) : readManwon(budget);
    const hasPrice = sale ? saleEok.trim() || saleTenMillions.trim() : budget.trim();
    const maxMonthly = tenure === 'monthly' ? readManwon(monthly) : null;
    if (hasPrice && maxPrice === null) {
      setBudgetError(true);
      const selector = sale && /^\d*$/.test(saleEok.trim()) && saleTenMillions.trim()
        ? '#planner-budget-thousand' : '#planner-budget';
      event.currentTarget.querySelector<HTMLInputElement>(selector)?.focus();
      return;
    }
    if (tenure === 'monthly' && monthly.trim() && maxMonthly === null) {
      setMonthlyError(true);
      event.currentTarget.querySelector<HTMLInputElement>('#planner-monthly')?.focus();
      return;
    }
    setBudgetError(false);
    setMonthlyError(false);
    setAppliedQuery(query.trim());
    const nextTerms = query.trim().split(/\s+/).filter(Boolean).map(compact);
    const nextComplexes = areaComplexes.filter(region => (!scenesOnly || region.tourId) && matchesTerms(region, nextTerms));
    setSelectedCatalogCode(null);
    if (!nextComplexes.some(region => region.id === selected) && nextComplexes[0]) selectComplex(nextComplexes[0].id);
    setCriteria({ maxPrice, maxMonthly, tenure, features });
    setDetailFilter(null);
    setCatalogLimit(catalogPageSize);
    requestCatalog(true);
    results.current?.focus({ preventScroll: true });
    results.current?.scrollIntoView({ block: 'start' });
  }

  function applyPrice(event: FormEvent<HTMLFormElement>, id: MapComplexId) {
    event.preventDefault();
    const draft = priceDrafts[id] ?? '';
    const price = readManwon(draft);
    const invalid = draft.trim() !== '' && price === null;
    setPriceErrors(current => ({ ...current, [id]: invalid }));
    if (!invalid) setPrices(current => ({ ...current, [id]: price }));
  }

  function renderSceneDetails({ region, facts, price, status, checks, history }: typeof rows[number]) {
    const parking = parkingRatio(facts);
    const latest = history.records[0];
    const detailTenure = detailFilter?.region === region.id ? detailFilter.tenure : criteria.tenure;
    const usesSearchTenure = detailTenure === criteria.tenure;
    const phases = region.footprint?.phases ?? [];
    const activePhase = phases.includes(tradePhase) ? tradePhase : '';
    const detailRecords = (usesSearchTenure ? history.records : (transactionHistory[region.id] ?? [])
      .filter(record => record.kind === detailTenure)).filter(record => !activePhase || record.phase === activePhase);
    const rightsCancellation = region.id === 'jamsil-leel' && detailTenure === 'sale' ? jamsilLeel.rightCancellation : null;
    const otherTenures = latest ? [] : Object.entries(tenures).flatMap(([kind, label]) => {
      const count = transactionHistory[region.id]?.filter(record => record.kind === kind).length ?? 0;
      return count ? [`${label} ${count}건`] : [];
    });

    return <div key={region.id}>
      {latest && <p className="planner-panel-trade"><strong>{transactionPrice(latest)}</strong>
        <small>최근 {tenures[criteria.tenure]} · <time dateTime={latest.date}>{latest.date}</time>{latest.phase && ` · ${latest.phase}`}</small>
      </p>}
      {otherTenures.length > 0 && <p className="planner-panel-address">다른 거래 유형 · {otherTenures.join(' · ')}</p>}
      <div className="planner-candidate-meta">
        <span>주차 {parking === null ? '미확인' : `세대당 ${parking.toFixed(2)}대`}</span>
        <span>현관 동선 {facts.corridorType ?? '미확인'}</span>
        <button type="button" className="planner-view-map" onClick={() => {
          document.getElementById('village-details')?.focus({ preventScroll: true });
          document.getElementById('explore-neighborhoods')?.scrollIntoView({ block: 'start' });
        }}>지도에서 보기</button>
      </div>
      <details className="planner-detail">
        <summary>실거래 내역과 단지 정보</summary>
        {status !== 'unfiltered' && <Tag className={`planner-status status-${status}`} size="small" variant="soft">{states[status].label}</Tag>}
        <section className="planner-transactions" aria-labelledby={`trade-title-${region.id}`}>
          <header>
            <h3 id={`trade-title-${region.id}`}>실거래 추이</h3>
            <label className="planner-trade-filter">거래 유형
              <select value={detailTenure} aria-label="그래프 거래 유형"
                onChange={event => setDetailFilter({ region: region.id, tenure: event.target.value as Tenure })}>
                {Object.entries(tenures).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
          </header>
          {phases.length > 0 && <label className="planner-trade-filter planner-phase-filter">거래 단지
            <select value={activePhase} aria-label="실거래 단지 구분" onChange={event => setTradePhase(event.target.value)}>
              <option value="">1·2단지 전체</option>
              {phases.map(phase => <option key={phase}>{phase}</option>)}
            </select>
          </label>}
          {detailRecords.length ? <>
            <TradeHistoryChart key={detailTenure + activePhase} records={detailRecords} tenure={detailTenure} formatPrice={won} />
            <details className="planner-contracts" key={detailTenure + activePhase + '-contracts'}>
              <summary>계약 내역 <span>{number.format(detailRecords.length)}건</span></summary>
              <div className="planner-transaction-scroll" tabIndex={detailRecords.length > 5 ? 0 : undefined}
                role="region" aria-label="과거 계약 내역">
                <table className="planner-transaction-table" aria-label={`${tenures[detailTenure]} 계약 내역`}>
                  <thead><tr><th scope="col">계약일</th><th scope="col">전용면적</th>
                    <th scope="col">{detailTenure === 'sale' ? '거래가' : detailTenure === 'jeonse' ? '보증금' : '보증금 / 월세'}</th></tr></thead>
                  <tbody>{detailRecords.map((record, index) =>
                    <tr key={`${record.date}-${index}`} data-latest={index === 0 || undefined}>
                      <td><time dateTime={record.date}>{record.date}</time>{record.phase && <small>{record.phase}</small>}</td>
                      <td>{areaNumber.format(record.area)}㎡</td>
                      <td><strong>{won(record.amount)}</strong>
                        {record.monthly !== null && <small>월 {won(record.monthly)}</small>}</td>
                    </tr>,
                  )}</tbody>
                </table>
              </div>
            </details>
          </> : <p className="planner-transaction-empty">{activePhase
            ? `조회 자료에 ${activePhase} ${tenures[detailTenure]} 기록 없음` : missingTransaction(region.id, detailTenure)}</p>}
          {Object.hasOwn(transactionHistory, region.id) && <footer>
            <span>과거 계약 · {transactions.startDate} ~ {transactions.endDate}</span>
            {usesSearchTenure && history.budgetApplied && latest && <span>예산 이내 {number.format(history.withinBudget
              .filter(record => !activePhase || record.phase === activePhase).length)}건</span>}
          </footer>}
        </section>
        {rightsCancellation && <section className="planner-rights-report" aria-label="별도 입주권 신고">
          <h3>입주권 신고 <span>계약 해제</span></h3>
          <p><strong>{won(rightsCancellation.amount)}</strong> · {areaNumber.format(rightsCancellation.area)}㎡ · {rightsCancellation.floor}층</p>
          <p><time dateTime={rightsCancellation.contractDate}>{rightsCancellation.contractDate}</time> 계약 ·
            {' '}<time dateTime={rightsCancellation.cancellationDate}>{rightsCancellation.cancellationDate}</time> 해제</p>
          <p><a href={rightsCancellation.source} target="_blank" rel="noreferrer">서울시 분양·입주권 조회 ↗</a>
            {' · '}<small>{rightsCancellation.checkedDate} 확인</small></p>
        </section>}
        <dl className="planner-facts">
          <div><dt>전기차 충전</dt><dd>{facts.evCharging === null ? '미확인' : facts.evCharging ? '설치 기록' : '미설치 기록'}</dd></div>
          <div className={facts.playground ? 'planner-playground' : undefined}>
            <dt>놀이터</dt><dd>{facts.playground === null ? '미확인' : facts.playground ? '시설 기록' : '없음 기록'}</dd>
          </div>
        </dl>
        {checks.length > 0 && <ul className="planner-checks">{checks.map(check => <li key={check.label}>
          <span>{check.label}</span><strong>{checkLabels[check.result]}</strong>
        </li>)}</ul>}
        {criteria.tenure === 'sale' && <form className="planner-listing" onSubmit={event => applyPrice(event, region.id)}>
          <label htmlFor={`listing-${region.id}`}>직접 확인한 매물가 <small>(선택)</small></label>
          <div><Input id={`listing-${region.id}`} className="planner-input" inputMode="numeric" value={priceDrafts[region.id] ?? ''}
            placeholder="매매가 입력" suffix="만원" status={priceErrors[region.id] ? 'error' : undefined}
            aria-describedby={`listing-note-${region.id}`} onChange={event => {
              setPriceDrafts(current => ({ ...current, [region.id]: event.target.value }));
              setPriceErrors(current => ({ ...current, [region.id]: false }));
            }} /><Button htmlType="submit" size="small">반영</Button></div>
          <small id={`listing-note-${region.id}`} role="status">{priceErrors[region.id] ? '만원 단위의 양의 정수를 입력해 주세요.'
            : price !== null ? `직접 입력한 ${won(price)} 기준` : '현재 매물가 미확인'}</small>
        </form>}
      </details>
    </div>;
  }

  return <main className="planner">
    <ShelterNav />

    <div className="planner-content">
    <section id="explore-neighborhoods" className="planner-overview" aria-labelledby="planner-title">
      <header className="planner-welcome">
        <h1 id="planner-title">집 보러 가기 전, 먼저 살아보세요.</h1>
        <p className="planner-lede">실제 지도에서 단지를 고르고, 3D로 동네를 걸어보세요.</p>
      </header>
      <div className="planner-map-layout">
        <div className="planner-map-column">
          <div className="planner-map-bar">
            <ExploreAreaMenu current={exploreArea} onSelect={selectArea} />
            <span className="planner-map-count">{areaComplexes.length}개 단지 · 3D {areaComplexes.filter(complex => complex.tourId).length}곳</span>
          </div>
          <VillageMap key={exploreArea.id} area={exploreArea} selected={explored.id} onSelect={selectComplex} />
        </div>
        <aside id="village-details" className="planner-explore-selection" tabIndex={-1} aria-label="선택한 단지">
          <div className="planner-explore-label"><Icon kind={explored.tourId ? 'compass' : 'building'} /><span>선택한 단지</span></div>
          <div className="planner-section-heading" aria-live="polite">
            <h2>{explored.name}</h2>
            <p className="planner-address">{explored.area}</p>
          </div>
          {exploreArea.villages.length > 1 && <Field id="explore-complex" label="같은 지역 단지 바꾸기">
            <select id="explore-complex" value={explored.id} onChange={event => selectComplex(event.target.value as MapComplexId)}>
              {exploreArea.villages.map(village => <option key={village.id} value={village.id}>
                {complexesById.get(village.id as MapComplexId)?.name ?? village.label}
              </option>)}
            </select>
          </Field>}
          <dl className="planner-explore-facts">
            <div><dt>세대수</dt><dd>{exploredHouseholds != null ? `${number.format(exploredHouseholds)}세대` : '미확인'}</dd></div>
            {explored.footprint && <div><dt>건물 외곽</dt><dd>{explored.footprint.mappedTowers}/{explored.footprint.towerCount}개 동</dd></div>}
            {complexFacts[explored.id]?.corridorType && <div><dt>현관 동선</dt><dd>{complexFacts[explored.id]?.corridorType}</dd></div>}
            <div className="planner-explore-trade"><dt>최근 {tenures[criteria.tenure]} 실거래</dt>
              <dd>{exploredTrade ? transactionPrice(exploredTrade) : missingTransaction(explored.id, criteria.tenure)}</dd>
              {exploredTrade && <dd className="planner-trade-date"><time dateTime={exploredTrade.date}>{exploredTrade.date}</time>
                {exploredTrade.phase && ` · ${exploredTrade.phase}`}</dd>}
              {explored.id === 'jamsil-leel' && criteria.tenure === 'sale' && <dd className="planner-trade-date">별도 입주권 해제 신고 1건</dd>}
            </div>
          </dl>
          {explored.tourId ? <Button className="planner-enter" icon={<Icon kind="compass" />} onClick={() => {
            if (explored.tourId) onEnter(explored.tourId);
          }}
            aria-label={`${explored.name} 자유 3D 탐험 시작`}>3D 탐험 시작</Button>
            : <button type="button" className="planner-map-detail-button" onClick={() => {
              if (catalogSelection) {
                selectComplex(explored.id);
                requestAnimationFrame(showSelectedDetail);
              } else showSelectedDetail();
            }}>단지 정보 보기</button>}
        </aside>
      </div>
      </section>
      <section id="tour-search" className="planner-search-panel" aria-labelledby="planner-search-title">
        <h2 id="planner-search-title" className="planner-search-title">조건 검색</h2>
        <form id="tour-criteria" className="planner-form" onSubmit={apply} noValidate>
          <div className="planner-search-grid" data-sale={tenure === 'sale' || undefined} data-monthly={tenure === 'monthly' || undefined}>
            <Field id="planner-area" label="자치구·주소·단지명">
              <Input id="planner-area" className="planner-input" value={query}
                onChange={event => setQuery(event.target.value)} autoComplete="off" allowClear clearAriaLabel="지역 검색어 지우기"
                placeholder="예: 송파구, 수레실길, 롯데캐슬" />
            </Field>
            <Field id="planner-tenure" label="거래 유형">
              <select id="planner-tenure" value={tenure} onChange={event => {
                setTenure(event.target.value as Tenure);
                setBudget(''); setSaleEok(''); setSaleTenMillions(''); setMonthly('');
                setBudgetError(false); setMonthlyError(false);
              }}>{Object.entries(tenures).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
            </Field>
            {tenure === 'sale' ? <fieldset className="planner-field planner-sale-budget">
              <legend>최대 매매 예산</legend>
              <div className="planner-sale-amount">
                <Input id="planner-budget" aria-label="최대 매매 예산 억원" className="planner-input" inputMode="numeric" value={saleEok}
                  status={budgetError ? 'error' : undefined} aria-describedby={budgetError ? 'planner-budget-error' : undefined}
                  onChange={event => { setSaleEok(event.target.value); setBudgetError(false); }} placeholder="6" suffix="억원" />
                <Input id="planner-budget-thousand" aria-label="최대 매매 예산 천만원" className="planner-input" inputMode="decimal" value={saleTenMillions}
                  status={budgetError ? 'error' : undefined} aria-describedby={budgetError ? 'planner-budget-error' : undefined}
                  onChange={event => { setSaleTenMillions(event.target.value); setBudgetError(false); }} placeholder="0" suffix="천만원" />
              </div>
            </fieldset> : <Field id="planner-budget" label="최대 보증금">
              <Input id="planner-budget" className="planner-input" inputMode="numeric" value={budget}
                status={budgetError ? 'error' : undefined} aria-describedby={budgetError ? 'planner-budget-error' : undefined} suffix="만원"
                onChange={event => { setBudget(event.target.value); setBudgetError(false); }}
                placeholder="38,000" />
            </Field>}
            {tenure === 'monthly' && <Field id="planner-monthly" label="최대 월세">
              <Input id="planner-monthly" className="planner-input" inputMode="numeric" value={monthly}
                status={monthlyError ? 'error' : undefined} aria-describedby={monthlyError ? 'planner-budget-error' : undefined} suffix="만원"
                placeholder="120" onChange={event => { setMonthly(event.target.value); setMonthlyError(false); }} />
            </Field>}
            <button className="planner-search-button" type="submit"><Icon kind="search" />단지 찾기</button>
          </div>
          {(budgetError || monthlyError) && <small id="planner-budget-error" role="alert">
            {tenure === 'sale' ? '억원은 정수, 천만원은 0~9.999 사이로 입력해 주세요. 예산은 0보다 커야 해요.'
              : '만원 단위의 양의 정수를 입력해 주세요.'}
          </small>}
          <div className="planner-search-extras">
            <fieldset className="planner-feature-bar">
              <legend>생활 조건</legend>
              <div className="planner-feature-options">{preferences.map(({ id }) => (
                <label key={id}>
                  <input type="checkbox" checked={features.includes(id)} onChange={event => {
                    const checked = event.currentTarget.checked;
                    setFeatures(current => checked ? [...current, id] : current.filter(feature => feature !== id));
                  }} />
                  {featureLabels[id]}
                </label>
              ))}</div>
            </fieldset>
            <button type="button" className="planner-budget-toggle-button" aria-expanded={budgetOpen}
              aria-controls="planner-budget-plan" onClick={() => setBudgetOpen(open => !open)}>
              <Icon kind="calculator" />
              가용 자금 계산
            </button>
          </div>
        </form>
        <div id="planner-budget-plan" className="planner-budget-body" hidden={!budgetOpen}>
          <div className="planner-budget-fields">
            {budgetInputs.map(({ id, label }) => <Field key={id} id={`planner-funds-${id}`} label={label}>
              <Input id={`planner-funds-${id}`} className="planner-input" inputMode="numeric" value={funds[id]} suffix="만원"
                status={plannedAmount(funds[id]) === null ? 'error' : undefined}
                onChange={event => setFunds(current => ({ ...current, [id]: event.target.value }))} />
            </Field>)}
          </div>
          <div className="planner-budget-result">
            <p className="planner-budget-total" aria-live="polite">
              {plannedBudget === null ? '만원 단위의 숫자를 확인해 주세요.' : <>가용 자금 <strong>{won(plannedBudget)}</strong></>}
            </p>
            <Button className="planner-apply-budget" disabled={!plannedBudget} onClick={usePlannedBudget}>
              {tenure === 'sale' ? '매매 예산으로 쓰기' : '보증금 예산으로 쓰기'}
            </Button>
          </div>
        </div>
      </section>

      <section id="tour-candidates" className="planner-candidates" ref={results} tabIndex={-1} aria-labelledby="tour-candidates-title">
        <div className="planner-section-heading planner-results-heading">
          <h2 id="tour-candidates-title">{areaLabel} 단지 목록</h2>
          <Tag className="planner-result-count" variant="soft"><span role="status">
            {appliedQuery && `${appliedQuery} · `}{number.format(rows.length + catalogMatches.length)}개 단지
            {' · '}3D {rows.filter(row => row.region.tourId).length}곳 · {tenures[criteria.tenure]}
            {criteria.maxPrice !== null ? ` · ${criteria.tenure === 'sale' ? '매매 예산' : '보증금'} ${won(criteria.maxPrice)}` : ''}
            {criteria.maxMonthly !== null ? ` · 월세 ${won(criteria.maxMonthly)}` : ''}
          </span></Tag>
        </div>
        <div className="planner-results-tools">
          <Checkbox className="planner-budget-toggle" options={[
            { value: 'scenes', label: '3D 임장 가능 단지만 보기' },
            { value: 'historical', label: hasBudget ? '예산 이내 과거 거래 단지만 보기' : `${tenures[criteria.tenure]} 기록이 있는 단지만 보기` },
          ]} value={[...(scenesOnly ? ['scenes'] : []), ...(tradesOnly ? ['historical'] : [])]}
            onChange={values => { setScenesOnly(values.includes('scenes')); setTradesOnly(values.includes('historical')); }} />
          {activeDetail && <a className="planner-panel-jump" href="#planner-candidate-panel">선택 단지 상세</a>}
        </div>
        {showCatalog && catalogRequested && !catalog && <p className="planner-catalog-note" role="status">
          {catalogFailed ? '서울 단지 정보를 불러오지 못했어요.' : '서울 단지 정보를 불러오는 중…'}
        </p>}
        <div className="planner-comparison">{!rows.length && !catalogMatches.length && (catalog || !showCatalog)
          ? <NoData className="planner-empty" variant="search" icon={null} bordered title="검색 조건에 해당하는 단지가 없어요."
          description={tradesOnly
            ? `조회 자료에 ${hasBudget ? '예산 이내 ' : ''}${tenures[criteria.tenure]} 기록이 있는 단지가 없어요.`
            : '선택한 지역에서 검색 조건을 바꾸거나 지도에서 다른 지역을 선택해 보세요.'}
          extra={<Button onClick={() => {
            setQuery(''); setAppliedQuery(''); setTradesOnly(false); setScenesOnly(false); setCatalogLimit(catalogPageSize);
          }}>이 지역 단지 보기</Button>} />
          : <ul className="planner-candidate-list">{rows.map(({ region, history }) => {
            const isSelected = !catalogSelection && selected === region.id;
            const latest = history.records[0];
            const tourId = region.tourId;
            const priceLabel = latest ? transactionPrice(latest) : missingTransaction(region.id, criteria.tenure);
            return <li key={region.id} data-selected={isSelected}>
              <div className="planner-candidate-item">
                <button type="button" className="planner-candidate-row" aria-pressed={isSelected}
                  aria-controls="planner-candidate-panel" onClick={() => selectComplex(region.id)}>
                  <span className="planner-candidate-thumb" aria-hidden="true">
                    {tourId && scenePostcards.has(tourId)
                      ? <Image src={`/datasets/regions/${region.id}/postcard.svg`} width={64} height={42} alt="" unoptimized />
                      : <Icon kind="building" />}
                  </span>
                  <span className="planner-candidate-identity"><strong title={region.name}>{region.name}</strong><small title={region.area}>{region.area}</small></span>
                  <span className="planner-candidate-price" title={priceLabel}>
                    {latest ? <><small>최근 {tenures[criteria.tenure]}</small><strong>{priceLabel}</strong></>
                      : <small>{priceLabel}</small>}
                  </span>
                </button>
                {tourId ? <button type="button" className="planner-candidate-enter" aria-label={`${region.name} 3D 임장하기`}
                  onClick={() => onEnter(tourId)}><Icon kind="compass" />3D 임장</button>
                  : <span className="planner-candidate-map-label">지도·정보</span>}
              </div>
            </li>;
          })}
            {catalogMatches.slice(0, catalogLimit).map(entry => (
              <li key={entry.kaptCode} data-selected={catalogSelection?.kaptCode === entry.kaptCode}>
                <div className="planner-candidate-item">
                  <button type="button" className="planner-candidate-row" aria-pressed={catalogSelection?.kaptCode === entry.kaptCode}
                    aria-controls="planner-candidate-panel" onClick={() => setSelectedCatalogCode(entry.kaptCode)}>
                    <span className="planner-candidate-thumb" aria-hidden="true"><Icon kind="building" /></span>
                    <span className="planner-candidate-identity"><strong title={entry.name}>{entry.name}</strong>
                      <small title={entry.address ?? undefined}>{entry.address ?? `서울 ${entry.district} · 도로명주소 미확인`}</small>
                    </span>
                    <span className="planner-candidate-price"><small>실거래 자료 미확인</small></span>
                  </button>
                  <span className="planner-3d-unavailable">3D 미제공</span>
                </div>
              </li>
            ))}
          </ul>}
          {activeDetail && <aside id="planner-candidate-panel" className="planner-candidate-panel" aria-labelledby="planner-candidate-panel-title" tabIndex={-1}>
            <p className="planner-panel-label">{catalogSelection || rows.some(row => row.region.id === selected)
              ? '선택한 단지' : '지도에서 선택한 단지'}</p>
            <h3 id="planner-candidate-panel-title">{activeDetail.name}</h3>
            <p className="planner-panel-address">{activeDetail.address}</p>
            {catalogSelection ? <div className="planner-catalog-detail">
              <span className="planner-3d-unavailable">3D 미제공</span>
              <p>{geometryLabels[catalogSelection.geometry]}</p>
              {(hasBudget || criteria.features.length > 0) && <p>예산·생활 조건 미확인</p>}
              <a className="planner-map-link" target="_blank" rel="noreferrer"
                href={`https://map.naver.com/p/search/${encodeURIComponent(catalogSelection.address || `서울 ${catalogSelection.district} ${catalogSelection.name}`)}`}>
                네이버 지도에서 검색 ↗
              </a>
            </div> : selectedRow && renderSceneDetails(selectedRow)}
          </aside>}
          </div>
        {catalogLimit < catalogMatches.length && <Button className="planner-catalog-more"
          onClick={() => setCatalogLimit(limit => limit + catalogPageSize)}>단지 더 보기</Button>}
        {catalog && catalogMatches.length > 0 && <p className="planner-catalog-note">
          서울 단지 목록 K-apt {catalog.snapshotDate} 기준 · 건축물대장 {catalog.registerMonth} · 서울시 건물면 {catalog.footprintDate}
        </p>}
      </section>
    <footer className="planner-footer">
      <div><strong>Find My Shelter</strong><a href="/licenses/">오픈소스 라이선스</a></div>
      <p><a href="https://www.data.go.kr/data/15073271/fileData.do" target="_blank" rel="noreferrer">K-apt</a> {snapshot.snapshotDate} 기준 ·
        {' '}<a href="https://rt.molit.go.kr/pt/xls/xls.do" target="_blank" rel="noreferrer">국토교통부 실거래</a> {transactions.startDate}~{transactions.endDate}
        {' '}· <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></p>
    </footer>
    </div>
  </main>;
}
