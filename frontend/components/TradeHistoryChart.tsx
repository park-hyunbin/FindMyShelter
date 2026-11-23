import { useId, useState } from 'react';
import type { Tenure, Transaction } from './data/tour-matching';

const areaFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });
const axisFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 4 });
const monthDay = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });

export default function TradeHistoryChart({ records, tenure, formatPrice }: {
  records: Transaction[];
  tenure: Tenure;
  formatPrice: (amount: number) => string;
}) {
  const areaFillId = useId();
  const [area, setArea] = useState(() => {
    const counts = new Map<number, number>();
    for (const record of records) counts.set(record.area, (counts.get(record.area) ?? 0) + 1);
    return [...counts].sort(([, a], [, b]) => b - a)[0][0];
  });
  const [metric, setMetric] = useState<'amount' | 'monthly'>('amount');
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const areas = [...new Set(records.map(record => record.area))].sort((a, b) => a - b);
  const valueLabel = metric === 'monthly' ? '월세' : tenure === 'sale' ? '거래가' : '보증금';
  const contracts = new Map<string, { date: string; time: number; value: number; count: number }>();

  for (const record of records) {
    const value = record[metric];
    const time = Date.parse(record.date);
    if (record.area !== area || value === null || !Number.isFinite(time)) continue;
    const key = `${record.date}-${value}`;
    const existing = contracts.get(key);
    if (existing) existing.count += 1;
    else contracts.set(key, { date: record.date, time, value, count: 1 });
  }

  const points = [...contracts.entries()].sort(([, a], [, b]) => a.time - b.time);
  const first = points.at(0)?.[1];
  const last = points.at(-1)?.[1];
  const values = points.map(([, point]) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const selectedKey = activeKey ?? contracts.keys().next().value;
  const active = selectedKey === undefined ? undefined : contracts.get(selectedKey);
  const ticks = min === max ? [max] : [max, (max + min) / 2, min];
  const axisUnit = max >= 10000 ? '억원' : '만원';
  const xFor = (time: number) => !first || !last || first.time === last.time ? 50
    : 3 + 94 * (time - first.time) / (last.time - first.time);
  const yFor = (value: number) => min === max ? 50 : 10 + 80 * (max - value) / (max - min);

  // Several contracts can share a date without a published order. Connect daily medians.
  const dailyPrices = new Map<number, number[]>();
  for (const [, point] of points) {
    const prices = dailyPrices.get(point.time) ?? [];
    for (let i = 0; i < point.count; i++) prices.push(point.value);
    dailyPrices.set(point.time, prices);
  }
  const daily = [...dailyPrices].map(([time, prices]) => {
    prices.sort((a, b) => a - b);
    const lower = prices[Math.floor((prices.length - 1) / 2)];
    const upper = prices[Math.floor(prices.length / 2)];
    return { time, value: (lower + upper) / 2 };
  });
  const areaPath = daily.length > 1
    ? `M ${xFor(daily[0].time)} 100 ${daily.map(({ time, value }) => `L ${xFor(time)} ${yFor(value)}`).join(' ')} L ${xFor(daily[daily.length - 1].time)} 100 Z`
    : null;
  const axisDate = (date: string) => first?.date.slice(0, 4) === last?.date.slice(0, 4) ? monthDay.format(Date.parse(date)) : date;

  return <section className="trade-chart" aria-label="실거래 그래프">
    <div className="trade-chart-controls">
      <div className="trade-chart-reading" aria-live="polite">
        <span>{valueLabel}</span>
        {active && <>
          <strong>{formatPrice(active.value)}</strong>
          <small><time dateTime={active.date}>{active.date}</time>{active.count > 1 && ` · 같은 금액 ${active.count}건`}</small>
        </>}
      </div>
      <div className="trade-chart-filters">
        <label>전용면적
          <select value={area} onChange={event => { setArea(Number(event.target.value)); setActiveKey(null); }}>
            {areas.map(value => <option value={value} key={value}>{areaFormat.format(value)}㎡</option>)}
          </select>
        </label>
        {tenure === 'monthly' && <label>금액
          <select value={metric} onChange={event => { setMetric(event.target.value === 'monthly' ? 'monthly' : 'amount'); setActiveKey(null); }}>
            <option value="amount">보증금</option><option value="monthly">월세</option>
          </select>
        </label>}
      </div>
    </div>
    {first && last ? <>
      <div className="trade-chart-grid">
        <div className="trade-chart-plot" role="group" aria-label={`전용 ${areaFormat.format(area)}㎡ ${valueLabel} 계약 기록`}>
          <svg className="trade-chart-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id={areaFillId} x2="0" y2="1">
                <stop offset="0" stopColor="currentColor" stopOpacity=".46" />
                <stop offset="1" stopColor="currentColor" stopOpacity=".04" />
              </linearGradient>
            </defs>
            {ticks.map(tick => <line className="trade-chart-gridline" key={tick}
              x1="0" x2="100" y1={yFor(tick)} y2={yFor(tick)} vectorEffect="non-scaling-stroke" />)}
            {areaPath && <path className="trade-chart-fill" d={areaPath} fill={`url(#${areaFillId})`} />}
            {active && <line className="trade-chart-guide" x1={xFor(active.time)} x2={xFor(active.time)}
              y1="0" y2="100" vectorEffect="non-scaling-stroke" />}
            {daily.slice(1).map((point, index) => {
              const previous = daily[index];
              const direction = point.value > previous.value ? 'up' : point.value < previous.value ? 'down' : 'flat';
              return <line key={point.time} data-direction={direction}
                x1={xFor(previous.time)} y1={yFor(previous.value)} x2={xFor(point.time)} y2={yFor(point.value)}
                vectorEffect="non-scaling-stroke" />;
            })}
          </svg>
          {points.map(([key, point]) => {
            const label = `${point.date} · ${formatPrice(point.value)}${point.count > 1 ? ` · ${point.count}건` : ''}`;
            return <button key={key} type="button" className="trade-chart-point" title={label} aria-label={label}
              aria-pressed={key === selectedKey} style={{ left: `${xFor(point.time)}%`, top: `${yFor(point.value)}%` }}
              onFocus={() => setActiveKey(key)} onClick={() => setActiveKey(key)} />;
          })}
        </div>
        <div className="trade-chart-axis" aria-hidden="true">
          {ticks.map(tick => <span key={tick} style={{ top: `${yFor(tick)}%` }}>
            {axisFormat.format(tick / (axisUnit === '억원' ? 10000 : 1))}
          </span>)}
        </div>
        <div className="trade-chart-dates" data-single={first.date === last.date || undefined}>
          <time dateTime={first.date} title={first.date}>{axisDate(first.date)}</time>
          {first.date !== last.date && <time dateTime={last.date} title={last.date}>{axisDate(last.date)}</time>}
        </div>
        <span className="trade-chart-unit">{axisUnit}</span>
      </div>
      {daily.length > 1 && <div className="trade-chart-legend">
        <span>일별 중앙값</span><span data-direction="up">상승</span>
        <span data-direction="down">하락</span><span data-direction="flat">보합</span>
      </div>}
    </> : <p className="trade-chart-caption">이 면적의 {valueLabel} 기록이 없어요.</p>}
  </section>;
}
