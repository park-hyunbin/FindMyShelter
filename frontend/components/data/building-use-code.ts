// AL_D198 A26/A27 and the national building-register detailed use codes.
const APARTMENT_USE_CODE = '02001';

type SourceUse = {
  bd_code_type?: string | null;
  use?: string | null;
  building?: string | null;
};

export function buildingUseCode(properties: SourceUse, legacyCode?: string | null, originalKind?: string | null) {
  const code = properties.bd_code_type === undefined ? legacyCode : properties.bd_code_type;
  if (code !== undefined) return typeof code === 'string' ? code.trim() || null : null;

  // Map older exports only when the data explicitly identifies an apartment.
  const use = originalKind === undefined ? properties.use ?? properties.building : originalKind;
  return use === '아파트' || use === 'apartments' ? APARTMENT_USE_CODE : null;
}

export type BuildingFacadeKind = 'apartment' | 'villa' | 'detached' | 'residential' | 'commercial' | 'shop' | 'unknown';

// Detailed codes matched against A26 (code) and A27 (official label) in AL_D198_11710.
const kindsByCode: ReadonlyMap<string, BuildingFacadeKind> = new Map([
  [APARTMENT_USE_CODE, 'apartment'],
  ['02002', 'villa'], ['02003', 'villa'],
  ['01001', 'detached'], ['01000', 'residential'], ['01003', 'residential'],
  ['03001', 'shop'], ['03002', 'shop'], ['04001', 'shop'], ['07201', 'shop'],
  ['07001', 'shop'], ['07101', 'shop'], ['07999', 'shop'],
  ['04401', 'commercial'], ['04402', 'commercial'], ['04403', 'commercial'], ['04499', 'commercial'],
  ['14000', 'commercial'], ['14204', 'commercial'], ['14299', 'commercial'],
]);

// Older municipal and OSM exports have explicit type labels but no standardized code.
const kindsByUse: ReadonlyMap<string, BuildingFacadeKind> = new Map([
  ['연립주택', 'villa'], ['다세대주택', 'villa'], ['빌라', 'villa'], ['terrace', 'villa'],
  ['단독주택', 'detached'], ['detached', 'detached'],
  ['일반주택', 'residential'], ['다가구주택', 'residential'], ['house', 'residential'], ['residential', 'residential'],
  ['소매점', 'shop'], ['상점', 'shop'], ['일반음식점', 'shop'], ['휴게음식점', 'shop'], ['retail', 'shop'],
  ['도매시장', 'shop'], ['시장', 'shop'], ['판매시설', 'shop'], ['기타판매시설', 'shop'],
  ['사무소', 'commercial'], ['업무시설', 'commercial'], ['commercial', 'commercial'], ['office', 'commercial'],
]);

export function buildingFacadeKind(code: string | null, category: string): BuildingFacadeKind {
  const kind = code === null ? kindsByUse.get(category.trim().toLowerCase()) : kindsByCode.get(code);
  return kind ?? 'unknown';
}

const retailUseByCode: Readonly<Record<string, string>> = {
  '02001': '아파트', '02000': '공동주택',
  '03000': '제1종 근린생활시설', '04000': '제2종 근린생활시설',
  '03001': '소매점', '07001': '도매시장', '07101': '시장', '07201': '상점', '07999': '기타 판매시설',
};

export function retailBuildingUse(code: string | null, use: string) {
  return code ? retailUseByCode[code] ?? (use || null) : use || null;
}
