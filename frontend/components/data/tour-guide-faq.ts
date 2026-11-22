import type { OpoData } from '../opo-data';
import snapshot from './tour-complexes.generated.json';
import { isLargeRetail, retailCategoryLabels, retailPermitSource } from './retail-places';

export const guideQuestions = [
  '언제 지어졌어요?', '주차 공간은 얼마나 돼요?', '근처 지하철역은 어디예요?',
  '어린이집이나 학교가 가까워요?', '공원이나 마트가 있어요?', '출퇴근하기 편해요?',
];
export type GuideSource = { name: string; url: string; date: string | null };
export type GuideAnswer = { text: string; sources: GuideSource[] };
export type GuideData = Pick<OpoData, 'region' | 'access' | 'places' | 'placeOrigin' | 'placeSnapshot'> & {
  complexCode: string | null;
};

const byCode: Record<string, (typeof snapshot.guideByCode)[keyof typeof snapshot.guideByCode]> = snapshot.guideByCode;
const fmt = new Intl.NumberFormat('ko-KR');
const osmUrl = 'https://www.openstreetmap.org/copyright';

export function answerTourQuestion(question: string, data: GuideData): GuideAnswer[] {
  const query = question.normalize('NFC').replace(/\s+/g, '');
  const legacy = data.region === 'opo' || data.region === 'songpa' ? snapshot.complexes[data.region].code : null;
  const code = data.complexCode ?? legacy;
  const facts = code ? byCode[code] : undefined;
  const kapt: GuideSource[] = facts ? [{
    name: `K-apt 단지 기본정보 (${facts.code})`, url: 'https://www.k-apt.go.kr/', date: snapshot.snapshotDate,
  }] : [];
  const osm: GuideSource[] = [{
    name: '© OpenStreetMap contributors · OpenFreeMap POI', url: osmUrl, date: data.placeSnapshot,
  }];
  const answers: GuideAnswer[] = [];
  const add = (text: string, sources: GuideSource[] = []) => answers.push({ text, sources });
  const nearestPlace = (category: string, name?: RegExp) => data.places.find(place =>
    place.category === category && (!name || name.test(place.name)));
  const distanceTo = (place: { name: string; distance_m: number }) =>
    `${place.name}까지 ${data.placeOrigin.label}에서 직선 약 ${fmt.format(place.distance_m)}m예요.`;
  const station = data.access.routes.filter(route => /(?:^|-)station(?:-|$)/.test(route.id))
    .reduce<(typeof data.access.routes)[number] | undefined>((best, route) =>
      !best || route.lengthM < best.lengthM ? route : best, undefined);
  function routeAnswer(route: (typeof data.access.routes)[number]) {
    const gap = route.gapM != null && route.gapM > 0 ? ` 지도 연결 미확인 구간이 약 ${fmt.format(route.gapM)}m 있어요.` : '';
    add(`수록된 경로는 ${route.name} 방향이에요. ${data.access.startLabel}에서 약 ${fmt.format(route.lengthM)}m예요.${gap}`,
      [{ name: '© OpenStreetMap contributors · 지도상 경로', url: route.referenceSource || osmUrl, date: data.access.retrieved ?? null }]);
  }

  if (/지어졌|지었|건축|준공|사용승인|몇년식|연식/.test(query)) {
    add(facts?.approvalDate ? `아파트 사용승인일은 ${facts.approvalDate}이에요.` : '이 단지의 사용승인일은 확인된 자료가 없어요.', kapt);
  }
  if (/주차/.test(query)) {
    if (facts?.parkingSpaces != null) {
      const ratio = facts.households ? `, 세대당 약 ${(facts.parkingSpaces / facts.households).toFixed(2)}대` : '';
      add(`등록된 주차 공간은 총 ${fmt.format(facts.parkingSpaces)}대${ratio}예요. 실제 빈자리와 주차 이용 조건은 확인할 수 없어요.`, kapt);
    } else add('이 단지의 주차 대수는 확인된 자료가 없어요.', kapt);
  }
  const commute = /출퇴근|출근|퇴근|통근/.test(query);
  if (/지하철|전철|역세권|가까운역|근처역/.test(query) || commute) {
    if (station) routeAnswer(station);
    else if (!commute) add('이 단지에서 지하철역까지 연결된 도보 경로 자료가 없어요.');
  }
  if (commute) add('목적지까지의 이동 시간이나 출퇴근 편의는 현재 자료로 확인할 수 없어요.');
  if (/어린이집|보육/.test(query)) {
    add(facts?.childcareListed ? '단지 기본정보에 보육시설이 등록돼 있어요. 운영 여부와 입소 조건은 확인할 수 없어요.'
      : '단지 안팎 어린이집은 연결된 자료에서 확인하지 못했어요.', kapt);
  }
  if (/학교|초등|중등|고등|학군|초품아/.test(query)) {
    const schools = [
      [/초등|초품아/, /초등\s*(?:학)?교\s*$/],
      [/중학교|중등/, /중\s*학교\s*$/],
      [/고등|고교/, /고등\s*학교\s*$/],
    ].filter(([mention]) => mention.test(query)).map(([, name]) => name);
    const found = (schools.length ? schools : [undefined]).map(name => nearestPlace('school', name)).filter(Boolean);
    add(found.length ? `지도에 수록된 가까운 학교예요. ${found.map(distanceTo).join(' ')} 통학구역과 실제 도보 거리는 별도 확인이 필요해요.`
      : '질문하신 학교 유형은 현재 연결된 지도 자료에서 확인하지 못했어요.', osm);
  }
  if (/공원|산책/.test(query)) {
    const park = data.access.routes.filter(route => /(?:공원|park)/.test(`${route.name} ${route.id}`))
      .reduce<(typeof data.access.routes)[number] | undefined>((best, route) =>
        !best || route.lengthM < best.lengthM ? route : best, undefined);
    if (park) routeAnswer(park);
    else add('이 단지에서 공원까지 연결된 경로 자료가 없어요.');
  }
  if (/마트|슈퍼|쇼핑|대규모점포/.test(query)) {
    const wantsMart = /마트|슈퍼/.test(query);
    const mart = wantsMart ? nearestPlace('supermarket') : undefined;
    const shop = mart ?? data.places.find(place => isLargeRetail(place.category));
    if (shop && isLargeRetail(shop.category)) {
      const lead = wantsMart && !mart ? '대형마트는 확인되지 않았어요. 가까운 쇼핑시설을 알려드릴게요. ' : '';
      add(`${lead}${distanceTo(shop)} 시설 유형은 ${shop.businessType ?? retailCategoryLabels[shop.category]}입니다.`,
        shop.source === 'permit'
          ? [{ name: '행정안전부 대규모점포 인허가', url: retailPermitSource, date: shop.sourceDate ?? null }] : osm);
    } else add('연결된 자료에서 마트·쇼핑시설 위치를 확인하지 못했어요.');
  }
  if (/편의점/.test(query)) {
    const store = nearestPlace('convenience');
    add(store ? distanceTo(store) : '편의점 위치는 현재 연결된 지도 자료에서 확인하지 못했어요.', osm);
  }
  if (!answers.length) add('그 질문에 답할 자료를 찾지 못했어요. 사용승인일, 주차, 대중교통, 학교, 공원은 아래 질문으로 확인할 수 있어요.');
  return answers;
}
