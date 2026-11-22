import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Checkbox, Input, NoData, Tag } from 'animal-island-ui';
import 'animal-island-ui/style';
import ExploreAreaMenu from './ExploreAreaMenu';
import ShelterNav from './ShelterNav';
import VillageMap, { tourMapAreas } from './VillageMap';
import { catalogScene, jamsilLeel, regions, type RegionId } from './data/regions';
import snapshot from './data/tour-complexes.generated.json';
import transactions from './data/tour-transactions.generated.json';
import { geometryLabels, useSeoulCatalog } from './data/use-seoul-catalog';
import {
  evaluateTour, parkingRatio, preferences, readManwon, summarizeTransactions, tenures,
  type ComplexFacts, type Criteria, type PreferenceId, type Tenure, type Transaction,
} from './data/tour-matching';
import './tour-planner.css';

const initial: Criteria = { maxPrice: null, maxMonthly: null, tenure: 'sale', features: [] };
const catalogPageSize = 15;
const states = {
  match: { label: '선택한 조건 충족', order: 0 },
  unknown: { label: '확인할 조건 있음', order: 1 },
  unfiltered: { label: '3D 임장 가능', order: 2 },
  'no-match': { label: '선택한 조건과 다름', order: 3 },
} as const;
const checkLabels = { match: '충족', 'no-match': '불충족', unknown: '미확인' };
const number = new Intl.NumberFormat('ko-KR');
const areaNumber = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });
const addressAliases: Partial<Record<RegionId, string>> = { opo: '경기도 광주시', songpa: '서울특별시 송파구', 'jamsil-leel': '서울특별시 송파구' };
const complexFacts: Partial<Record<RegionId, ComplexFacts>> = {
  ...snapshot.complexes,
  'jamsil-leel': { code: '', households: jamsilLeel.households, parkingSpaces: null, corridorType: null, playground: null, evCharging: null },
};
const transactionHistory: Partial<Record<RegionId, Transaction[]>> = transactions.complexes;
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

function Icon({ kind }: { kind: 'compass' | 'search' | 'calculator' }) {
  const paths = {
    compass: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18Zm3.8 5.2-2.1 5.5-5.5 2.1 2.1-5.5 5.5-2.1Z',
    search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13Zm4.7 11.2L20 20',
    calculator: 'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm1 5h8m-8 4h1m6 0h1m-8 4h1m6 0h1',
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
  const [monthly, setMonthly] = useState('');
  const [funds, setFunds] = useState({ cash: '', loan: '', reserve: '' });
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [features, setFeatures] = useState<PreferenceId[]>([]);
  const [criteria, setCriteria] = useState<Criteria>(initial);
  const [selected, setSelected] = useState<RegionId | null>(null);
  const [selectedVillage, setSelectedVillage] = useState<RegionId | null>(null);
  const [budgetOnly, setBudgetOnly] = useState(false);
  const [scenesOnly, setScenesOnly] = useState(false);
  const [catalogLimit, setCatalogLimit] = useState(catalogPageSize);
  const [catalogRequested, requestCatalog] = useState(Boolean(initialQuery));
  const [priceDrafts, setPriceDrafts] = useState<Partial<Record<RegionId, string>>>({});
  const [prices, setPrices] = useState<Partial<Record<RegionId, number | null>>>({});
  const [priceErrors, setPriceErrors] = useState<Partial<Record<RegionId, boolean>>>({});
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
  const hasBudget = criteria.maxPrice !== null || criteria.maxMonthly !== null;
  const showCatalog = !scenesOnly && !(budgetOnly && hasBudget);
  const catalogMatches = useMemo(() => {
    if (!showCatalog || !catalog) return [];
    return catalog.complexes.filter(entry => {
      if (entry.tour) return false;
      const searchable = compact(`서울 ${entry.district} ${entry.name} ${entry.address ?? ''} ${entry.kaptCode}`);
      return terms.every(term => searchable.includes(term));
    });
  }, [showCatalog, catalog, terms]);
  const rows = regions.filter(region => {
    const entry = catalog?.complexes.find(item => item.tour?.region === region.id);
    const searchable = compact(`${region.name} ${region.area} ${region.keywords} ${addressAliases[region.id] ?? ''}
      ${entry?.name ?? ''} ${entry?.kaptCode ?? ''}`);
    return terms.every(term => searchable.includes(term));
  }).map(region => {
    const scene = catalogScene(region.id);
    const facts = complexFacts[region.id] ?? { code: scene?.kaptCode ?? '', households: scene?.households ?? null,
      parkingSpaces: null, corridorType: null, playground: null, evCharging: null };
    const price = prices[region.id] ?? null;
    const result = evaluateTour(facts, criteria, price === null ? null : { amount: price, kind: 'entered-listing' });
    const history = summarizeTransactions(transactionHistory[region.id] ?? [], criteria);
    return { region, facts, price, history, ...result };
  }).filter(row => !(budgetOnly && hasBudget) || row.history.withinBudget.length > 0)
    .sort((left, right) => states[left.status].order - states[right.status].order
    || Number(right.history.withinBudget.length > 0) - Number(left.history.withinBudget.length > 0));
  const selectedRow = rows.find(row => row.region.id === selected) ?? rows[0];
  const explored = regions.find(region => region.id === selectedVillage) ?? regions[0];
  const exploreArea = tourMapAreas.find(area => area.villages.some(village => village.id === explored.id)) ?? tourMapAreas[0];
  const exploredHouseholds = complexFacts[explored.id]?.households ?? catalogScene(explored.id)?.households;
  const exploredSale = transactionHistory[explored.id]?.find(record => record.kind === 'sale');

  function usePlannedBudget() {
    if (!plannedBudget) return;
    setBudget(number.format(plannedBudget));
    setBudgetError(false);
    setBudgetOpen(false);
    document.getElementById('planner-budget')?.focus();
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const maxPrice = readManwon(budget);
    const maxMonthly = tenure === 'monthly' ? readManwon(monthly) : null;
    if (budget.trim() && maxPrice === null) {
      setBudgetError(true);
      event.currentTarget.querySelector<HTMLInputElement>('#planner-budget')?.focus();
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
    setCriteria({ maxPrice, maxMonthly, tenure, features });
    setSelected(null);
    setCatalogLimit(catalogPageSize);
    requestCatalog(true);
    results.current?.focus({ preventScroll: true });
    results.current?.scrollIntoView({ block: 'start' });
  }

  function applyPrice(event: FormEvent<HTMLFormElement>, id: RegionId) {
    event.preventDefault();
    const draft = priceDrafts[id] ?? '';
    const price = readManwon(draft);
    const invalid = draft.trim() !== '' && price === null;
    setPriceErrors(current => ({ ...current, [id]: invalid }));
    if (!invalid) setPrices(current => ({ ...current, [id]: price }));
  }

  return <main className="planner">
    <ShelterNav />

    <section className="planner-welcome" aria-labelledby="planner-title">
      <h1 id="planner-title">자유 3D 탐험</h1>
      <p className="planner-lede">실제 지도에서 단지를 고르고, 3D로 동네를 걸어보세요.</p>
    </section>

    <section id="explore-neighborhoods" aria-label="탐험할 동네">
      <div className="planner-map-layout">
        <div className="planner-map-column">
          <div className="planner-map-bar">
            <ExploreAreaMenu current={exploreArea} onSelect={area => {
              if (area.id !== exploreArea.id) setSelectedVillage(area.villages[0].id as RegionId);
            }} />
            <span className="planner-map-count">{number.format(exploreArea.villages.length)}개 단지</span>
          </div>
          <VillageMap key={exploreArea.id} area={exploreArea} selected={explored.id} onSelect={setSelectedVillage} />
        </div>
        <aside id="village-details" className="planner-explore-selection" tabIndex={-1} aria-label="선택한 단지">
          {exploreArea.villages.length > 1 && <Field id="explore-complex" label="임장 단지">
            <select id="explore-complex" value={explored.id} onChange={event => setSelectedVillage(event.target.value as RegionId)}>
              {exploreArea.villages.map(village => <option key={village.id} value={village.id}>
                {regions.find(region => region.id === village.id)?.name ?? village.label}
              </option>)}
            </select>
          </Field>}
          <div className="planner-section-heading" aria-live="polite">
            <h2>{explored.name}</h2>
            <p className="planner-address">{explored.area}</p>
          </div>
          <dl className="planner-explore-facts">
            <div><dt>세대수</dt><dd>{exploredHouseholds != null ? `${number.format(exploredHouseholds)}세대` : '미확인'}</dd></div>
            <div><dt>최근 매매 실거래</dt><dd>{exploredSale ? transactionPrice(exploredSale) : '조회 기간 내 기록 없음'}</dd>
              {exploredSale && <dd className="planner-trade-date">{exploredSale.date}</dd>}</div>
          </dl>
          <Button className="planner-enter" icon={<Icon kind="compass" />} onClick={() => onEnter(explored.id)}
            aria-label={`${explored.name} 자유 3D 탐험 시작`}>3D 탐험 시작</Button>
        </aside>
      </div>
    </section>
      <section id="tour-search" className="planner-search-panel" aria-labelledby="planner-search-title">
        <div className="planner-search-header">
          <h2 id="planner-search-title">아파트 찾기</h2>
          <button type="button" className="planner-budget-toggle-button" aria-expanded={budgetOpen}
            aria-controls="planner-budget-plan" onClick={() => setBudgetOpen(open => !open)}>
            <Icon kind="calculator" />
            가용 자금 계산
          </button>
        </div>
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
        <form id="tour-criteria" className="planner-form" onSubmit={apply} noValidate>
          <div className="planner-search-grid" data-monthly={tenure === 'monthly' || undefined}>
            <Field id="planner-area" label="자치구·주소·단지명">
              <Input id="planner-area" className="planner-input" value={query}
                onChange={event => setQuery(event.target.value)} autoComplete="off" allowClear clearAriaLabel="지역 검색어 지우기"
                placeholder="예: 송파구, 수레실길, 롯데캐슬" />
            </Field>
            <Field id="planner-tenure" label="거래 유형">
              <select id="planner-tenure" value={tenure} onChange={event => {
                setTenure(event.target.value as Tenure); setBudget(''); setMonthly(''); setBudgetError(false); setMonthlyError(false);
              }}>{Object.entries(tenures).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
            </Field>
            <Field id="planner-budget" label={tenure === 'sale' ? '최대 매매 예산' : '최대 보증금'}>
              <Input id="planner-budget" className="planner-input" inputMode="numeric" value={budget}
                status={budgetError ? 'error' : undefined} aria-describedby={budgetError ? 'planner-budget-error' : undefined} suffix="만원"
                onChange={event => { setBudget(event.target.value); setBudgetError(false); }}
                placeholder={tenure === 'sale' ? '60,000' : '38,000'} />
            </Field>
            {tenure === 'monthly' && <Field id="planner-monthly" label="최대 월세">
              <Input id="planner-monthly" className="planner-input" inputMode="numeric" value={monthly}
                status={monthlyError ? 'error' : undefined} aria-describedby={monthlyError ? 'planner-budget-error' : undefined} suffix="만원"
                placeholder="120" onChange={event => { setMonthly(event.target.value); setMonthlyError(false); }} />
            </Field>}
            <button className="planner-search-button" type="submit"><Icon kind="search" />단지 찾기</button>
          </div>
          {(budgetError || monthlyError) && <small id="planner-budget-error" role="alert">만원 단위의 양의 정수를 입력해 주세요.</small>}
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
        </form>
      </section>

      <section id="tour-candidates" className="planner-candidates" ref={results} tabIndex={-1} aria-labelledby="tour-candidates-title">
        <div className="planner-section-heading planner-results-heading">
          <h2 id="tour-candidates-title">단지 목록</h2>
          <Tag className="planner-result-count" variant="soft"><span role="status">
            {appliedQuery && `${appliedQuery} · `}{rows.length}곳 3D 임장
            {catalogMatches.length > 0 && ` · 서울 단지 정보 ${number.format(catalogMatches.length)}곳`} · {tenures[criteria.tenure]}
            {criteria.maxPrice !== null ? ` · ${criteria.tenure === 'sale' ? '매매 예산' : '보증금'} ${won(criteria.maxPrice)}` : ''}
            {criteria.maxMonthly !== null ? ` · 월세 ${won(criteria.maxMonthly)}` : ''}
          </span></Tag>
        </div>
        <Checkbox className="planner-budget-toggle" options={[
          { value: 'scenes', label: '3D 임장 가능 단지만 보기' },
          ...(hasBudget ? [{ value: 'historical', label: '예산 이내 과거 실거래가 있는 단지만 보기' }] : []),
        ]} value={[...(scenesOnly ? ['scenes'] : []), ...(hasBudget && budgetOnly ? ['historical'] : [])]}
          onChange={values => { setScenesOnly(values.includes('scenes')); setBudgetOnly(values.includes('historical')); }} />
        {showCatalog && catalogRequested && !catalog && <p className="planner-catalog-note" role="status">
          {catalogFailed ? '서울 단지 정보를 불러오지 못했어요.' : '서울 단지 정보를 불러오는 중…'}
        </p>}
        {!selectedRow && !catalogMatches.length && (catalog || !showCatalog)
          ? <NoData className="planner-empty" variant="search" icon={null} bordered title="검색 조건에 해당하는 단지가 없어요."
          description={budgetOnly && hasBudget
            ? '입력한 예산 범위의 과거 계약 기록이 없어요. 과거 거래 필터를 해제해 다른 후보를 둘러보세요.'
            : '지역명이나 단지명으로 다시 찾아보세요.'}
          extra={<Button onClick={() => {
            setQuery(''); setAppliedQuery(''); setBudgetOnly(false); setScenesOnly(false); setCatalogLimit(catalogPageSize);
          }}>모든 단지 보기</Button>} />
          : <ul className="planner-candidate-list">{rows.map(({ region, facts, price, status, checks, history }) => {
            const isSelected = selectedRow?.region.id === region.id;
            const parking = parkingRatio(facts);
            const latest = history.records[0];
            const otherTenures = latest ? [] : Object.entries(tenures).flatMap(([kind, label]) => {
              const count = transactionHistory[region.id]?.filter(record => record.kind === kind).length ?? 0;
              return count ? [`${label} ${count}건`] : [];
            });
            return <li key={region.id}>
              <button type="button" className="planner-candidate-row" aria-pressed={isSelected}
                onClick={() => { setSelected(region.id); setSelectedVillage(region.id); }}>
                <span><strong>{region.name}</strong><small>{region.area}</small></span>
                <span className="planner-candidate-price">
                  <strong>{latest ? `최근 실거래 ${transactionPrice(latest)}` : `${tenures[criteria.tenure]} 기록 없음`}</strong>
                  <small>{history.budgetApplied && latest
                    ? `예산 이내 과거 거래 ${history.withinBudget.length}건` : otherTenures.join(' · ') || states[status].label}</small>
                </span>
              </button>
              {isSelected && <div className="planner-candidate-panel">
                <div className="planner-tour-action">
                  <div><h3>3D 임장하기</h3><p>단지 안팎을 직접 걸어보세요.</p></div>
                  <div className="planner-candidate-actions">
                    <button type="button" className="planner-view-map" onClick={() => {
                      setSelectedVillage(region.id);
                      document.getElementById('village-details')?.focus({ preventScroll: true });
                      document.getElementById('explore-neighborhoods')?.scrollIntoView({ block: 'start' });
                    }}>지도에서 보기</button>
                    <Button className="planner-enter" icon={<Icon kind="compass" />} onClick={() => {
                      setSelectedVillage(region.id);
                      onEnter(region.id);
                    }}
                      aria-label={`${region.name} 3D 임장하기`}>이 단지 3D 임장하기</Button>
                  </div>
                </div>
                <details className="planner-detail">
                  <summary>실거래·생활 조건 자세히</summary>
                  <Tag className={`planner-status status-${status}`} size="small" variant="soft">{states[status].label}</Tag>
                  <div className="planner-price">
                    <span>{latest ? `최근 ${tenures[criteria.tenure]} 실거래` : `과거 ${tenures[criteria.tenure]} 실거래`}</span>
                    <strong>{latest ? transactionPrice(latest) : '조회 기간 내 기록 없음'}</strong>
                    <small>{latest ? `${latest.date} · 전용 ${areaNumber.format(latest.area)}㎡ · 현재 매물 아님`
                      : `${transactions.startDate} ~ ${transactions.endDate}`}</small>
                    {history.budgetApplied && history.records.length > 0 && <small>예산 이내 과거 계약 {history.withinBudget.length}건</small>}
                  </div>
                  <dl className="planner-facts">
                    <div><dt>세대당 주차</dt><dd>{parking === null ? '미확인' : `${parking.toFixed(2)}대`}</dd></div>
                    <div><dt>복도 유형</dt><dd>{facts.corridorType ?? '미확인'}</dd></div>
                    <div><dt>전기차 충전</dt><dd>{facts.evCharging === null ? '미확인' : facts.evCharging ? '설치 기록' : '미설치 기록'}</dd></div>
                    <div><dt>놀이터</dt><dd>{facts.playground === null ? '미확인' : facts.playground ? '시설 기록' : '없음 기록'}</dd></div>
                  </dl>
                  {checks.length > 0 && <ul className="planner-checks">{checks.map(check => <li key={check.label}>
                    <span>{check.label}</span><strong>{checkLabels[check.result]}</strong>
                  </li>)}</ul>}
                  {history.records.length > 0 && <ul className="planner-transaction-list" aria-label="과거 계약 내역">{history.records.map((record, index) =>
                    <li key={`${record.date}-${index}`}><span>{record.date} · 전용 {areaNumber.format(record.area)}㎡</span>
                      <strong>{transactionPrice(record)}</strong></li>,
                  )}</ul>}
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
              </div>}
            </li>;
          })}
            {catalogMatches.slice(0, catalogLimit).map(entry => <li key={entry.kaptCode} className="planner-catalog-row">
              <div><strong>{entry.name}</strong><small>{entry.address ?? `서울 ${entry.district} · 도로명주소 미확인`}</small></div>
              <div><strong>3D 미제공</strong><small>{hasBudget || criteria.features.length
                ? '예산·생활 조건 미확인' : geometryLabels[entry.geometry]}</small></div>
            </li>)}
          </ul>}
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
  </main>;
}
