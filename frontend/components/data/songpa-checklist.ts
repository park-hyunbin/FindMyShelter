import { songpaComplex } from './regions';
import { songpaFacilities, songpaGrounds } from './songpa-grounds';
import { ambientSources } from './songpa-ambient';
import { floodSource } from './songpa-flood';
import { songpaSchool } from './songpa-school';

type Source = { label: string; url: string };
export type ChecklistView = 'complex' | 'sun' | 'horizon' | 'school' | 'places' | 'station-route' | 'park-route' | 'school-route' | 'paving' | 'parking' | 'ambient' | 'flood';
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
        finding: '101~105동과 송파대로32길을 눈높이와 조감으로 둘러볼 수 있어요. 건물의 위치·높이 표본과 지도상 주거 경계를 사용해요.',
        followUp: '배치도와 실제 동 표지, 건물 외관을 대조해 보세요.',
        views: [{ target: 'complex', label: '단지 전체 조감으로 보기' }], sources: [seoulComplex, siteBoundary],
      },
      {
        id: 'sunlight', title: '실외 일조와 시야', evidence: 'model',
        finding: '단지 안 실외 점의 직사광·그늘을 날짜와 시간별로 비교해요. 차폐 건물과 지형을 찾고 원하는 방향의 눈높이에서 시야를 살펴볼 수 있어요.',
        followUp: '맑은 날 모델이에요. 수목 그늘과 실제 시야는 같은 장소와 시각에 대조해 보세요.',
        views: [{ target: 'sun', label: '일조 지도 열기' }, { target: 'horizon', label: '방향별 시야 보기' }],
      },
      {
        id: 'facilities', title: '정문·놀이터·공용시설', evidence: 'model',
        finding: '항공영상에서 확인한 단지 안 포장 구간을 눈높이로 둘러볼 수 있어요. 어린이놀이터는 등록 자료에서 확인했어요.',
        followUp: '놀이터의 단지 내 위치, 출입구와 포장 구간의 연결, 지하주차장으로 내려가는 길은 현장에서 확인해 보세요.',
        views: [{ target: 'paving', label: '단지 안과 공용시설 보기' }],
        sources: [{ label: '항공영상', url: songpaGrounds.source }, { label: '행정안전부 놀이시설 현황', url: songpaFacilities.playground }],
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
        finding: '눈높이 관측 지점에서 방향별 지형 단면을 볼 수 있어요. 원본 표고 자료의 해상도는 약 30m예요.',
        followUp: '귀갓길의 가장 가파른 구간은 실제 보도나 경사로에서 확인해 보세요.',
        views: [{ target: 'park-route', label: '송이공원 방향 경로 단면' }, { target: 'horizon', label: '지점별 지형 단면 열기' }], sources: [terrainGrade],
      },
      {
        id: 'alternatives', title: '완만한 길·계단 우회', evidence: 'visit',
        finding: '표시한 경로의 지도상 계단 태그와 모델 지형 단면을 볼 수 있어요. 실제 계단·승강기와 이용 가능한 우회로는 구간별 확인이 필요해요.',
        views: [{ target: 'station-route', label: '역 방향 경로에서 확인' }],
        followUp: '출입구와 횡단 지점을 바꿔 보면서 완만한 길과 걸린 시간을 기록해 보세요.',
        sources: [walkingNetwork],
      },
      {
        id: 'accessibility', title: '유모차·휠체어 동선', evidence: 'visit',
        finding: '보도 유효폭, 턱, 노면, 횡경사와 경사로·승강기 연결은 현장에서 볼 항목이에요.',
        followUp: '실제로 이용할 동 출입구부터 단지 밖 목적지까지 끊김 없이 이어지는지 살펴보세요.',
      },
      {
        id: 'school', title: '통학·통원', evidence: 'document',
        finding: '공식 학구도에서 단지 전체가 서울신가초 통학구역에 들어가요. 학교 방향으로 이어지는 보행로와 송이로 횡단보도를 3D에서 볼 수 있어요.',
        followUp: '등교 시간 신호 대기와 교문까지의 보도 연결, 이용할 병원 출입구를 확인해 보세요.',
        views: [{ target: 'school', label: '공식 통학구역 보기' }, { target: 'school-route', label: '통학 방향 경로 보기' }],
        sources: [{ label: '한국교육시설안전원 통학구역 원본', url: songpaSchool.zoneSource }],
      },
      {
        id: 'services', title: '장보기·병원·공원', evidence: 'model',
        finding: '주변 상점 위치와 송이공원 남쪽 보행로까지 지도에 이어진 길을 볼 수 있어요. 병원 출입구와 공원의 실제 개방 상태는 현장 확인이 필요해요.',
        followUp: '자주 이용할 시설의 위치, 이용 시간, 큰길을 건너는지 확인해 보세요.',
        views: [{ target: 'park-route', label: '송이공원 방향 경로 보기' }, { target: 'places', label: '생활시설 지도 열기' }], sources: [siteBoundary],
      },
    ],
  },
  {
    title: '생활 조건과 현장 메모',
    checks: [
      {
        id: 'parking', title: '주차와 관리', evidence: 'document',
        finding: 'K-apt 관리시설 공시의 주차·승강기 수와 지상·지하 주차 구성을 확인할 수 있어요. 관리비를 비교할 때는 기준월과 면적을 맞춰 보세요.',
        followUp: '저녁 빈자리, 방문차량 이용, 청소와 조경 상태를 살펴보세요.',
        views: [{ target: 'parking', label: '주차·승강기 공시 보기' }],
        sources: [seoulComplex, { label: 'K-apt 관리시설정보', url: songpaFacilities.management }],
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
