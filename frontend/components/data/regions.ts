// Small searchable catalog only. Heavy regional assets are fetched after entry.
// New regions use the same building manifest + terrain/environment contract.
export const regions = [
  { id: 'opo', name: '오포 롯데캐슬 포레스트', area: '경기 광주시 수레실길 7',
    keywords: '오포 광주 롯데캐슬 능평동', description: '산자락과 단지 사이를 걷는 동네',
    count: 214, radius: 350, terrain: '/opo-terrain.json', environment: '/opo-environment.geojson',
    places: '/opo-pois.geojson', site: '/opo-site.geojson', surrounding: '/opo-osm-buildings.geojson', streets: '/opo-streets.json' },
  { id: 'songpa', name: '송파·가락동 임장구역', area: '서울 송파구 · 600m 데이터 표본',
    keywords: '서울 송파 가락동 송파동 석촌중학교', description: '도시의 길과 건물 사이를 탐험하는 동네',
    count: 752, radius: 600, terrain: '/datasets/regions/songpa/terrain.json',
    environment: '/datasets/regions/songpa/environment.geojson', places: '/datasets/regions/songpa/places.geojson',
    site: null, surrounding: null, streets: null },
] as const;
export type RegionId = typeof regions[number]['id'];
