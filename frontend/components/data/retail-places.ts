import coverage from './retail-coverage.generated.json';
import type { FeatureCollection, Point } from 'geojson';
import type { RegionId } from './regions';

const retailCategories = ['supermarket', 'mall', 'department_store', 'marketplace', 'large_retail'] as const;
type RetailCategory = typeof retailCategories[number];
export const retailCategoryLabels: Record<RetailCategory, string> = {
  supermarket: '대형마트', mall: '쇼핑몰·센터', department_store: '백화점', marketplace: '시장', large_retail: '기타 대규모점포',
};
export const retailPermitSource = 'https://www.data.go.kr/data/15045013/fileData.do';

export function isLargeRetail(category: string): category is RetailCategory {
  return Object.hasOwn(retailCategoryLabels, category);
}

export function matchesPlaceCategory(category: string, filter: string) {
  return filter === 'all' || (filter === 'retail' ? isLargeRetail(category) : category === filter);
}

type RetailFile = FeatureCollection<Point, {
  id: string; name: string; category: RetailCategory | 'convenience' | 'beauty';
  source: 'permit' | 'osm'; source_date: string | null; business_type: string | null;
  building_id: string | null;
}> & { metadata: { building_version: string; permit_snapshot: string; permit_radius_m: number } };

export async function loadRetailPlaces(region: RegionId, signal: AbortSignal): Promise<RetailFile | null> {
  const path = (coverage as Partial<Record<RegionId, string>>)[region];
  if (!path) return null;
  try {
    const response = await fetch(path, { signal });
    if (!response.ok) return null;
    return await response.json() as RetailFile;
  } catch (error) {
    if (signal.aborted) throw error;
    return null;
  }
}
