import type { Building } from '../opo-data';

export const buildingProfiles = {
  house:      { bayM: 2.8, floorM: 3.0, defaultM: 5.9, wall: '#d4c5b5', glass: '#708486', trim: '#a99a89', roof: '#74685d' },
  apartments: { bayM: 3.4, floorM: 3.05, defaultM: 10, wall: '#d5c4ac', glass: '#65757b', trim: '#a19a8d', roof: '#777875' },
  commercial: { bayM: 3.6, floorM: 3.6, defaultM: 6.4, wall: '#c5c1b6', glass: '#597780', trim: '#8f9d9c', roof: '#596d71' },
  civic:      { bayM: 4.1, floorM: 3.7, defaultM: 10, wall: '#ddcdb3', glass: '#60767b', trim: '#aaa298', roof: '#736b5a' },
  industrial: { bayM: 4.8, floorM: 4.5, defaultM: 6.4, wall: '#b8c3bd', glass: '#688089', trim: '#899994', roof: '#648285' },
  utility:    { bayM: 3.0, floorM: 3.1, defaultM: 3.1, wall: '#b6ada1', glass: '#777e78', trim: '#9b8f84', roof: '#7e776c' },
  unknown:    { bayM: 3.25, floorM: 3.1, defaultM: null, wall: '#d8d1ba', glass: '#63777a', trim: '#a9a18e', roof: '#70645a' },
} as const;

export type BuildingUse = keyof typeof buildingProfiles;

export function buildingUse(category: string): BuildingUse {
  const use = category.toLowerCase();
  if (/garage|shed|greenhouse|hut|주차장|온실/.test(use)) return 'utility';
  if (/industrial|warehouse|factory|공장|창고|축사/.test(use)) return 'industrial';
  if (/apartments|아파트|공동주택|다세대|연립주택/.test(use)) return 'apartments';
  if (/school|church|hospital|kindergarten|civic|public|학교|유치원|어린이집|교회|성당|병원|노유자/.test(use)) return 'civic';
  if (/commercial|office|retail|근린?생활|업무|사무소|소매|상점|의원|오피스텔|호텔|학원|음식점/.test(use)) return 'commercial';
  if (/house|residential|detached|주택/.test(use)) return 'house';
  return 'unknown';
}

export function buildingProfile({ category, dong, height, levels, roof }: Pick<Building, 'category' | 'dong' | 'height' | 'levels' | 'roof'>) {
  const use = dong ? 'apartments' : buildingUse(category);
  const profile = buildingProfiles[use];
  const sourceHeight = height && height > 0 ? height : null;
  const displayHeight = sourceHeight ?? (levels && levels > 0 ? Math.min(65, levels * profile.floorM) : profile.defaultM);
  return {
    use, profile, sourceHeight, displayHeight,
    pitchedRoof: ['gabled', 'hipped', 'half-hipped'].includes(roof ?? ''),
  };
}
