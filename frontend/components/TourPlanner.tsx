import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Card, Checkbox, Image as IslandImage, Input, NoData, Tag } from 'animal-island-ui';
import 'animal-island-ui/style';
import VillageMap from './VillageMap';
import { jamsilLeel, regions, type RegionId } from './data/regions';
import snapshot from './data/tour-complexes.generated.json';
import transactions from './data/tour-transactions.generated.json';
import {
  evaluateTour, parkingRatio, preferences, readManwon, summarizeTransactions, tenures,
  type ComplexFacts, type Criteria, type PreferenceId, type Tenure, type Transaction,
} from './data/tour-matching';
import './tour-planner.css';

export type TourMode = 'explore' | 'match';
const initial: Criteria = { maxPrice: null, maxMonthly: null, tenure: 'sale', features: [] };
const states = {
  match: { label: '선택한 조건 충족', order: 0, color: 'app-teal' },
  unknown: { label: '확인할 조건 있음', order: 1, color: 'app-yellow' },
  unfiltered: { label: '3D 임장 가능', order: 2, color: 'app-teal' },
  'no-match': { label: '선택한 조건과 다름', order: 3, color: 'warm-peach-pink' },
} as const;
const checkLabels = { match: '충족', 'no-match': '불충족', unknown: '미확인' };
const number = new Intl.NumberFormat('ko-KR');
const areaNumber = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });
const district = { opo: '경기 광주', songpa: '서울 송파', 'jamsil-leel': '서울 잠실' };
const addressAliases = { opo: '경기도 광주시', songpa: '서울특별시 송파구', 'jamsil-leel': '서울특별시 송파구' };
const complexFacts: Record<RegionId, ComplexFacts> = {
  ...snapshot.complexes,
  'jamsil-leel': { code: '', households: jamsilLeel.households, parkingSpaces: null, corridorType: null, playground: null, evCharging: null },
};
const transactionHistory: Partial<Record<RegionId, Transaction[]>> = transactions.complexes;
const featureOptions = preferences.map(({ id, label }) => ({ value: id, label }));

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

function Icon({ kind }: { kind: 'home' | 'compass' | 'search' | 'arrow' }) {
  const paths = {
    home: 'M3 10.5 12 3l9 7.5M5.5 9v11h13V9M10 20v-6h4v6',
    compass: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18Zm3.8 5.2-2.1 5.5-5.5 2.1 2.1-5.5 5.5-2.1Z',
    search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13Zm4.7 11.2L20 20',
    arrow: 'M5 12h14m-6-6 6 6-6 6',
  };
  return <svg className="planner-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d={paths[kind]} /></svg>;
}

function Postcard({ region }: { region: RegionId }) {
  const name = regions.find(entry => entry.id === region)?.name;
  return <figure className="planner-postcard">
    <IslandImage className="planner-postcard-image" variant="stamp" color="default"
      width="100%" preview={false} lazy src={`/datasets/regions/${region}/postcard.svg`}
      alt={`${name}의 실제 동 배치와 주변 길을 바탕으로 그린 입체 지도`} />
  </figure>;
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <div className="planner-field"><label htmlFor={id}>{label}</label>{children}</div>;
}

export default function TourPlanner({ mode, onMode, onEnter }: {
  mode: TourMode; onMode: (mode: TourMode) => void; onEnter: (region: RegionId) => void;
}) {
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [tenure, setTenure] = useState<Tenure>('sale');
  const [budget, setBudget] = useState('');
  const [monthly, setMonthly] = useState('');
  const [features, setFeatures] = useState<PreferenceId[]>([]);
  const [criteria, setCriteria] = useState<Criteria>(initial);
  const [selected, setSelected] = useState<RegionId | null>(null);
  const [budgetOnly, setBudgetOnly] = useState(false);
  const [priceDrafts, setPriceDrafts] = useState<Partial<Record<RegionId, string>>>({});
  const [prices, setPrices] = useState<Partial<Record<RegionId, number | null>>>({});
  const [priceErrors, setPriceErrors] = useState<Partial<Record<RegionId, boolean>>>({});
  const [budgetError, setBudgetError] = useState(false);
  const [monthlyError, setMonthlyError] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const results = useRef<HTMLElement>(null);

  const terms = appliedQuery.trim().split(/\s+/).filter(Boolean).map(compact);
  const hasBudget = criteria.maxPrice !== null || criteria.maxMonthly !== null;
  const rows = regions.filter(region => {
    const searchable = compact(`${region.name} ${region.area} ${region.keywords} ${addressAliases[region.id]}`);
    return terms.every(term => searchable.includes(term));
  }).map(region => {
    const facts = complexFacts[region.id];
    const price = prices[region.id] ?? null;
    const result = evaluateTour(facts, criteria, price === null ? null : { amount: price, kind: 'entered-listing' });
    const history = summarizeTransactions(transactionHistory[region.id] ?? [], criteria);
    return { region, facts, price, history, ...result };
  }).filter(row => !(budgetOnly && hasBudget) || row.history.withinBudget.length > 0)
    .sort((left, right) => states[left.status].order - states[right.status].order
    || Number(right.history.withinBudget.length > 0) - Number(left.history.withinBudget.length > 0));
  const selectedRow = rows.find(row => row.region.id === selected) ?? rows[0];
  const explored = regions.find(region => region.id === selected) ?? regions[0];

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
    results.current?.focus({ preventScroll: true });
    results.current?.scrollIntoView({ block: 'start' });
  }

  function chooseExplore() {
    onMode('explore');
    content.current?.scrollIntoView({ block: 'start' });
    content.current?.focus({ preventScroll: true });
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
    <header className="planner-header">
      <a className="planner-mark" href="/"><span><Icon kind="home" /></span> Find My Shelter</a>
      <nav className="planner-modes" aria-label="임장 방식">
        <Button size="small" className="planner-tab" aria-pressed={mode === 'match'} onClick={() => onMode('match')}>아파트 찾기</Button>
        <Button size="small" className="planner-tab" aria-pressed={mode === 'explore'} onClick={() => onMode('explore')}>자유 3D 탐험</Button>
      </nav>
    </header>

    <section className="planner-welcome" aria-labelledby="planner-title">
      <div className="planner-intro">
        <p className="planner-kicker"><Icon kind="compass" /> 우리 동네 임장 지도</p>
        <h1 id="planner-title">다음에 살 동네, <em>먼저 걸어봐요.</em></h1>
        <p className="planner-lede">예산에 맞는 단지를 지도에서 고르고, 마음에 드는 동네로 떠나보세요.</p>
      </div>
      <Button type="primary" className="planner-village-button" icon={<Icon kind="compass" />} onClick={chooseExplore}>3D 마을 탐험</Button>
    </section>

    <div id="planner-entry" className="planner-entry" ref={content} tabIndex={-1} />
    {mode === 'explore' ? <section id="explore-neighborhoods" className="planner-candidates" aria-labelledby="planner-explore-title">
      <div className="planner-section-heading">
        <p className="planner-kicker">자유 탐험</p>
        <h2 id="planner-explore-title">어느 동네를 걸어볼까요?</h2>
        <p>조건 설정 없이 바로 입장해 걷기, 드라이브, 조감을 즐겨보세요.</p>
      </div>
      <div className="planner-map-layout">
        <VillageMap villages={regions.map(region => ({ ...region, district: district[region.id] }))}
          selected={explored.id} onSelect={setSelected} />
        <aside id="village-details" className="planner-field-notes" aria-label="선택한 동네">
          <p className="planner-kicker">동네 수첩 · {district[explored.id]}</p>
          <h3>{explored.name}</h3><p className="planner-address">{explored.area}</p>
          <Postcard region={explored.id} />
          <Button className="planner-enter" icon={<Icon kind="compass" />} onClick={() => onEnter(explored.id)}
            aria-label={`${explored.name} 자유 3D 탐험 시작`}>자유 탐험 시작</Button>
        </aside>
      </div>
    </section> : <>
      <Card className="planner-search-card">
        <form id="tour-criteria" className="planner-form" onSubmit={apply} noValidate>
          <div className="planner-section-heading"><h2>어떤 집을 찾고 있나요?</h2></div>
          <div className="planner-fields">
            <Field id="planner-area" label="지역 또는 단지명">
              <Input id="planner-area" className="planner-input" prefix={<Icon kind="search" />} value={query}
                onChange={event => setQuery(event.target.value)} autoComplete="off" allowClear clearAriaLabel="지역 검색어 지우기"
                placeholder="예: 송파, 능평동, 롯데캐슬" />
            </Field>
            <Field id="planner-tenure" label="거래 유형">
              <select id="planner-tenure" value={tenure} onChange={event => {
                setTenure(event.target.value as Tenure); setBudget(''); setMonthly(''); setBudgetError(false); setMonthlyError(false);
              }}>{Object.entries(tenures).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
            </Field>
            <Field id="planner-budget" label={tenure === 'sale' ? '최대 매매 예산' : '최대 보증금'}>
              <Input id="planner-budget" className="planner-input" inputMode="numeric" value={budget}
                status={budgetError ? 'error' : undefined} aria-describedby="planner-budget-help" suffix="만원"
                onChange={event => { setBudget(event.target.value); setBudgetError(false); }}
                placeholder={tenure === 'sale' ? '예: 60,000' : '예: 38,000'} />
              <small id="planner-budget-help">{budgetError ? '만원 단위의 양의 정수를 입력해 주세요.' : '거래 부대비용 별도'}</small>
            </Field>
            {tenure === 'monthly' && <Field id="planner-monthly" label="최대 월세">
              <Input id="planner-monthly" className="planner-input" inputMode="numeric" value={monthly}
                status={monthlyError ? 'error' : undefined} aria-describedby="planner-monthly-help" suffix="만원"
                placeholder="예: 120" onChange={event => { setMonthly(event.target.value); setMonthlyError(false); }} />
              <small id="planner-monthly-help">{monthlyError ? '만원 단위의 양의 정수를 입력해 주세요.' : '월 납부액'}</small>
            </Field>}
          </div>
          <div className="planner-form-bottom">
            <fieldset><legend>생활 조건</legend>
              <Checkbox className="planner-feature-checkboxes" options={featureOptions} value={features}
                onChange={values => setFeatures(values as PreferenceId[])} />
            </fieldset>
            <Button className="planner-search-button" htmlType="submit" type="primary" icon={<Icon kind="search" />}>아파트 찾기</Button>
          </div>
        </form>
      </Card>

      <section id="tour-candidates" className="planner-candidates" ref={results} tabIndex={-1} aria-labelledby="tour-candidates-title">
        <div className="planner-section-heading planner-results-heading">
          <div><p className="planner-kicker">동네 후보</p><h2 id="tour-candidates-title">지도에서 단지 고르기</h2></div>
          <Tag className="planner-result-count" color="app-teal" variant="soft"><span role="status">
            {appliedQuery && `${appliedQuery} · `}{rows.length}개 단지 · {tenures[criteria.tenure]}
            {criteria.maxPrice !== null ? ` · ${criteria.tenure === 'sale' ? '매매 예산' : '보증금'} ${won(criteria.maxPrice)}` : ''}
            {criteria.maxMonthly !== null ? ` · 월세 ${won(criteria.maxMonthly)}` : ''}
          </span></Tag>
        </div>
        {hasBudget && <Checkbox className="planner-budget-toggle"
          options={[{ value: 'historical', label: '예산 이내 과거 실거래가 있는 단지만 보기' }]}
          value={budgetOnly ? ['historical'] : []} onChange={values => setBudgetOnly(values.length > 0)} />}
        {!selectedRow ? <NoData className="planner-empty" variant="search" bordered title="임장 가능한 단지를 찾지 못했어요."
          description={budgetOnly && hasBudget
            ? '입력한 예산 범위의 과거 계약 기록이 없어요. 과거 거래 필터를 해제해 다른 후보를 둘러보세요.'
            : '현재 오포와 송파를 지원해요. 지역명이나 단지명으로 다시 찾아보세요.'}
          extra={<Button onClick={() => { setQuery(''); setAppliedQuery(''); setBudgetOnly(false); }}>모든 단지 보기</Button>} />
          : <div className="planner-map-layout">
            <VillageMap villages={rows.map(row => ({ id: row.region.id, name: row.region.name,
              district: district[row.region.id],
              note: row.history.withinBudget.length ? `예산 이내 과거 거래 ${row.history.withinBudget.length}건` : states[row.status].label,
            }))} selected={selectedRow.region.id} onSelect={setSelected} />
            {(() => {
            const { region, facts, price, status, checks, history } = selectedRow;
            const parking = parkingRatio(facts);
            const latest = history.records[0];
            return <aside id="village-details" className="planner-field-notes" key={region.id} aria-label="선택한 단지">
                  <div className="planner-card-tags"><span>{district[region.id]}</span>
                    <Tag className={`planner-status status-${status}`} size="small" variant="soft" color={states[status].color}>{states[status].label}</Tag>
                  </div>
                  <h3>{region.name}</h3><p className="planner-address">{region.area}</p>
                  <Postcard region={region.id} />
                  <div className="planner-price">
                    <span>{latest ? `최근 ${tenures[criteria.tenure]} 실거래` : `과거 ${tenures[criteria.tenure]} 실거래`}</span>
                    <strong>{latest ? transactionPrice(latest) : '조회 기간 내 기록 없음'}</strong>
                    {latest && <small>{latest.date} · 전용 {areaNumber.format(latest.area)}㎡ · 현재 매물 아님</small>}
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
                  <Button className="planner-enter" icon={<Icon kind="compass" />} onClick={() => onEnter(region.id)}
                    aria-label={`${region.name} 3D 임장 시작`}>3D 임장 시작 <span aria-hidden="true">↗</span></Button>
                  {(history.records.length > 0 || criteria.tenure === 'sale') && <details className="planner-detail">
                    <summary>실거래 내역과 현재 매물가</summary>
                    {history.records.length > 0 && <ul className="planner-transaction-list">{history.records.map((record, index) =>
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
                  </details>}
            </aside>;
          })()}</div>}
      </section>
    </>}
    <footer className="planner-footer">
      <div><strong>Find My Shelter</strong><a href="/licenses/">오픈소스 라이선스</a></div>
      <p><a href="https://www.data.go.kr/data/15073271/fileData.do" target="_blank" rel="noreferrer">K-apt</a> {snapshot.snapshotDate} 기준 ·
        {' '}<a href="https://rt.molit.go.kr/pt/xls/xls.do" target="_blank" rel="noreferrer">국토교통부 실거래</a> {transactions.startDate}~{transactions.endDate}
        {' '}· <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></p>
    </footer>
  </main>;
}
