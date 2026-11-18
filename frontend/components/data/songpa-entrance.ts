type Coordinate = [longitude: number, latitude: number];

export const songpaEntrance = {
  capturedIn: '2026년 6월',
  record: 'https://www.data.go.kr/data/15038206/fileData.do',
  main: {
    id: 'main-crossing', name: '정문 횡단부',
    position: [127.1169689, 37.4977100] as Coordinate,
    lookAt: [127.1168402, 37.4977419] as Coordinate,
    axis: [[127.1168670, 37.4977227], [127.1168053, 37.4977823]] satisfies Coordinate[],
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
