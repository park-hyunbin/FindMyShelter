import type { SiteSurfaceLayout } from '../opo-site-surfaces';
import type { PlaygroundLayout } from '../opo-playground';
import { songpaStreetEdge } from './songpa-entrance';

export const songpaFacilities = {
  checkedOn: '2026-11-18',
  complexCode: 'A13816002',
  households: 264,
  surfaceParking: 19,
  undergroundParking: 517,
  lifts: 8,
  sharedFacilities: ['관리사무소', '경로당', '어린이놀이터', '자전거보관소'],
  management: 'https://www.k-apt.go.kr/kaptinfo/openKaptMng.do',
};

export const songpaManagementFees = {
  month: '2026년 9월',
  checkedOn: '2026-11-19',
  source: 'https://www.k-apt.go.kr/web/main/index.do',
  commonPerSquareMeter: 1_481.621155,
  charges: [
    { label: '공용관리비', won: 50_523_474 },
    { label: '개별사용료', won: 33_873_038 },
    { label: '장기수선충당금 월부과액', won: 12_048_860 },
  ],
};

type Coordinate = [longitude: number, latitude: number];
export type SongpaGroundView = { id: string; name: string; coordinate: Coordinate; lookAt: Coordinate; viewFrom?: Coordinate };

export const songpaPlayground = {
  facilityNo: '503928',
  source: 'https://www.cpf.go.kr/cpf/ko/nori/0006/index.jsp?qr=Y&pfctSn=503928',
  registered: '그네 1개 · 흔들놀이기구 3개 · 조합놀이대 1개 · 고무 바닥재',
  // Place the photographed forms within the interpreted aerial clearing.
  layout: {
    origin: [127.1159551, 37.4979057],
    equipment: [
      { kind: 'tower', offset: [0, 0], rotation: 6 },
      { kind: 'swing', offset: [-6.3, -1.6], rotation: 10 },
      { kind: 'seesaw', offset: [6.1, -0.7], rotation: 24 },
      { kind: 'animal-rocker', offset: [-2.2, 5.5], rotation: -28 },
      { kind: 'car-rocker', offset: [4.4, 2.7], rotation: -24 },
    ],
  } satisfies PlaygroundLayout,
};

// Clearings and route traces are interpreted against the apartment boundary and orthophoto.
// The ground photo corroborates the curved pavers and raised beds between 103 and 104.
export const songpaCourtyard = {
  groundPhoto: 'https://image.hogangnono.com/image/nowatermark/original/review/20251129172655_7a3aFmvY5EjhBA7uKX?q=100&s=720x180&t=outside',
  aerialReference: 'https://image.hogangnono.com/image/nowatermark/original/review/20240901230639_4UtsX4MKcHDSO5yekl?q=100&s=720x180&t=outside',
  seatRecord: 'https://www.k-apt.go.kr/bid/bidDetail.do?bidNum=20261112185416423',
  paths: [
    { width: 2.8, points: [
      [127.1158907, 37.4978121], [127.1159631, 37.4977653], [127.1160007, 37.4977164],
      [127.1160409, 37.4976483], [127.1160489, 37.4975908], [127.1160731, 37.4975248],
      [127.1161267, 37.4974823], [127.1162125, 37.4974376], [127.1163306, 37.4974035],
      [127.1164674, 37.4974184], [127.1165586, 37.4974567],
    ] },
    { width: 2.15, points: [
      [127.1159148, 37.4979440], [127.1159604, 37.4980100], [127.1160167, 37.4980675],
      [127.1160758, 37.4981377], [127.1161267, 37.4982015], [127.1161965, 37.4982356],
    ] },
    { width: 1.75, points: [
      [127.1159711, 37.4977653], [127.1160677, 37.4977844], [127.1161723, 37.4978185],
    ] },
    { width: 1.75, points: [
      [127.1160489, 37.4975908], [127.1160200, 37.4975770], [127.1159980, 37.4975333], [127.1159658, 37.4974801],
      [127.1159577, 37.4974269],
    ] },
  ] satisfies { width: number; points: Coordinate[] }[],
  apron: [
    [127.1168509, 37.4977164], [127.1167785, 37.4977015], [127.1167088, 37.4976632],
    [127.1166524, 37.4975674], [127.1166176, 37.4974631], [127.1165746, 37.4974269],
  ] satisfies Coordinate[],
  playground: [
    [127.1158504, 37.4979483], [127.1159095, 37.4979909], [127.1160060, 37.4979802],
    [127.1160650, 37.4979355], [127.1160623, 37.4978589], [127.1160060, 37.4978100],
    [127.1159148, 37.4978036], [127.1158558, 37.4978376], [127.1158290, 37.4978887],
  ] satisfies Coordinate[],
  beds: [
    [
      [127.1158692, 37.4978355], [127.1159416, 37.4978057], [127.1159658, 37.4977610],
      [127.1159095, 37.4977419], [127.1158263, 37.4977781],
    ],
    [
      [127.1159577, 37.4977185], [127.1159899, 37.4976780], [127.1159846, 37.4976078],
      [127.1159416, 37.4975844], [127.1158987, 37.4976100], [127.1159336, 37.4976632],
    ],
    [
      [127.1160892, 37.4974865], [127.1161562, 37.4974418], [127.1162581, 37.4974014],
      [127.1162206, 37.4973674], [127.1161240, 37.4973588], [127.1160462, 37.4974035],
      [127.1160409, 37.4974504],
    ],
    [
      [127.1160731, 37.4981420], [127.1160167, 37.4980590], [127.1159577, 37.4980121],
      [127.1159148, 37.4980313], [127.1159497, 37.4981015], [127.1160248, 37.4981781],
    ],
    [
      [127.1165130, 37.4975823], [127.1165666, 37.4975993], [127.1165560, 37.4975248],
      [127.1165173, 37.4974801], [127.1164727, 37.4974610], [127.1164513, 37.4975142],
    ],
    [
      [127.1162474, 37.4980994], [127.1163413, 37.4980845], [127.1163574, 37.4980015],
      [127.1163011, 37.4979206], [127.1162286, 37.4979547], [127.1161938, 37.4980292],
    ],
  ] satisfies Coordinate[][],
  roundSeat: [127.1159899, 37.4974950] as Coordinate,
  crowns: [
    [127.1158183, 37.4979270], [127.1158478, 37.4979675], [127.1158853, 37.4979930],
    [127.1159470, 37.4980100], [127.1160141, 37.4979866], [127.1160570, 37.4979483],
    [127.1160811, 37.4978866], [127.1160489, 37.4978206], [127.1159899, 37.4977908],
    [127.1159390, 37.4977802], [127.1158773, 37.4977930], [127.1158209, 37.4978313],
    [127.1158049, 37.4978738], [127.1159148, 37.4977270], [127.1159363, 37.4976632],
    [127.1159256, 37.4976142], [127.1159711, 37.4975716], [127.1160409, 37.4974567],
    [127.1161133, 37.4974057], [127.1161991, 37.4973865], [127.1162930, 37.4973886],
    [127.1163949, 37.4973865], [127.1164942, 37.4974291], [127.1165210, 37.4975376],
    [127.1165130, 37.4975780], [127.1162152, 37.4980483], [127.1162474, 37.4980058],
    [127.1162903, 37.4979440], [127.1163198, 37.4980270], [127.1160328, 37.4980994],
    [127.1160114, 37.4980526], [127.1160597, 37.4981356], [127.1160945, 37.4981930],
    [127.1161669, 37.4981462], [127.1162903, 37.4981888], [127.1168160, 37.4976674],
    [127.1168831, 37.4976461], [127.1169636, 37.4976163], [127.1170253, 37.4975333],
    [127.1170735, 37.4974695],
  ] satisfies Coordinate[],
  views: [
    { id: 'west-garden', name: '103·104동 사이 산책로', coordinate: [127.1161133, 37.4974865],
      viewFrom: [127.1160543, 37.4975674], lookAt: [127.1160784, 37.4976185] },
    { id: 'playground-edge', name: '어린이놀이터 옆', coordinate: [127.1159685, 37.4978100], lookAt: [127.1159551, 37.4979057] },
  ] satisfies SongpaGroundView[],
};

// Use the same traced points for the asphalt edge and the adjoining curb.
const songpaWestDriveEdge = [
  [127.1166310, 37.4977227], [127.1166068, 37.4976568], [127.1166256, 37.4976206],
  [127.1166041, 37.4975759], [127.1165559, 37.4974567], [127.1165451, 37.4973993],
] satisfies Coordinate[];
// Continue the surveyed east boundary south of the gate. The first point is
// interpolated on the same UFID as songpaStreetEdge, at the end of the traced court.
const songpaEastDriveEdge = [
  [127.1167029, 37.4974014], [127.1167214, 37.4974577], [127.1167679, 37.4975725],
] satisfies Coordinate[];

// Approach under the 102 canopy. Use N1L road edges ending in 151 and 142
// where they flank the drive, and the orthophoto to close the ends.
const songpaCoveredApproach = [
  [127.1168018, 37.4978386], [127.1168298, 37.4978641], [127.1169017, 37.4980951],
  [127.1169149, 37.4981356], [127.1169109, 37.4981665], [127.1168811, 37.4982065],
  [127.1168232, 37.4982694], [127.1167939, 37.4983069], [127.1167570, 37.4983207],
  [127.1167102, 37.4982845], [127.1167360, 37.4982462], [127.1167698, 37.4981994],
  [127.1167958, 37.4981547], [127.1167865, 37.4981122], [127.1167758, 37.4980547],
  [127.1167917, 37.4979879], [127.1167546, 37.4978737], [127.1167302, 37.4978249],
] satisfies Coordinate[];

export const songpaGrounds = {
  source: 'https://www.arcgis.com/apps/mapviewer/index.html?source=sd&url=https%3A%2F%2Fserver.arcgisonline.com%2Farcgis%2Frest%2Fservices%2FWorld_Imagery%2FMapServer&center=127.11665,37.49762&level=19',
  captureDate: '2025-10-28',
  metadata: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/9/query?objectIds=480339&outFields=SRC_DATE,NICE_DESC,SRC_RES&returnGeometry=false&f=pjson',
  // One continuous footprint from the street mouth to the inner court.
  // Use the OpenLab road edge at the curb and trace the remaining pavement in World Imagery.
  paving: [
    ...songpaStreetEdge.slice(2).reverse(),
    [127.1169502, 37.4977738], [127.1169233, 37.4977930], [127.1168751, 37.4977866],
    [127.1168375, 37.4977951], ...songpaCoveredApproach, [127.1167463, 37.4977866],
    [127.1166862, 37.4977504], [127.1166766, 37.4977504],
    ...songpaWestDriveEdge, ...songpaEastDriveEdge,
  ] satisfies Coordinate[],
  markings: [
    { start: [127.1166390, 37.4976291], end: [127.1166900, 37.4976100] },
    { start: [127.1166283, 37.4976802], end: [127.1166900, 37.4977270] },
  ] satisfies { start: Coordinate; end: Coordinate }[],
  // Reconstruct the visible south parking strip from the aerial and ground views.
  // The grouped bays and their display cars are a model, not the inventory of 19 spaces.
  parkingRows: [
    { aisle: [[127.1165838, 37.4974078], [127.1166429, 37.4975738]], depth: 2.34, side: 1, spaces: 3,
      orientation: 'parallel', displayCars: [{ space: 1, color: '#516470' }, { space: 2, color: '#d0d4d3' }] },
  ] satisfies NonNullable<SiteSurfaceLayout['parkingRows']>,
  crowns: [
    [127.1164808, 37.4974142], [127.1164727, 37.4973695], [127.1164995, 37.4974695],
    [127.1167409, 37.4975333], [127.1167248, 37.4974716], [127.1167597, 37.4974014],
    [127.1168134, 37.4976355],
  ] satisfies Coordinate[],
  points: [
    { id: 'south-paving', name: '포장로 남쪽', coordinate: [127.1165511, 37.4974674], lookAt: [127.1166685, 37.4976248] },
    { id: 'inner-paving', name: '동 사이 포장 공간', coordinate: [127.1166846, 37.4976632], lookAt: [127.1166176, 37.4975248] },
  ] satisfies SongpaGroundView[],
};
// Geometry stays in the site data. The photos inform visual details separately.
export const songpaSurfaceLayout = {
  drive: { points: songpaCourtyard.apron, width: 3.8 },
  paths: songpaCourtyard.paths,
  // The pavers and entrance style are photo references. The door placement and dimensions are illustrative.
  buildingEntries: [
    { buildingId: '55765541', wall: [127.1160945, 37.4976121], path: [127.1160462, 37.4976100], width: 3.10 },
  ],
  roadsideWalks: [
    { curb: songpaStreetEdge, outward: 1, width: 1.55 },
    { curb: songpaWestDriveEdge, outward: -1, width: 1.32, beside: 'driveway' },
    { curb: songpaEastDriveEdge, outward: -1, width: 0.88, beside: 'driveway', finish: 'planted' },
  ],
  surveyedWalks: [{
    roadId: 169916276,
    side: -1,
    // Seoul OpenLab N1A_A0033320, UFID 1000377090304A00310000000000000001.
    outline: [
      [127.1165602, 37.4985380], [127.1164495, 37.4986665], [127.1164672, 37.4986787],
      [127.1164715, 37.4986736], [127.1165756, 37.4985501], [127.1165779, 37.4985483],
      [127.1167014, 37.4984631], [127.1167022, 37.4984625], [127.1167283, 37.4984369],
      [127.1167782, 37.4983789], [127.1169079, 37.4982252], [127.1169732, 37.4981444],
      [127.1170050, 37.4981051], [127.1170119, 37.4980913], [127.1170140, 37.4980827],
      [127.1169556, 37.4981329], [127.1168890, 37.4982153], [127.1168668, 37.4982415],
      [127.1167595, 37.4983688], [127.1166903, 37.4984493], [127.1166869, 37.4984532],
      [127.1165859, 37.4985197], [127.1165646, 37.4985336],
    ],
    // Cross-section midpoints of the mapped sidewalk, from the complex toward the station.
    centerline: [
      [127.1170004, 37.4981015], [127.1169472, 37.4981599], [127.1168667, 37.4982579],
      [127.1167143, 37.4984368], [127.1166937, 37.4984584], [127.1166043, 37.4985187],
      [127.1165624, 37.4985504], [127.1164671, 37.4986622],
    ],
  }],
  playground: { outline: songpaCourtyard.playground, surface: 'rubber' },
  pavedDrive: songpaGrounds.paving,
  crossings: songpaGrounds.markings.map(marking => ({ ...marking, depth: 2.2 })),
  parkingRows: songpaGrounds.parkingRows,
} satisfies SiteSurfaceLayout;
