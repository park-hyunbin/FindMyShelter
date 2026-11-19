import type { SiteSurfaceLayout } from '../opo-site-surfaces';
import type { PlaygroundLayout } from '../opo-playground';
import { songpaEntrance, songpaStreetEdge } from './songpa-entrance';
import { songiParkSurvey } from './songi-park';
import streetTreeArchive from '../../public/datasets/regions/songpa/street-trees.json';
import courtyardWalkArchive from '../../public/datasets/regions/songpa/courtyard-walks.json';

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

// OpenLab N1L_B0020000: UFID 70 identifies the iron fence, and 242 its concrete support on this span.
const playgroundFenceCorner: Coordinate = [127.1159068, 37.4980198];
const playgroundFences = [{
  color: '#e6e6df', height: 1.12,
  points: [
    [127.1158157, 37.4977601], [127.1158040, 37.4977748], [127.1158073, 37.4978124],
    [127.1158074, 37.4978139], [127.1158122, 37.4978321], [127.1158289, 37.4978724],
    [127.1158370, 37.4978729], [127.1158559, 37.4979011], [127.1158924, 37.4979463],
    [127.1158952, 37.4979501], [127.1158657, 37.4979658], playgroundFenceCorner,
  ],
}, {
  color: '#e6e6df', height: 0.86, plinth: { color: '#9c7867', width: 0.28, height: 0.54 },
  points: [
    playgroundFenceCorner, [127.1160408, 37.4979521], [127.1161020, 37.4979223],
    [127.1160940, 37.4979080], [127.1160691, 37.4978587], [127.1160622, 37.4978476],
    [127.1160354, 37.4978129], [127.1160317, 37.4978082],
  ],
}] satisfies NonNullable<SiteSurfaceLayout['ironFences']>;

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
const [courtyardNorthJoin, courtyardSouthJoin] =
  courtyardWalkArchive.connectorJoins.map(([lng, lat]): Coordinate => [lng, lat]);
export const songpaCourtyard = {
  groundPhoto: 'https://image.hogangnono.com/image/nowatermark/original/review/20251129172655_7a3aFmvY5EjhBA7uKX?q=100&s=720x180&t=outside',
  aerialReference: 'https://image.hogangnono.com/image/nowatermark/original/review/20240901230639_4UtsX4MKcHDSO5yekl?q=100&s=720x180&t=outside',
  seatRecord: 'https://www.k-apt.go.kr/bid/bidDetail.do?bidNum=20261112185416423',
  // Visible vegetation in the 2025-10-28 orthophoto. Gaps under opaque shadows remain unclassified.
  plantedGround: [
    [
      [127.1159497, 37.4981994], [127.1159953, 37.4982824], [127.1160731, 37.4983207],
      [127.1161401, 37.4982909], [127.1160892, 37.4982356], [127.1160516, 37.4981611],
      [127.1160033, 37.4980973], [127.1159309, 37.4980356], [127.1158719, 37.4980121],
      [127.1158934, 37.4980973],
    ], [
      [127.1157914, 37.4973503], [127.1158719, 37.4974142], [127.1159738, 37.4973971],
      [127.1160489, 37.4974333], [127.1161616, 37.4973908], [127.1162394, 37.4974035],
      [127.1163011, 37.4973631], [127.1163654, 37.4973780], [127.1164593, 37.4973908],
      [127.1165103, 37.4974014], [127.1164969, 37.4973525], [127.1163869, 37.4973418],
      [127.1162823, 37.4973333], [127.1161589, 37.4973291], [127.1160623, 37.4973205],
      [127.1159309, 37.4973142], [127.1158075, 37.4973120],
    ], [
      [127.1168858, 37.4976632], [127.1169582, 37.4977121], [127.1170360, 37.4976568],
      [127.1170709, 37.4976036], [127.1170011, 37.4975738], [127.1169287, 37.4975121],
      [127.1169046, 37.4974610], [127.1168187, 37.4974440], [127.1167839, 37.4974865],
      [127.1168053, 37.4975589],
    ], [
      // Tree cover distinguishable in the orthophoto inside the 101–102 curved footway.
      [127.1160007, 37.4981185], [127.1160731, 37.4981675], [127.1161616, 37.4981739],
      [127.1162313, 37.4981420], [127.1162957, 37.4981164], [127.1163225, 37.4980547],
      [127.1163064, 37.4979738], [127.1162581, 37.4979100], [127.1161804, 37.4978632],
      [127.1160865, 37.4978738], [127.1160409, 37.4979079], [127.1160114, 37.4979611],
      [127.1159846, 37.4980356],
    ],
  ] satisfies Coordinate[][],
  paths: [
    { width: 2.8, points: [
      [127.1158907, 37.4978121], [127.1159631, 37.4977653], courtyardNorthJoin,
    ] },
    { width: 2.8, points: [
      courtyardSouthJoin,
      [127.1161267, 37.4974823], [127.1162125, 37.4974376], [127.1163306, 37.4974035],
      [127.1164674, 37.4974184], [127.1165586, 37.4974567],
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
      // The garden bed stays inside the surveyed path edge, including the modeled curb.
      [127.1162474, 37.4980994], [127.1163413, 37.4980845], [127.11635277, 37.49802537],
      [127.11635052, 37.49800424], [127.11634377, 37.49798400], [127.11634044, 37.49797713],
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
    { id: 'playground-edge', name: '어린이놀이터 옆', coordinate: [127.1159685, 37.4978100],
      viewFrom: [127.1159363, 37.4979680], lookAt: [127.1159960, 37.4977550] },
  ] satisfies SongpaGroundView[],
};

// The visible west apron and the drive use the same edge. The bend follows the lighter paving in the orthophoto.
const songpaWestDriveEdge = [
  [127.1166862, 37.4977504], [127.1166739, 37.4977355], [127.1166605, 37.4977249],
  [127.1166444, 37.4977078], [127.1166283, 37.4976866], [127.1166176, 37.4976674],
  [127.1166068, 37.4976568], [127.1166256, 37.4976206],
  [127.1166041, 37.4975759], [127.1165559, 37.4974567], [127.1165451, 37.4973993],
] satisfies Coordinate[];
// Continue the surveyed east boundary south of the gate. The first point is
// interpolated on the same UFID as songpaStreetEdge, at the end of the traced court.
const songpaEastDriveEdge = [
  [127.1167029, 37.4974014], [127.1167214, 37.4974577], [127.1167679, 37.4975725],
] satisfies Coordinate[];
// The short recessed edge at the parking strip meets the visible landscaped verge.
const songpaParkingVerge = [
  songpaEastDriveEdge.at(-1)!,
  [127.1167302, 37.4975844], [127.1167248, 37.4976078],
  [127.1167436, 37.4976227], [127.1167812, 37.4976376],
  songpaStreetEdge.at(-1)!,
] satisfies Coordinate[];
// N1L_A0010000, UFID ending in 216, continuing the east edge to Yangjae-daero 60-gil.
const songpaApproachEast = [
  [127.1172015, 37.4979216], [127.1171764, 37.4979217], [127.1171387, 37.4979134],
  [127.1171237, 37.4979037], [127.1171040, 37.4978893], ...songpaStreetEdge.slice(0, 2),
] satisfies Coordinate[];
const songpaDrivewayJoin = [
  songpaApproachEast[0], [127.1170812, 37.4980249], [127.1170194, 37.4980780],
] satisfies Coordinate[];
// The opposite edge uses the orthophoto where visible and is approximate under the trees.
// The two northern points share the main road boundary. The approach wraps around N1A_A0043325 crossing 14.
const songpaApproachWest = [
  ...songpaDrivewayJoin.slice(1),
  [127.1169984, 37.4980526], [127.1169931, 37.4980100], [127.1169904, 37.4979781],
  [127.1170011, 37.4979355], [127.1170199, 37.4978972], [127.1170470, 37.4978800],
  [127.1169980, 37.4978510], [127.1169270, 37.4978150], [127.1168751, 37.4977866],
] satisfies Coordinate[];
const songpaGateNorthCorner: Coordinate = [127.1168375, 37.4977951];
const songpaGateWalkMerge: Coordinate = [127.1168253, 37.4977977];
// Start at the end of the surveyed sidewalk, then follow the driveway boundary.
// June 2026 street imagery shows pavers on the west side.
const songpaPublicWalkJoin: Coordinate = [127.1170050, 37.4981051];
const songpaPublicWalkEnd: Coordinate = [127.1170140, 37.4980827];

export const songpaJunction = {
  crossingSource: 'https://openlab.eseoul.go.kr/qgisplugin/SHP/N1A_A0043325.zip',
  // N1A_A0010000 UFIDs 38, 18, 35, 17, 34 and 16, clipped at the next OSM node.
  branch: {
    roadId: 169916267, nodes: [1810741901, 2911195477],
    outline: [
      [127.1174164, 37.4983646], [127.1171106, 37.4982038], [127.1170086, 37.4983179],
      [127.1170173, 37.4983167], [127.1172680, 37.4984484], [127.1173196, 37.4984766],
      [127.1173452, 37.4984905], [127.1173785, 37.4985086], [127.1176608, 37.4986611],
      [127.1176803, 37.4986718], [127.1177367, 37.4987026], [127.1180795, 37.4988901],
      [127.1181798, 37.4987745], [127.1180830, 37.4987219], [127.1178370, 37.4985971],
      [127.1177785, 37.4985649], [127.1177491, 37.4985484], [127.1174702, 37.4983957],
    ],
    // The junction node is shared with Yangjae-daero 60-gil. Recenter the far node on the measured section.
    axis: [{ nodeId: 2911195477, coordinate: [127.1181296, 37.4988323] }],
  } satisfies NonNullable<SiteSurfaceLayout['surveyedRoads']>[number],
  // N1A_A0033320 sidewalk outlines at the same branch.
  branchSidewalks: [{
    roadId: 169916267, side: 1,
    // UFID ending in 24.
    outline: [
      [127.1173936, 37.4983689], [127.1174164, 37.4983646], [127.1171106, 37.4982038],
      [127.1170954, 37.4981968], [127.1170950, 37.4982004], [127.1170956, 37.4982079],
      [127.1170983, 37.4982195], [127.1171087, 37.4982351], [127.1173141, 37.4983432],
      [127.1173625, 37.4983686], [127.1173754, 37.4983689],
    ],
  }, {
    roadId: 169916267, side: -1,
    // UFID ending in 26.
    outline: [
      [127.1180808, 37.4988908], [127.1180846, 37.4988802], [127.1180854, 37.4988698],
      [127.1180848, 37.4988661], [127.1180835, 37.4988630], [127.1178479, 37.4987323],
      [127.1175553, 37.4985733], [127.1171995, 37.4983801], [127.1170428, 37.4982977],
      [127.1170384, 37.4982971], [127.1170302, 37.4982967], [127.1170272, 37.4982971],
      [127.1170086, 37.4983179], [127.1170173, 37.4983167], [127.1172680, 37.4984484],
      [127.1173196, 37.4984766], [127.1173452, 37.4984905], [127.1173785, 37.4985086],
      [127.1176608, 37.4986611], [127.1176803, 37.4986718], [127.1177367, 37.4987026],
    ],
  }, {
    roadId: 169916267, side: 1,
    // UFID ending in 23.
    outline: [
      [127.1177785, 37.4985649], [127.1177491, 37.4985484], [127.1174702, 37.4983957],
      [127.1174705, 37.4984135], [127.1174734, 37.4984219], [127.1174766, 37.4984301],
      [127.1174797, 37.4984327], [127.1175745, 37.4984850], [127.1177299, 37.4985706],
      [127.1177399, 37.4985752], [127.1177433, 37.4985764], [127.1177479, 37.4985766],
    ],
  }, {
    roadId: 169916267, side: 1,
    // UFID ending in 29.
    outline: [
      [127.1182188, 37.4987257], [127.1182229, 37.4987220], [127.1182279, 37.4987165],
      [127.1182054, 37.4986999], [127.1180830, 37.4987219], [127.1178370, 37.4985971],
      [127.1178403, 37.4986123], [127.1178410, 37.4986238], [127.1178422, 37.4986280],
      [127.1178450, 37.4986325], [127.1180643, 37.4987496], [127.1180662, 37.4987493],
      [127.1182041, 37.4987322], [127.1182087, 37.4987311], [127.1182158, 37.4987275],
    ],
  }] satisfies NonNullable<SiteSurfaceLayout['surveyedWalks']>,
  crossings: [{
    // Crossing over the Songpa-daero 32-gil mouth, UFID ending in 14.
    start: [127.1170250, 37.4980161], end: [127.1171278, 37.4979335],
    outline: [
      [127.1170348, 37.4980489], [127.1171526, 37.4979535],
      [127.1171029, 37.4979135], [127.1170152, 37.4979834],
    ],
  }, {
    // Crossing over Yangjae-daero 60-gil, UFID ending in 15.
    start: [127.1170064, 37.4981201], end: [127.1171010, 37.4981690],
    outline: [
      [127.1170819, 37.4981918], [127.1171201, 37.4981463],
      [127.1170265, 37.4980968], [127.1169863, 37.4981434],
    ],
  }, {
    // Crossing over Songi-ro 14-gil, UFID ending in 18.
    start: [127.1170389, 37.4982880], end: [127.1170860, 37.4982310],
    outline: [
      [127.1170694, 37.4982220], [127.1170224, 37.4982789], [127.1170555, 37.4982970],
      [127.1171025, 37.4982400],
    ],
  }] satisfies NonNullable<SiteSurfaceLayout['surveyedCrossings']>,
};

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
// The exposed, lighter surface south of the canopy is visible in the same capture.
const songpaCoveredApproachFinish = {
  color: '#fff9ed',
  outline: [
    [127.1167758, 37.4981228], [127.1168214, 37.4981207], [127.1168643, 37.4980802],
    [127.1168670, 37.4980398], [127.1168536, 37.4979909], [127.1168268, 37.4979504],
    [127.1167946, 37.4979547], [127.1167758, 37.4979951], [127.1167704, 37.4980356],
    [127.1167517, 37.4980802], [127.1167570, 37.4981079],
  ],
} satisfies NonNullable<SiteSurfaceLayout['drivewayFinishes']>[number];

// The June 2026 view shows white bands alongside the block-paved apron.
// Trim the interpreted south ends to the north edge of Seoul hump 16-003565.
const songpaGateMarking = {
  start: [127.1168450, 37.4977850], end: [127.1167980, 37.4977481],
  outline: [
    [127.1168360, 37.4977930], [127.1168540, 37.4977770],
    [127.1168082, 37.4977411], [127.1167878, 37.4977552],
  ],
} satisfies NonNullable<SiteSurfaceLayout['surveyedCrossings']>[number];
const songpaGateFinish = {
  surface: 'pavers',
  color: '#e4ddd2',
  outline: [
    songpaGateNorthCorner, [127.1167882, 37.4977549], [127.1167383, 37.4977893],
    [127.1167560, 37.4978020], [127.1167810, 37.4978330],
    [127.1168050, 37.4978310], [127.1168310, 37.4978040],
  ],
} satisfies NonNullable<SiteSurfaceLayout['drivewayFinishes']>[number];

export const songpaGrounds = {
  source: 'https://www.arcgis.com/apps/mapviewer/index.html?source=sd&url=https%3A%2F%2Fserver.arcgisonline.com%2Farcgis%2Frest%2Fservices%2FWorld_Imagery%2FMapServer&center=127.11665,37.49762&level=19',
  captureDate: '2025-10-28',
  metadata: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/9/query?objectIds=480339&outFields=SRC_DATE,NICE_DESC,SRC_RES&returnGeometry=false&f=pjson',
  // The view shows shared paving beside the island. The pedestrian line within it is approximate.
  gateWalkLink: [
    [127.1167860, 37.4978220], [127.1167650, 37.4978270], [127.1167490, 37.4978020],
    [127.1167550, 37.4977780], [127.1167100, 37.4977230],
  ] satisfies Coordinate[],
  // One continuous footprint from the street mouth to the inner court.
  // Use the OpenLab road edge at the curb and trace the remaining pavement in World Imagery.
  paving: [
    ...songpaStreetEdge.slice(2).reverse(),
    ...songpaApproachEast.slice().reverse(), ...songpaApproachWest,
    songpaGateNorthCorner, ...songpaCoveredApproach, [127.1167463, 37.4977866],
    ...songpaWestDriveEdge, ...songpaEastDriveEdge, ...songpaParkingVerge.slice(1, -1),
  ] satisfies Coordinate[],
  // The white bands are visible in the 2025-10-28 World Imagery capture.
  // Trace their visible extent; the image does not identify ramps or the legal crossing type.
  markings: [{
    start: [127.1166819, 37.4977206], end: [127.1166310, 37.4976568],
    outline: [
      [127.1166712, 37.4977291], [127.1166953, 37.4977185],
      [127.1166444, 37.4976504], [127.1166202, 37.4976610],
    ],
  }, {
    start: [127.1166417, 37.4976185], end: [127.1166846, 37.4976057],
    outline: [
      [127.1166497, 37.4976312], [127.1166927, 37.4976185],
      [127.1166793, 37.4975908], [127.1166337, 37.4976036],
    ],
  }] satisfies SiteSurfaceLayout['surveyedCrossings'],
  courtFinish: {
    color: '#fffaf0',
    outline: [
      [127.1166578, 37.4977440], [127.1167141, 37.4977461], [127.1167570, 37.4977312],
      [127.1167704, 37.4977036], [127.1167570, 37.4976780], [127.1167275, 37.4976632],
      [127.1167168, 37.4976483], [127.1166766, 37.4976334], [127.1166471, 37.4976376],
      [127.1166068, 37.4976525], [127.1166283, 37.4976993],
    ],
  } satisfies NonNullable<SiteSurfaceLayout['drivewayFinishes']>[number],
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
    { id: 'inner-paving', name: '동 사이 포장 공간', coordinate: [127.1166846, 37.4976632],
      viewFrom: [127.1166363, 37.4977121], lookAt: [127.1166685, 37.4976227] },
  ] satisfies SongpaGroundView[],
};
// The beds follow canopy edges visible in the 2025-10-28 orthophoto. Crown centers are
// interpreted from the imagery; the shrubs and broadleaf tree models are representative.
export const songpaFrontage = {
  fenceSource: 'https://openlab.eseoul.go.kr/qgisplugin/SHP/N1L_B0020000.zip',
  treeSource: streetTreeArchive.source,
  // Continuous planted ground interpreted from the 2025-10-28 orthophoto.
  plantedGround: [
    [
      ...songpaParkingVerge,
      [127.1168268, 37.4976227], [127.1168402, 37.4975929],
      [127.1168295, 37.4975674], [127.1167839, 37.4975546],
    ],
    [
      [127.1169823, 37.4981185], ...songpaApproachWest.slice(1, -1), [127.1168751, 37.4978036],
      [127.1168268, 37.4978376], [127.1168590, 37.4978972], [127.1168804, 37.4979802],
      [127.1169207, 37.4981015],
    ],
    [
      [127.1168107, 37.4975802], [127.1168402, 37.4976121], [127.1168590, 37.4976653],
      [127.1169126, 37.4977164], [127.1170011, 37.4977717], [127.1170789, 37.4978313],
      [127.1171325, 37.4978781], [127.1171942, 37.4979036], [127.1172291, 37.4978845],
      [127.1172613, 37.4978440], [127.1172184, 37.4978228], [127.1171057, 37.4977632],
      [127.1169877, 37.4976972], [127.1168938, 37.4976376], [127.1169019, 37.4975951],
      [127.1168402, 37.4975674],
    ],
  ] satisfies Coordinate[][],
  // Iron fences in Seoul OpenLab N1L_B0020000, UFIDs ending with 220 and 227.
  ironFences: [
    [
      [127.1169666, 37.4981054], [127.1169765, 37.4980740], [127.1169787, 37.4980256],
      [127.1169768, 37.4980118], [127.1169748, 37.4980000], [127.1169627, 37.4979767],
      [127.1169481, 37.4979544], [127.1169180, 37.4979251], [127.1169075, 37.4979210],
    ],
    [
      [127.1175642, 37.4975203], [127.1174760, 37.4976352], [127.1173630, 37.4977689],
      [127.1173147, 37.4977450], [127.1172576, 37.4978129], [127.1172483, 37.4978220],
      [127.1172295, 37.4978300], [127.1172069, 37.4978290], [127.1172023, 37.4978287],
      [127.1171766, 37.4978128], [127.1168979, 37.4976578], [127.1168934, 37.4976548],
      [127.1168931, 37.4976543],
    ],
  ] satisfies Coordinate[][],
  beds: [{
    outline: [
      [127.1169046, 37.4981036], [127.1169341, 37.4980973], [127.1169689, 37.4980717],
      [127.1169931, 37.4980356], [127.1170253, 37.4979930], [127.1170253, 37.4979504],
      [127.1170038, 37.4979079], [127.1169636, 37.4978674], [127.1169207, 37.4978398],
      [127.1168616, 37.4978185], [127.1168268, 37.4978376], [127.1168402, 37.4978781],
      [127.1168590, 37.4979377], [127.1168831, 37.4980164], [127.1168938, 37.4980632],
    ],
    hedge: [
      [127.1169341, 37.4980760], [127.1169582, 37.4980462], [127.1169850, 37.4980058],
      [127.1170011, 37.4979717], [127.1169904, 37.4979355], [127.1169689, 37.4979015],
      [127.1169314, 37.4978674], [127.1168938, 37.4978483],
    ],
    width: 1.12, height: 0.82,
  }, {
    outline: [
      [127.1169528, 37.4977121], [127.1169797, 37.4976993], [127.1169555, 37.4976568],
      [127.1169555, 37.4976206], [127.1169153, 37.4975993], [127.1168590, 37.4975887],
      [127.1168000, 37.4975674], [127.1167973, 37.4975802], [127.1168321, 37.4976036],
      [127.1168616, 37.4976291], [127.1168938, 37.4976717],
    ],
    hedge: [
      [127.1169555, 37.4976887], [127.1169448, 37.4976546], [127.1169126, 37.4976312],
      [127.1168777, 37.4976248], [127.1168295, 37.4975993], [127.1168026, 37.4975802],
    ],
    width: 1.16, height: 0.87,
  }] satisfies NonNullable<SiteSurfaceLayout['plantingBeds']>,
  crowns: [
    [127.1169126, 37.4980845], [127.1169341, 37.4980207], [127.1169636, 37.4979802],
    [127.1169394, 37.4979249], [127.1169180, 37.4978823], [127.1168724, 37.4978525],
    [127.1169421, 37.4976887], [127.1168938, 37.4976121],
    [127.1169904, 37.4978760], [127.1169823, 37.4978504],
    [127.1170360, 37.4977696], [127.1171057, 37.4978249], [127.1171862, 37.4978653],
  ] satisfies Coordinate[],
};

// Geometry stays in the site data. The photos inform visual details separately.
export const songpaSurfaceLayout = {
  drive: { points: songpaCourtyard.apron, width: 3.8 },
  drivewayRoad: {
    roadId: 169916279,
    nodes: [1810741885, 1810741892],
    axis: [
      { nodeId: 1810741895, coordinate: [127.1168628, 37.4977471] },
      { nodeId: 1810741912, coordinate: [127.1166735, 37.4975590] },
    ],
  },
  paths: songpaCourtyard.paths,
  walkAreas: courtyardWalkArchive.walks.map(({ outline }) => outline.map(([lng, lat]): Coordinate => [lng, lat])),
  plantingBeds: songpaFrontage.beds,
  plantedGround: [...songpaFrontage.plantedGround, ...songpaCourtyard.plantedGround],
  ironFences: [...songpaFrontage.ironFences.map(points => ({ points })), ...playgroundFences],
  // The pavers and entrance style are photo references. The door placement and dimensions are illustrative.
  buildingEntries: [
    { buildingId: '55765541', wall: [127.1160945, 37.4976121], path: [127.1160462, 37.4976100], width: 3.10 },
  ],
  roadsideWalks: [
    // The June 2026 imagery shows the west sidewalk rounding the planting bed to the gate apron.
    { id: songpaEntrance.frontage.id,
      curb: [songpaPublicWalkJoin, songpaPublicWalkEnd, ...songpaApproachWest.slice(1), songpaGateNorthCorner, songpaGateWalkMerge],
      outward: -1, width: 1.55, beside: 'driveway', flushEndM: 2.2 },
    { curb: [...songpaApproachEast, ...songpaStreetEdge.slice(2)], outward: 1, width: 1.55, beside: 'driveway' },
    { curb: songpaWestDriveEdge, outward: -1, width: 1.32, beside: 'driveway' },
    { curb: songpaEastDriveEdge, outward: -1, width: 0.88, beside: 'driveway', finish: 'planted' },
  ],
  surveyedRoads: [{
    roadId: 169916276,
    nodes: [1810741902, 1810741876],
    // Seoul OpenLab N1A_A0010000; union of UFIDs ending in 20, 37, 22, 111 and 102.
    // The two ends are cut at the matching graph nodes.
    outline: [
      [127.1168234, 37.4985322], [127.1168302, 37.4985282], [127.1170086, 37.4983179],
      [127.1171106, 37.4982038], [127.1172028, 37.4980916], [127.1172457, 37.4980393],
      [127.1174664, 37.4977794], [127.1176243, 37.4975883], [127.1177463, 37.4974194],
      [127.1178497, 37.4973002], [127.1178935, 37.4972403], [127.1179012, 37.4972316],
      [127.1178268, 37.4971902], [127.1178220, 37.4971957], [127.1177706, 37.4972546],
      [127.1176208, 37.4974464], [127.1174469, 37.4976755], [127.1172610, 37.4978873],
      [127.1172299, 37.4979135], [127.1172158, 37.4979191], [127.1172015, 37.4979216],
      [127.1170812, 37.4980249], [127.1169556, 37.4981329], [127.1168890, 37.4982153],
      [127.1168668, 37.4982415], [127.1167595, 37.4983688], [127.1166903, 37.4984493],
      [127.1166869, 37.4984532], [127.1166844, 37.4984548],
    ],
    // Midpoints of cross-sections of the same pavement at the retained motor graph nodes.
    axis: [
      { nodeId: 1810741902, coordinate: [127.1167539, 37.4984935] },
      // Intersection of the measured road axes, projected inward from the shared boundary.
      { nodeId: 1810741901, coordinate: [127.1169957, 37.4982267] },
      { nodeId: 1810741885, coordinate: [127.1172184, 37.4979810] },
      { nodeId: 1810741883, coordinate: [127.1176377, 37.4974957] },
      { nodeId: 1810741876, coordinate: [127.1178640, 37.4972110] },
    ],
  }, songpaJunction.branch],
  surveyedJunctions: songiParkSurvey.pavement,
  surveyedCrossings: [...songiParkSurvey.crosswalks, ...songpaJunction.crossings, songpaGateMarking, ...songpaGrounds.markings],
  surveyedWalks: [...songiParkSurvey.sidewalks, ...songpaJunction.branchSidewalks, {
    id: songpaEntrance.frontage.surveyedWalkId,
    roadId: 169916276,
    side: -1,
    // Seoul OpenLab N1A_A0033320, UFID 1000377090304A00310000000000000001.
    outline: [
      [127.1165602, 37.4985380], [127.1164495, 37.4986665], [127.1164672, 37.4986787],
      [127.1164715, 37.4986736], [127.1165756, 37.4985501], [127.1165779, 37.4985483],
      [127.1167014, 37.4984631], [127.1167022, 37.4984625], [127.1167283, 37.4984369],
      [127.1167782, 37.4983789], [127.1169079, 37.4982252], [127.1169732, 37.4981444],
      songpaPublicWalkJoin, [127.1170119, 37.4980913], songpaPublicWalkEnd,
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
  }, {
    roadId: 169916276, side: 1,
    // East sidewalk, OpenLab N1A_A0033320 UFID ending in 22.
    outline: [
      [127.1170976, 37.4981863], [127.1170959, 37.4981909], [127.1170954, 37.4981968],
      [127.1171106, 37.4982038], [127.1172336, 37.4980541], [127.1172068, 37.4980612],
      [127.1172028, 37.4980631], [127.1171987, 37.4980659], [127.1171005, 37.4981797],
    ],
  }, {
    roadId: 169916276, side: 1,
    // East sidewalk, OpenLab N1A_A0033320 UFID ending in 25.
    outline: [
      [127.1170199, 37.4982981], [127.1170044, 37.4983032], [127.1169992, 37.4983057],
      [127.1169914, 37.4983107], [127.1169879, 37.4983131], [127.1168949, 37.4984208],
      [127.1168188, 37.4985177], [127.1168187, 37.4985230], [127.1168196, 37.4985281],
      [127.1168209, 37.4985373], [127.1168376, 37.4985647], [127.1168302, 37.4985282],
      [127.1170086, 37.4983179], [127.1170272, 37.4982971],
    ],
  }],
  playground: { outline: songpaCourtyard.playground, surface: 'rubber' },
  pavedDrive: songpaGrounds.paving,
  drivewayFinishes: [songpaGrounds.courtFinish, songpaCoveredApproachFinish, songpaGateFinish],
  drivewayJoin: songpaDrivewayJoin,
  parkingRows: songpaGrounds.parkingRows,
  vehicleGates: [songpaEntrance.main.island],
} satisfies SiteSurfaceLayout;
