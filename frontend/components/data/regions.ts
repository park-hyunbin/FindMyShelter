export const songpaComplex = {
  name: '가락동부센트레빌',
  address: '서울 송파구 송파대로32길 33',
  info: 'https://openapt.seoul.go.kr/openApt/index.do?aptCode=A13816002',
  boundary: 'https://www.openstreetmap.org/way/1079940834',
  road: 'https://www.openstreetmap.org/way/169916279',
  roadName: '송파대로32길',
  roadside: [127.117105, 37.497894],
  lookAt: [127.1167032, 37.497559],
  towers: [
    { id: '55765286', dong: '101동' },
    { id: '55765487', dong: '102동' },
    { id: '55765541', dong: '103동' },
    { id: '55765485', dong: '104동' },
    { id: '55765284', dong: '105동' },
  ],
};

// Small searchable catalog only. Heavy regional assets are fetched after entry.
// New regions use the same building manifest + terrain/environment contract.
export const regions = [
  { id: 'opo', name: '오포 롯데캐슬 포레스트', area: '경기 광주시 수레실길 7',
    keywords: '오포 광주 롯데캐슬 능평동', description: '산자락과 단지 사이를 걷는 동네',
    count: 214, radius: 350, terrain: '/opo-terrain.json', environment: '/opo-environment.geojson',
    places: '/opo-pois.geojson', site: '/opo-site.geojson', surrounding: '/opo-osm-buildings.geojson', streets: '/opo-streets.json',
    roadMarkings: null, neighborhoodTerrain: null },
  { id: 'songpa', name: songpaComplex.name, area: songpaComplex.address,
    keywords: '서울 송파 가락동 송파동 석촌중학교 동부센트레빌', description: '가락동부센트레빌과 주변 생활권',
    count: 752, radius: 600, terrain: '/datasets/regions/songpa/terrain.json',
    environment: '/datasets/regions/songpa/environment.geojson', places: '/datasets/regions/songpa/places.geojson',
    site: '/datasets/regions/songpa/site.geojson', surrounding: null, streets: '/datasets/regions/songpa/streets.json',
    roadMarkings: '/datasets/regions/songpa/road-markings.json', neighborhoodTerrain: '/datasets/regions/songpa/neighborhood-terrain.json' },
] as const;
export type RegionId = typeof regions[number]['id'];
