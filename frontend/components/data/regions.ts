import jamsilLeel from './jamsil-leel.json';
import seoulScenes from './seoul-scenes.generated.json';

export { jamsilLeel };

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

export const seoulBiotopeSource = 'https://data.seoul.go.kr/dataList/OA-21145/S/1/datasetView.do';

// Small searchable catalog only. Heavy regional assets are fetched after entry.
// New regions use the same building manifest + terrain/environment contract.
const originalRegions = [
  { id: 'opo', name: '오포 롯데캐슬 포레스트', area: '경기 광주시 수레실길 7',
    keywords: '오포 광주 롯데캐슬 능평동', description: '산자락과 단지 사이를 걷는 동네',
    count: 214, radius: 350, terrain: '/opo-terrain.json', environment: '/opo-environment.geojson',
    places: '/opo-pois.geojson', site: '/opo-site.geojson', surrounding: '/opo-osm-buildings.geojson', streets: '/opo-streets.json',
    roadMarkings: null, neighborhoodTerrain: null, pavement: null, planting: null, servicePaving: null, pedestrianSignals: null },
  { id: 'songpa', name: songpaComplex.name, area: songpaComplex.address,
    keywords: '서울 송파 가락동 송파동 석촌중학교 동부센트레빌', description: '가락동부센트레빌과 주변 생활권',
    count: 752, radius: 600, terrain: '/datasets/regions/songpa/terrain.json',
    environment: '/datasets/regions/songpa/environment.geojson', places: '/datasets/regions/songpa/places.geojson',
    site: '/datasets/regions/songpa/site.geojson', surrounding: null, streets: '/datasets/regions/songpa/streets.json',
    roadMarkings: '/datasets/regions/songpa/road-markings.json', neighborhoodTerrain: '/datasets/regions/songpa/neighborhood-terrain.json',
    pavement: '/datasets/regions/songpa/pavement.json', planting: '/datasets/regions/songpa/neighborhood-planting.json',
    servicePaving: '/datasets/regions/songpa/service-paving.json',
    pedestrianSignals: '/datasets/regions/songpa/pedestrian-signals.json' },
  { id: 'jamsil-leel', name: jamsilLeel.name, area: jamsilLeel.address,
    keywords: '서울 송파구 신천동 잠실 미성크로바 르엘 롯데캐슬', description: '잠실 르엘 13개 동과 석촌호수·올림픽로 주변',
    count: 895, radius: 800, terrain: '/datasets/regions/jamsil-leel/terrain.json',
    environment: '/datasets/regions/jamsil-leel/environment.geojson', places: '/datasets/regions/jamsil-leel/places.geojson',
    site: '/datasets/regions/jamsil-leel/site.geojson', surrounding: null, streets: '/datasets/regions/jamsil-leel/streets.json',
    roadMarkings: '/datasets/regions/jamsil-leel/road-markings.json', neighborhoodTerrain: null,
    pavement: '/datasets/regions/jamsil-leel/pavement.json',
    planting: null, servicePaving: null, pedestrianSignals: '/datasets/regions/jamsil-leel/pedestrian-signals.json' },
] as const;

type SeoulSceneId = `seoul-a${string}`;
type SeoulScene = {
  id: string; name: string; area: string; roadName: string; households: number; towerCount: number;
  kaptCode: string; count: number; radius: number; roadside: number[]; lookAt: number[];
  towers: Record<string, string>; outlineSource: string; registerSource: string; layers: string[]; neighborhood?: string;
};
const catalogRegions = (seoulScenes as SeoulScene[]).map(scene => {
  const id = scene.id as SeoulSceneId;
  const path = `/datasets/regions/${id}`;
  const context = scene.neighborhood ? `/datasets/neighborhoods/${scene.neighborhood}` : path;
  const optional = (file: string) => scene.layers.includes(file) ? `${path}/${file}` : null;
  return {
    id, name: scene.name, area: scene.area, count: scene.count, radius: scene.radius,
    description: `${scene.towerCount}개 동과 주변 도로·생활환경`, keywords: `${scene.roadName} ${scene.kaptCode}`,
    terrain: `${path}/terrain.json`, environment: `${context}/environment.geojson`, places: `${context}/places.geojson`,
    site: `${path}/site.geojson`, streets: `${context}/streets.json`, surrounding: null,
    roadMarkings: optional('road-markings.json'), neighborhoodTerrain: null, pavement: optional('pavement.json'),
    planting: null, servicePaving: null, pedestrianSignals: optional('pedestrian-signals.json'),
  } as const;
});

export const regions = [...originalRegions, ...catalogRegions];
export type RegionId = typeof regions[number]['id'];
export function catalogScene(region: RegionId): SeoulScene | undefined {
  return (seoulScenes as SeoulScene[]).find(scene => scene.id === region);
}
