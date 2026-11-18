import { songpaComplex } from './regions';

type Source = { label: string; url: string };
export type ChecklistView = 'complex' | 'street' | 'sun' | 'horizon' | 'school' | 'places';
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
        id: 'facilities', title: '정문·놀이터·공용시설', evidence: 'visit',
        finding: '송파대로32길에서 단지를 볼 수 있어요. 단지 출입구와 놀이터·커뮤니티 위치, 내부 보행로는 지도에서 확인 중이에요.',
        followUp: '정문·후문, 분리수거장, 놀이터, 주차장 경사로와 보행로가 만나는 지점을 확인해 보세요.',
        views: [{ target: 'street', label: '단지 앞 도로로 이동' }], sources: [seoulComplex],
      },
    ],
  },
  {
    title: '평소 오가는 길',
    checks: [
      {
        id: 'transit', title: '역·정류장까지 걷기', evidence: 'visit',
        finding: '단지 출입구에서 역 출입구나 정류장까지 이어지는 보행 구간은 확인 중이에요.',
        followUp: '출근할 시간에 횡단보도, 신호 대기, 계단과 실제 걸린 시간을 기록해 보세요.',
        sources: [walkingNetwork],
      },
      {
        id: 'slope', title: '언덕길과 귀갓길', evidence: 'model',
        finding: '눈높이 관측 지점에서 방향별 지형 단면을 볼 수 있어요. 원본 표고 자료의 해상도는 약 30m예요.',
        followUp: '귀갓길의 가장 가파른 구간은 실제 보도나 경사로에서 확인해 보세요.',
        views: [{ target: 'horizon', label: '지형 단면 열기' }], sources: [terrainGrade],
      },
      {
        id: 'alternatives', title: '완만한 길·계단 우회', evidence: 'visit',
        finding: '계단을 피할 수 있는 길과 엘리베이터 연결은 구간별 확인이 필요해요.',
        followUp: '출입구와 횡단 지점을 바꿔 보면서 완만한 길과 걸린 시간을 기록해 보세요.',
        sources: [walkingNetwork],
      },
      {
        id: 'accessibility', title: '유모차·휠체어 동선', evidence: 'visit',
        finding: '보도 유효폭, 턱, 노면, 횡경사와 경사로·승강기 연결은 현장에서 볼 항목이에요.',
        followUp: '실제로 이용할 동 출입구부터 단지 밖 목적지까지 끊김 없이 이어지는지 살펴보세요.',
      },
      {
        id: 'school', title: '통학·통원', evidence: 'model',
        finding: '3D에서 주변 학교 위치를 찾을 수 있어요. 학구도에서 주소로 배정 구역을 확인하고, 학교나 통원 시설의 실제 출입구가 어디인지 살펴보세요.',
        followUp: '통학할 시간에 큰길 횡단, 차가 드나드는 곳과 보도 연결을 확인해 보세요.',
        views: [{ target: 'school', label: '학교 위치 보기' }],
        sources: [{ label: '공식 학구도 안내', url: 'https://schoolzone.emac.kr/' }],
      },
      {
        id: 'services', title: '장보기·병원·공원', evidence: 'model',
        finding: '주변 상점 위치와 녹지 경계까지의 직선거리를 볼 수 있어요. 병원 출입구·공원 입구와 보행 연결은 확인 중이에요.',
        followUp: '자주 이용할 시설의 위치, 이용 시간, 큰길을 건너는지 확인해 보세요.',
        views: [{ target: 'places', label: '생활시설 지도 열기' }], sources: [siteBoundary],
      },
    ],
  },
  {
    title: '생활 조건과 현장 메모',
    checks: [
      {
        id: 'parking', title: '주차와 관리', evidence: 'document',
        finding: '서울시 공동주택 통합정보마당에 5개 동·264세대가 공개돼 있어요. 관리비는 기준월과 면적을 함께 보고, 주차대수는 단지 공시에서 확인해요.',
        followUp: '저녁 빈자리, 방문차량 이용, 청소와 조경 상태를 살펴보세요.',
        sources: [seoulComplex, { label: '공동주택관리정보시스템 K-apt', url: 'https://www.k-apt.go.kr/' }],
      },
      {
        id: 'noise', title: '소음·야간 환경', evidence: 'visit',
        finding: '인근 양재대로 위치와 공개 측정망을 볼 수 있어요. 단지 안의 시간대별 소음과 밝기는 현장 확인이 필요해요.',
        followUp: '대로 쪽과 안쪽에서 평일 밤·주말 소음, 조명, 냄새를 확인해 보세요.',
        sources: [
          { label: 'OpenStreetMap 양재대로', url: 'https://www.openstreetmap.org/way/909112476' },
          { label: '국가소음정보시스템', url: 'https://www.noiseinfo.or.kr/index.jsp' },
        ],
      },
      {
        id: 'drainage', title: '물길·침수·배수', evidence: 'visit',
        finding: '서울시 침수흔적도에서 공개된 이력을 살펴볼 수 있어요. 지하주차장 진입부나 단지 배수구의 실제 상태는 현장 확인이 필요해요.',
        followUp: '비 오는 날 물이 모이는 곳과 주차장 차수 시설을 확인해 보세요.',
        sources: [{ label: '서울 안전누리 침수흔적도', url: 'https://safecity.seoul.go.kr/distFclt/cfMapDs/cfMapDs.page?menuId=MENU_SSNS_000192' }],
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
