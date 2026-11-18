export const preferences = [
  { id: 'parking', label: '세대당 주차 2대 이상' },
  { id: 'ev', label: '전기차 충전시설' },
  { id: 'playground', label: '어린이놀이터' },
] as const;

export type PreferenceId = typeof preferences[number]['id'];
export const tenures = { sale: '매매', jeonse: '전세', monthly: '월세' } as const;
export type Tenure = keyof typeof tenures;
export type Criteria = { maxPrice: number | null; maxMonthly: number | null; tenure: Tenure; features: PreferenceId[] };
export type Transaction = { kind: string; date: string; area: number; amount: number; monthly: number | null };
export type ComplexFacts = {
  code: string;
  households: number | null;
  parkingSpaces: number | null;
  corridorType: string | null;
  playground: boolean | null;
  evCharging: boolean | null;
};
export type PriceEvidence = { amount: number; kind: 'entered-listing' };
type Condition = { label: string; result: 'match' | 'no-match' | 'unknown' };

export function readManwon(value: string) {
  const cleaned = value.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(cleaned)) return null;
  const number = Number(cleaned.replaceAll(',', ''));
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function parkingRatio(facts: ComplexFacts) {
  return facts.parkingSpaces == null || !facts.households ? null : facts.parkingSpaces / facts.households;
}

export function evaluateTour(facts: ComplexFacts, criteria: Criteria, price: PriceEvidence | null) {
  const ratio = parkingRatio(facts);
  const signals = { parking: ratio == null ? null : ratio >= 2, ev: facts.evCharging, playground: facts.playground };
  const checks: Condition[] = [];
  function add(label: string, value: boolean | null) {
    checks.push({ label, result: value === null ? 'unknown' : value ? 'match' : 'no-match' });
  }
  if (criteria.maxPrice !== null || (criteria.tenure === 'monthly' && criteria.maxMonthly !== null)) {
    add('현재 매물가가 예산 이내',
      criteria.tenure !== 'sale' || price === null || criteria.maxPrice === null ? null : price.amount <= criteria.maxPrice);
  }
  for (const preference of preferences) {
    if (criteria.features.includes(preference.id)) add(preference.label, signals[preference.id]);
  }
  const status = checks.some(check => check.result === 'no-match') ? 'no-match'
    : checks.some(check => check.result === 'unknown') ? 'unknown'
    : checks.length ? 'match' : 'unfiltered';
  return { checks, status };
}

export function summarizeTransactions(rows: Transaction[], criteria: Criteria) {
  const records = rows.filter(row => row.kind === criteria.tenure);
  const monthlyLimit = criteria.tenure === 'monthly' ? criteria.maxMonthly : null;
  const budgetApplied = criteria.maxPrice !== null || monthlyLimit !== null;
  const withinBudget = budgetApplied ? records.filter(row =>
    (criteria.maxPrice === null || row.amount <= criteria.maxPrice) &&
    (monthlyLimit === null || (row.monthly !== null && row.monthly <= monthlyLimit)),
  ) : [];
  return { records, withinBudget, budgetApplied };
}
