type Coordinate = [longitude: number, latitude: number];

export const songpaEntrance = {
  capturedIn: '2026년 6월',
  record: 'https://www.data.go.kr/data/15038206/fileData.do',
  roadGeometry: 'https://openlab.eseoul.go.kr/qgisplugin/SHP/N1L_A0010000.zip',
  sidewalkGeometry: 'https://openlab.eseoul.go.kr/qgisplugin/SHP/N1A_A0033320.zip',
  roadGeometryLabel: '서울특별시 에스맵-오픈랩 데이터',
  main: {
    id: 'main-crossing', name: '정문 접근로',
    position: [127.1169555, 37.4977610] as Coordinate,
    lookAt: [127.1166793, 37.4977057] as Coordinate,
    roadview: 'https://map.kakao.com/link/roadview/37.4977292,127.1169071',
  },
  garage: {
    id: 'garage-canopy', name: '102동 주차장 덮개',
    position: [127.1169475, 37.4982143] as Coordinate,
    lookAt: [127.1168000, 37.4982079] as Coordinate,
    axis: [[127.1167597, 37.4982909], [127.1168402, 37.4981441]] satisfies Coordinate[],
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
