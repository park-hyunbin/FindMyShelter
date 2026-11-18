import { songpaComplex } from './regions';
import { songpaCourtyard, songpaFacilities } from './songpa-grounds';
import { songpaEntrance } from './songpa-entrance';
import { ambientSources } from './songpa-ambient';
import { floodSource } from './songpa-flood';
import { songpaSchool } from './songpa-school';
import { songpaHospital } from './visit-routes';
import { songiPark } from './songi-park';
import { songpaWinterCapture } from './songpa-winter-capture';
import { songpaArchitecture } from './songpa-architecture';
import { songpaRouteElevation } from './songpa-route-elevation';

type Source = { label: string; url: string };
export type ChecklistView = 'complex' | 'sun' | 'winter-walk' | 'winter-capture' | 'horizon' | 'school' | 'places' | 'station-route' | 'park-route' | 'school-route' | 'hospital-route' | 'paving' | 'parking' | 'entrance' | 'ambient' | 'flood';
type Evidence = 'model' | 'document' | 'visit';

type Check = {
  id: string;
  title: string;
  evidence: Evidence;
  finding: string;
  followUp?: string;
  views?: { target: ChecklistView; label: string }[];
  sources?: Source[];
};

const seoulComplex = { label: '서울시 공동주택 단지 정보', url: songpaComplex.info };
const siteBoundary = { label: 'OpenStreetMap 단지 경계', url: songpaComplex.boundary };
const walkingNetwork = { label: '서울시 보행 네트워크 자료', url: 'https://data.seoul.go.kr/dataList/OA-21208/A/1/datasetView.do' };
const terrainGrade = { label: '서울 안전누리 경사도 지도', url: 'https://safecity.seoul.go.kr/distFclt/cfMapDs/cfMapDs.page?menuId=MENU_SSNS_000013' };
const hospitalEntrances = { label: '서울시 보행자 출입구 조사', url: songpaHospital.source };

export const evidenceLabels: Record<Evidence, string> = {
  model: '3D 모델·지도',
  document: '공개 자료',
  visit: '현장 확인 필요',
};

export const songpaChecklist: readonly { title: string; checks: readonly Check[] }[] = [
  {
    title: '단지와 일조',
    checks: [
      {
        id: 'layout', title: '단지와 주변 배치', evidence: 'model',
        finding: '공개 지도와 대조한 101~105동의 위치를 조감으로 보고, 지상 사진을 참고한 외벽과 원형 지붕을 동 사이에서 살펴볼 수 있어요.',
        followUp: '동별 출입구와 집 앞에서 보이는 실제 방향을 확인해 보세요.',
        views: [{ target: 'complex', label: '단지 전체 조감으로 보기' }],
        sources: [seoulComplex, { label: '주동 배치 참고 지도', url: songpaArchitecture.layout }],
      },
      {
        id: 'sunlight', title: '실외 일조와 시야', evidence: 'model',
        finding: '단지 안 실외 점의 직사광·그늘을 날짜와 시간별로 비교해요. 차폐 건물과 지형을 찾고 원하는 방향의 눈높이에서 시야를 살펴볼 수 있어요.',
        followUp: '겨울 촬영 영상으로 두 지점의 밝기 차이를 비교할 수 있어요. 겨울 오후의 그늘 경계와 수목 영향을 확인하려면 같은 장소와 시각의 지상 관찰이 필요해요.',
        views: [{ target: 'winter-walk', label: '겨울 오후 산책 비교' }, { target: 'sun', label: '일조 지도 열기' }, { target: 'winter-capture', label: '겨울 위성영상과 비교' },
          { target: 'horizon', label: '방향별 시야 보기' }],
        sources: [{ label: 'Sentinel-2 겨울 촬영 원본', url: songpaWinterCapture.source }],
      },
      {
        id: 'facilities', title: '정문·놀이터·공용시설', evidence: 'model',
        finding: '정문 횡단부를 살펴보고, 103·104동 사이 산책로와 등록된 놀이터 주변을 눈높이에서 둘러볼 수 있어요.',
        followUp: '놀이기구의 상태와 정문에서 단지 안으로 이어지는 보행로의 단차를 현장에서 확인해 보세요.',
        views: [{ target: 'entrance', label: '정문과 주차장 입구 보기' }, { target: 'paving', label: '산책로와 놀이터 보기' }],
        sources: [{ label: '정문 로드뷰', url: songpaEntrance.main.roadview }, { label: '단지 안 보행로 사진', url: songpaCourtyard.groundPhoto },
          { label: '행정안전부 놀이시설 현황', url: songpaFacilities.playground }],
      },
    ],
  },
  {
    title: '평소 오가는 길',
    checks: [
      {
        id: 'transit', title: '역·정류장까지 걷기', evidence: 'model',
        finding: '단지 앞 교차점에서 송파역 2번 출구 인근까지 지도에 이어진 길과 횡단 구간을 볼 수 있어요. 단지 출입구 연결, 출구까지 마지막 구간과 버스정류장 경로는 현장 확인이 필요해요.',
        views: [{ target: 'station-route', label: '송파역 방향 경로 보기' }],
        followUp: '출근할 시간에 횡단보도, 신호 대기, 계단과 실제 걸린 시간을 기록해 보세요.',
        sources: [walkingNetwork],
      },
      {
        id: 'slope', title: '언덕길과 귀갓길', evidence: 'model',
        finding: '서울시 수치지형도로 송이공원·송파역·서울신가초 방향의 누적 오르막과 왕복에서 가장 가파른 30m 구간을 볼 수 있어요.',
        followUp: '귀갓길의 가장 가파른 구간은 실제 보도나 경사로에서 확인해 보세요.',
        views: [{ target: 'park-route', label: '송이공원 방향 경로 단면' }, { target: 'horizon', label: '지점별 지형 단면 열기' }],
        sources: [{ label: '서울시 등고선·표고점', url: songpaRouteElevation.source }, terrainGrade],
      },
      {
        id: 'alternatives', title: '완만한 길·계단 우회', evidence: 'model',
        finding: '송파역과 송이공원 방향에서 같은 종점까지 가는 두 경로를 비교할 수 있어요. 거리, 보도 미확인 구간, 가고 돌아올 때의 오르막을 함께 살펴보세요.',
        views: [{ target: 'station-route', label: '송파역 두 경로 비교' }, { target: 'park-route', label: '송이공원 두 경로 비교' }],
        followUp: '지도에 계단 태그가 없는 구간도 실제 계단·턱·출입 가능 여부는 현장에서 확인해 보세요.',
        sources: [walkingNetwork, { label: '서울시 등고선·표고점', url: songpaRouteElevation.source }],
      },
      {
        id: 'accessibility', title: '유모차·휠체어 동선', evidence: 'document',
        finding: '2022년 서울시 조사에서 뉴스타트병원 보조출입구 한 곳에 경사로 설치가 기록돼 있어요. 병원 방향 도로의 대부분은 지도에서 보도 여부를 확인하기 어려워요.',
        followUp: '이용할 동 출입구부터 목적지까지 보도 유효폭과 턱, 횡경사, 경사로 개방 여부를 확인해 보세요.',
        views: [{ target: 'hospital-route', label: '병원 방향과 조사 출입구 보기' }], sources: [hospitalEntrances],
      },
      {
        id: 'school', title: '통학·통원', evidence: 'document',
        finding: '공식 학구도에서 단지 전체가 서울신가초 통학구역에 들어가요. 송이로 횡단보도와 뉴스타트병원 보조출입구 조사 위치를 3D에서 볼 수 있어요.',
        followUp: '등교 시간 신호 대기와 교문까지의 보도 연결, 병원 출입구까지 실제 이어지는 길을 확인해 보세요.',
        views: [{ target: 'school', label: '공식 통학구역 보기' }, { target: 'school-route', label: '통학 방향 경로 보기' },
          { target: 'hospital-route', label: '병원 방향 보기' }],
        sources: [{ label: '한국교육시설안전원 통학구역 원본', url: songpaSchool.zoneSource }, hospitalEntrances],
      },
      {
        id: 'services', title: '장보기·병원·공원', evidence: 'model',
        finding: '송이공원 남쪽 진입부까지의 길을 보고, 공원 안 산책로와 솔숲을 눈높이에서 살펴볼 수 있어요. 주변 상점은 생활시설 지도에서 찾아요.',
        followUp: '공원의 현재 개방 여부와 계단·턱, 자주 이용할 시설의 운영 시간을 확인해 보세요.',
        views: [{ target: 'park-route', label: '송이공원 진입부와 산책로 보기' }, { target: 'places', label: '생활시설 지도 열기' }],
        sources: [{ label: '송파구의 송이공원 소개', url: songiPark.parkSource }, { label: '공원 항공영상 촬영 정보', url: songiPark.aerialMetadata }],
      },
    ],
  },
  {
    title: '생활 조건과 현장 메모',
    checks: [
      {
        id: 'parking', title: '주차와 관리', evidence: 'document',
        finding: 'K-apt의 지상·지하 주차면과 승강기 수를 확인하고, 102동 옆 주차장 덮개를 길에서 볼 수 있어요.',
        followUp: '저녁 빈자리, 방문차량 이용, 청소와 조경 상태를 살펴보세요. 관리비를 비교할 때는 기준월과 면적을 맞춰 보세요.',
        views: [{ target: 'parking', label: '주차·승강기 공시 보기' }, { target: 'entrance', label: '주차장 입구 보기' }],
        sources: [seoulComplex, { label: 'K-apt 관리시설정보', url: songpaFacilities.management },
          { label: '송파구 지하주차장 입구 위치 기록', url: songpaEntrance.record }],
      },
      {
        id: 'noise', title: '소음·야간 환경', evidence: 'document',
        finding: '대로 옆과 단지 안쪽을 같은 시각으로 둘러보고, 주변 서울시 센서의 소음·조도 기록을 확인할 수 있어요.',
        followUp: '대로 쪽과 안쪽에서 평일 밤·주말 소음, 조명, 냄새를 확인해 보세요.',
        views: [{ target: 'ambient', label: '소음·야간 환경 둘러보기' }],
        sources: [
          { label: '서울시 S-DoT 센서 기록', url: ambientSources.readings },
          { label: 'OpenStreetMap 양재대로', url: ambientSources.road },
        ],
      },
      {
        id: 'drainage', title: '물길·침수·배수', evidence: 'document',
        finding: '서울시 공개 침수흔적과 단지 경계를 대조하고, 주변 연못과 하천의 위치를 지도에서 볼 수 있어요.',
        followUp: '비가 그친 뒤 물이 모인 곳, 빗물받이와 지하주차장 차수 시설을 확인해 보세요.',
        views: [{ target: 'flood', label: '침수 기록과 물길 보기' }],
        sources: [{ label: '서울시 침수흔적도 원본', url: floodSource }],
      },
      {
        id: 'interior', title: '세대 내부', evidence: 'visit',
        finding: '세대 내부 상태는 방문해서 확인할 항목이에요. 이 화면은 주변 건물과 실외 일조를 보여줘요.',
        followUp: '창 방향과 실제 채광, 창호, 결로·누수, 수압, 층간소음을 확인해 보세요.',
      },
      {
        id: 'visit-plan', title: '방문 장소·시간 정하기', evidence: 'visit',
        finding: '온라인에서 확인한 것과 현장에서 다시 볼 항목을 메모로 남겨 가져갈 수 있어요.',
        followUp: '예를 들어 겨울 오후 2시, 볕이 드는 길과 그늘진 자리를 직접 비교할 계획을 적어 보세요.',
      },
    ],
  },
];
