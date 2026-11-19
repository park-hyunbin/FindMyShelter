import type { ParkingCanopyLayout } from '../opo-songpa-entrance';
import type { VehicleGateLayout } from '../opo-site-surfaces';

type Coordinate = [longitude: number, latitude: number];

// The June 2026 street view shows the island and the arms. Their position
// and dimensions are fitted to the mapped paving rather than measured.
const mainGateIsland = {
  axis: [[127.1167785, 37.4977710], [127.1167485, 37.4977968]],
  width: 0.58,
  arms: [
    { atM: 0.58, side: 1, lengthM: 2.65, raised: true },
    { atM: 3.2, side: -1, lengthM: 2.65, raised: false },
  ],
} satisfies VehicleGateLayout;

export const songpaEntrance = {
  capturedIn: '2026년 6월',
  record: 'https://www.data.go.kr/data/15038206/fileData.do',
  roadGeometry: 'https://openlab.eseoul.go.kr/qgisplugin/SHP/N1L_A0010000.zip',
  sidewalkGeometry: 'https://openlab.eseoul.go.kr/qgisplugin/SHP/N1A_A0033320.zip',
  roadGeometryLabel: '서울특별시 에스맵-오픈랩 데이터',
  frontage: {
    id: 'songpa-west-frontage',
    surveyedWalkId: 'yangjae-west-sidewalk',
    roadview: 'https://map.kakao.com/link/roadview/37.4981015,127.1170004',
  },
  main: {
    id: 'main-crossing', name: '정문 접근로',
    position: [127.1169555, 37.4977610] as Coordinate,
    lookAt: mainGateIsland.axis[0],
    island: mainGateIsland,
    roadview: 'https://map.kakao.com/link/roadview/37.4977292,127.1169071',
  },
  garage: {
    id: 'garage-canopy', name: '102동 주차장 덮개',
    // Inside the west sidewalk outline of Yangjae-daero 60-gil (N1A_A0033320 UFID 1).
    position: [127.1169800, 37.4981240] as Coordinate,
    lookAt: [127.1168100, 37.4981900] as Coordinate,
    canopy: {
      // Paired visible roof edges in the 2025-10-28 orthophoto, in order from north to south.
      sections: [
        [[127.1167168, 37.4982696], [127.1167785, 37.4983016]],
        [[127.1167409, 37.4982398], [127.1168053, 37.4982696]],
        [[127.1167651, 37.4982079], [127.1168321, 37.4982377]],
        [[127.1167919, 37.4981760], [127.1168590, 37.4982058]],
        [[127.1168160, 37.4981462], [127.1168777, 37.4981654]],
        [[127.1168268, 37.4981228], [127.1168885, 37.4981334]],
      ],
      eaveM: 0.84,
      riseM: 2.55,
    } satisfies ParkingCanopyLayout,
    roadview: 'https://map.kakao.com/link/roadview/37.4981654,127.1170467',
  },
};

// East boundary from Seoul OpenLab N1L_A0010000, UFID 1000377090304A00110000000000000216.
// The adjoining walk-facing strip is inferred from aerial and street references.
export const songpaStreetEdge = [
  [127.1170869, 37.4978728],
  [127.1170488, 37.4978353],
  [127.1169255, 37.4977474],
  [127.1168913, 37.4977182],
  [127.1168480, 37.4976759],
  [127.1168169, 37.4976382],
] satisfies Coordinate[];
