import { songpaComplex } from './regions';
import { garakGreenStrip, songpaCourtyard, songpaFacilities, songpaGrounds, songpaManagementFees, songpaPlayground } from './songpa-grounds';
import { songpaEntrance } from './songpa-entrance';
import { ambientSources } from './songpa-ambient';
import { floodForecast, floodSource } from './songpa-flood';
import { songpaSchool } from './songpa-school';
import { songpaBusStop, songpaHospital, songpaStationAccess } from './visit-routes';
import { songiPark } from './songi-park';
import { songpaWinterCaptures } from './songpa-winter-capture';
import { songpaArchitecture } from './songpa-architecture';
import { songpaRouteElevation } from './songpa-route-elevation';

type Source = { label: string; url: string };
export type ChecklistView = 'complex' | 'sun' | 'winter-walk' | 'winter-capture' | 'horizon' | 'school' | 'places'
  | 'station-home' | 'station-route' | 'station-access' | 'bus-route' | 'park-route' | 'park-profile' | 'park-entry' | 'station-profile' | 'school-profile'
  | 'school-route' | 'hospital-route'
  | 'paving' | 'parking' | 'entrance' | 'garage' | 'ambient' | 'flood' | 'facades';
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
        sources: [seoulComplex, siteBoundary, { label: '주동 배치 참고 지도', url: songpaArchitecture.layout }],
      },
      {
        id: 'sunlight', title: '실외 일조와 시야', evidence: 'model',
        finding: '단지 안 실외 점의 직사광·그늘을 날짜와 시간별로 비교해요. 차폐 건물과 지형을 찾고 원하는 방향의 눈높이에서 시야를 살펴볼 수 있어요.',
        followUp: '12월부터 2월까지의 겨울 오전 위성영상에서 같은 두 지점의 밝기를 비교할 수 있어요. 오후 그늘 경계와 수목 영향은 같은 장소와 시각의 지상 관찰이 필요해요.',
        views: [{ target: 'winter-walk', label: '겨울 오후 산책 비교' }, { target: 'sun', label: '일조 지도 열기' }, { target: 'winter-capture', label: '겨울 위성영상과 비교' },
          { target: 'horizon', label: '방향별 시야 보기' }],
        sources: songpaWinterCaptures.map(capture => ({ label: `Sentinel-2 ${capture.date} 촬영 원본`, url: capture.source })),
      },
      {
        id: 'facilities', title: '정문·놀이터·공용시설', evidence: 'model',
        finding: '정문 앞 횡단 표시와 차량 차단기, 103·104동 사이 산책로와 놀이터를 눈높이에서 둘러볼 수 있어요.',
        followUp: '정문 표시와 시설, 놀이터 기구 배치는 근사예요. 현재 차량 출입 조건과 보행로 단차, 놀이터 상태를 확인해 보세요.',
        views: [{ target: 'entrance', label: '정문 접근로 눈높이 보기' }, { target: 'paving', label: '산책로와 놀이터 지점 고르기' }],
        sources: [{ label: '정문 로드뷰', url: songpaEntrance.main.roadview }, { label: '2025-10-28 항공영상 촬영 정보', url: songpaGrounds.metadata },
          { label: '단지 안 보행로 사진', url: songpaCourtyard.groundPhoto },
          { label: '행정안전부 놀이시설 등록과 사진', url: songpaPlayground.source }],
      },
    ],
  },
  {
    title: '평소 오가는 길',
    checks: [
      {
        id: 'transit', title: '역·정류장까지 걷기', evidence: 'model',
        finding: '송파역 2번 출구에서 단지로 돌아오며 양재대로 교통섬과 가락광장 동쪽 녹지를 볼 수 있어요. 녹지 안 수목과 포장은 2025년 10월 항공영상을 참고했어요. 양재대로 남쪽 버스 정류소까지의 길도 확인할 수 있어요.',
        views: [{ target: 'station-home', label: '송파역에서 귀갓길 체험' }, { target: 'bus-route', label: '가락동부센트레빌아파트 정류소 보기' }],
        followUp: '보도에서 정문까지 남은 연결과 단차, 정류소 승차 방향, 출근 시간에 실제 걸린 시간을 확인해 보세요.',
        sources: [walkingNetwork, { label: '서울시 가락광장·완충녹지 도형', url: garakGreenStrip.source.planning },
          { label: '정문 방향 보도 로드뷰', url: songpaEntrance.frontage.roadview },
          { label: '서울시 버스정류소 위치정보', url: songpaBusStop.source }],
      },
      {
        id: 'slope', title: '언덕길과 귀갓길', evidence: 'model',
        finding: '서울시 수치지형도로 송이공원·송파역·서울신가초 방향의 누적 오르막과 왕복에서 가장 가파른 30m 구간을 볼 수 있어요.',
        followUp: '귀갓길의 가장 가파른 구간은 실제 보도나 경사로에서 확인해 보세요.',
        views: [{ target: 'park-profile', label: '송이공원 경로 단면' }, { target: 'station-profile', label: '송파역 경로 단면' },
          { target: 'school-profile', label: '서울신가초 경로 단면' }, { target: 'horizon', label: '지점별 지형 단면 열기' }],
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
        finding: `송파역 ${songpaStationAccess.exit}에는 계단이 있어요. ${songpaStationAccess.elevator}의 지상 엘리베이터와 출구 앞 보도는 서울시 위치 자료로 눈높이에서 확인할 수 있어요. 뉴스타트병원 보조출입구는 2022년 서울시 조사에서 경사로가 기록됐어요.`,
        followUp: '엘리베이터 가동 여부와 문 앞 단차, 단지까지 보도 폭과 턱, 병원 경사로 개방 여부를 확인해 보세요.',
        views: [{ target: 'station-access', label: '송파역 계단·엘리베이터 확인' }, { target: 'hospital-route', label: '병원 방향과 조사 출입구 보기' }],
        sources: [{ label: '서울교통공사 송파역 안내도', url: songpaStationAccess.guide },
          { label: '국가철도공단 엘리베이터 목록', url: songpaStationAccess.elevatorSource },
          { label: '서울시 지상 엘리베이터 좌표', url: songpaStationAccess.elevatorLocation.source }, hospitalEntrances],
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
        views: [{ target: 'park-entry', label: '송이공원 진입부와 산책로 보기' }, { target: 'places', label: '생활시설 지도 열기' }],
        sources: [{ label: '송파구의 송이공원 소개', url: songiPark.parkSource }, { label: '공원 항공영상 촬영 정보', url: songiPark.aerialMetadata }],
      },
    ],
  },
  {
    title: '생활 조건과 현장 메모',
    checks: [
      {
        id: 'parking', title: '주차와 관리', evidence: 'document',
        finding: `지상·지하 주차면, 승강기 수와 ${songpaManagementFees.month} 발생분 관리비를 K-apt 공시에서 확인했어요.`,
        followUp: '저녁 빈자리, 방문차량 이용, 청소와 조경 상태를 살펴보세요. 다른 단지의 공용관리비는 같은 발생월의 주거전용면적 ㎡당 금액으로 비교해 보세요.',
        views: [{ target: 'parking', label: '주차·관리비 공시 보기' }, { target: 'garage', label: '주차장 입구 눈높이 보기' }],
        sources: [seoulComplex, { label: 'K-apt 관리시설정보', url: songpaFacilities.management },
          { label: 'K-apt 우리단지 관리비등 조회', url: songpaManagementFees.source },
          { label: '송파구 분리수거함 조사 · 102동 지하주차장 입구 표기', url: songpaEntrance.record }],
      },
      {
        id: 'noise', title: '소음·야간 환경', evidence: 'document',
        finding: '같은 시각의 대로 옆과 단지 안쪽을 둘러보며 지도에 기록된 조명 위치를 볼 수 있어요. 주변 센서의 소음·조도에는 실제 측정 장소와 시각을 표시해요.',
        followUp: '대로 쪽과 안쪽에서 평일 밤·주말 소음, 조명, 냄새를 확인해 보세요.',
        views: [{ target: 'ambient', label: '소음·야간 환경 둘러보기' }],
        sources: [
          { label: '서울시 S-DoT 센서 기록', url: ambientSources.readings },
          { label: '서울시 가로등·보안등 위치 도형', url: ambientSources.lamps },
          { label: 'OpenStreetMap 양재대로', url: ambientSources.road },
        ],
      },
      {
        id: 'drainage', title: '물길·침수·배수', evidence: 'document',
        finding: '서울시 과거 침수흔적과 한 시간 100mm 강우를 가정한 예상 영역을 단지 경계와 비교해요. 정문·단지 포장 공간·102동 주차장 덮개 끝에서는 가장 가까운 영역까지의 거리도 볼 수 있어요.',
        followUp: '비가 그친 뒤 물이 모인 곳, 빗물받이와 지하주차장 차수 시설을 확인해 보세요.',
        views: [{ target: 'flood', label: '침수 기록과 물길 보기' }],
        sources: [{ label: '서울시 침수흔적도 원본', url: floodSource }, { label: '서울시 침수예상도 원본', url: floodForecast.source }],
      },
      {
        id: 'interior', title: '세대 내부', evidence: 'visit',
        finding: '공개 기본형 평면도에서 거실과 발코니 배치를 확인할 수 있어요. 3D에서는 101~105동 외벽 바깥에서 앞 건물과 실외 일조를 비교할 수 있어요.',
        followUp: '관심 세대의 층과 거실 창 방향, 실제 채광, 창호, 결로·누수, 수압, 층간소음을 확인해 보세요.',
        views: [{ target: 'facades', label: '동별 외벽과 앞 건물 보기' }],
        sources: [{ label: 'KB부동산 기본형 평면도', url: songpaArchitecture.basicPlans }],
      },
      {
        id: 'visit-plan', title: '방문 장소·시간 정하기', evidence: 'visit',
        finding: '귀갓길과 겨울 일조 비교에서 담은 장소에 방문 예정 시각과 확인할 질문을 적을 수 있어요.',
      },
    ],
  },
];
