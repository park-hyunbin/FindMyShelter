import survey from './songi-park-survey.json';
import type { SiteSurfaceLayout, SurveyedWalk } from '../opo-site-surfaces';

type Coordinate = [longitude: number, latitude: number];
const coordinate = ([longitude, latitude]: number[]): Coordinate => [longitude, latitude];
const crosswalks = survey.crosswalks.map(({ start, end, outline }) => ({
  start: coordinate(start), end: coordinate(end), outline: outline.map(coordinate),
})) satisfies NonNullable<SiteSurfaceLayout['surveyedCrossings']>;

export const songiParkSurvey = {
  pavement: survey.pavement.map(outline => outline.map(coordinate)),
  sidewalks: survey.sidewalks.map(({ roadId, outline }): SurveyedWalk => ({ roadId, side: 1, outline: outline.map(coordinate) })),
  crosswalks,
  sidewalkSource: survey.sidewalkSource,
  crosswalkSource: survey.crosswalkSource,
};

const [songiCrossing, yangjaeCrossing] = crosswalks;
export const songiParkApproach: { coordinates: Coordinate[]; confirmed: boolean }[] = [
  { coordinates: [[127.1187503, 37.5000221], [127.1187987, 37.5000239], [127.1188437, 37.5000210]], confirmed: true },
  { coordinates: [[127.1188437, 37.5000210], songiCrossing.start], confirmed: false },
  { coordinates: [songiCrossing.start, songiCrossing.end], confirmed: true },
  { coordinates: [songiCrossing.end, [127.1190659, 37.5001479]], confirmed: false },
  { coordinates: [[127.1190659, 37.5001479], [127.1190688, 37.5001819], [127.1190856, 37.5002152],
    [127.1191070, 37.5002510]], confirmed: true },
  { coordinates: [[127.1191070, 37.5002510], yangjaeCrossing.start], confirmed: false },
  { coordinates: [yangjaeCrossing.start, yangjaeCrossing.end], confirmed: true },
  { coordinates: [yangjaeCrossing.end, [127.1188305, 37.5005603]], confirmed: false },
  { coordinates: [[127.1188305, 37.5005603], [127.1187961, 37.5005663], [127.1187613, 37.5005822]], confirmed: true },
];

export const songiPark = {
  routeId: 'songi-park',
  aerialDate: '2025-10-28',
  aerialMetadata: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/9/query?objectIds=480339&outFields=SRC_DATE,NICE_DESC,SRC_RES&returnGeometry=false&f=pjson',
  groundPhotos: 'https://my-context.tistory.com/46',
  parkSource: 'https://songpa.newstool.co.kr/view.php?aid=9704&eid=8617',
  // Approximate surface and canopy positions traced from the cited aerial imagery.
  plaza: [
    [127.1187124, 37.5005487], [127.1186775, 37.5005614], [127.1186399, 37.5005955],
    [127.1186507, 37.5006359], [127.1186829, 37.5006657], [127.1187285, 37.5006700],
    [127.1187446, 37.5006870], [127.1187982, 37.5006763], [127.1188357, 37.5006572],
    [127.1188545, 37.5006295], [127.1188438, 37.5005997], [127.1188116, 37.5005657],
    [127.1187767, 37.5005487],
  ] satisfies Coordinate[],
  approachWidthM: 3.4,
  clearing: [
    [127.1186560, 37.5014232], [127.1186963, 37.5014573], [127.1187660, 37.5014764],
    [127.1188411, 37.5014509], [127.1189082, 37.5014275], [127.1189269, 37.5013828],
    [127.1189028, 37.5013317], [127.1188679, 37.5012977], [127.1188626, 37.5012296],
    [127.1188813, 37.5011807], [127.1188331, 37.5011317], [127.1187928, 37.5011487],
    [127.1187633, 37.5011913], [127.1187365, 37.5011956], [127.1186963, 37.5012360],
    [127.1186560, 37.5012637], [127.1186373, 37.5013126], [127.1186292, 37.5013743],
  ] satisfies Coordinate[],
  crowns: [
    [127.1186909, 37.5007274], [127.1187258, 37.5007934], [127.1187580, 37.5008764],
    [127.1187392, 37.5009508], [127.1186614, 37.5010104], [127.1185943, 37.5010615],
    [127.1184817, 37.5010828], [127.1184012, 37.5011636], [127.1183529, 37.5012360],
    [127.1183878, 37.5013381], [127.1184736, 37.5014020], [127.1185434, 37.5013700],
    [127.1185327, 37.5012700], [127.1184844, 37.5011977], [127.1186131, 37.5011594],
    [127.1186158, 37.5011083], [127.1186373, 37.5009445], [127.1185541, 37.5008828],
    [127.1187070, 37.5010338], [127.1187070, 37.5014041], [127.1187580, 37.5013126],
    [127.1187982, 37.5012402], [127.1190047, 37.5011253], [127.1189618, 37.5010381],
    [127.1190020, 37.5009487], [127.1189189, 37.5009253], [127.1190235, 37.5008657],
    [127.1191388, 37.5008019], [127.1191522, 37.5007168], [127.1190369, 37.5006700],
    [127.1189430, 37.5007678], [127.1190932, 37.5009040], [127.1192569, 37.5008806],
    [127.1193507, 37.5009296], [127.1194124, 37.5009849], [127.1195090, 37.5010934],
    [127.1195868, 37.5011360], [127.1196136, 37.5012360], [127.1194419, 37.5011977],
    [127.1193212, 37.5011594], [127.1191013, 37.5011551], [127.1190342, 37.5012551],
    [127.1190074, 37.5013573], [127.1189618, 37.5014509], [127.1188948, 37.5015381],
    [127.1188250, 37.5015871], [127.1187365, 37.5015403], [127.1186748, 37.5015020],
    [127.1190959, 37.5014466], [127.1191844, 37.5013254], [127.1192515, 37.5013913],
    [127.1192273, 37.5015020], [127.1193078, 37.5015403], [127.1193829, 37.5014552],
    [127.1195143, 37.5013722], [127.1195251, 37.5012871], [127.1196350, 37.5012892],
    [127.1196994, 37.5013764],
  ] satisfies Coordinate[],
  crossingView: { name: '양재대로 공원 앞 횡단보도', coordinate: [127.1191070, 37.5002510] as Coordinate, toward: yangjaeCrossing.end },
  views: [
    { name: '송이공원 남쪽 진입부', coordinate: [127.1187613, 37.5005822], toward: [127.1188250, 37.5008104] },
    { name: '송이공원 안 산책로', coordinate: [127.1188362, 37.5008228], toward: [127.1190181, 37.5008487] },
  ] satisfies { name: string; coordinate: Coordinate; toward: Coordinate }[],
};
