export const songpaFacilities = {
  checkedOn: '2026-11-18',
  complexCode: 'A13816002',
  households: 264,
  surfaceParking: 19,
  undergroundParking: 517,
  lifts: 8,
  sharedFacilities: ['관리사무소', '경로당', '어린이놀이터', '자전거보관소'],
  management: 'https://www.k-apt.go.kr/kaptinfo/openKaptMng.do',
  playground: 'https://www.cpf.go.kr/cpf/ko/nori/0006/index.jsp?sido=1100000000&sigungu=1171000000&rgnCd=1171000000&ronaDaddr=%EC%86%A1%ED%8C%8C%EB%8C%80%EB%A1%9C32%EA%B8%B8',
};

type Coordinate = [longitude: number, latitude: number];

export const songpaGrounds = {
  source: 'https://www.arcgis.com/apps/mapviewer/index.html?source=sd&url=https%3A%2F%2Fserver.arcgisonline.com%2Farcgis%2Frest%2Fservices%2FWorld_Imagery%2FMapServer&center=127.11665,37.49762&level=19',
  captureDate: '2025-10-28',
  metadata: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/9/query?objectIds=480339&outFields=SRC_DATE,NICE_DESC,SRC_RES&returnGeometry=false&f=pjson',
  // Trace visible pavement, paint and crowns from World Imagery at level 19.
  paving: [
    [127.1165451, 37.4973993], [127.1165559, 37.4974567], [127.1165827, 37.4975227],
    [127.1166041, 37.4975759], [127.1166256, 37.4976206], [127.1166068, 37.4976568],
    [127.1166310, 37.4977227], [127.1166766, 37.4977504], [127.1167356, 37.4977504],
    [127.1167919, 37.4977334], [127.1168000, 37.4976993], [127.1167597, 37.4976674],
    [127.1167275, 37.4976376], [127.1167034, 37.4975908], [127.1166873, 37.4975504],
    [127.1166551, 37.4974887], [127.1166283, 37.4974376], [127.1166122, 37.4974014],
  ] satisfies Coordinate[],
  markings: [
    { start: [127.1166390, 37.4976291], end: [127.1166900, 37.4976100] },
    { start: [127.1166283, 37.4976802], end: [127.1166900, 37.4977270] },
  ] satisfies { start: Coordinate; end: Coordinate }[],
  crowns: [
    [127.1164808, 37.4974142], [127.1164727, 37.4973695], [127.1164995, 37.4974695],
    [127.1167409, 37.4975333], [127.1167248, 37.4974716], [127.1167597, 37.4974014],
    [127.1168134, 37.4976355],
  ] satisfies Coordinate[],
  points: [
    { id: 'south-paving', name: '포장로 남쪽', coordinate: [127.1165907, 37.4974674], lookAt: [127.1166685, 37.4976248] },
    { id: 'inner-paving', name: '동 사이 포장 공간', coordinate: [127.1166846, 37.4976632], lookAt: [127.1166176, 37.4975248] },
  ] satisfies { id: string; name: string; coordinate: Coordinate; lookAt: Coordinate }[],
};
