import type { MultiPolygon, Polygon } from 'geojson';
import archive from '../../public/datasets/regions/songpa/school.json';

export const songpaSchool = {
  ...archive,
  geometry: archive.geometry as Polygon | MultiPolygon,
  placeId: '4183972382',
  routeId: 'singa-school',
  zoneSource: 'https://www.data.go.kr/data/15159265/fileData.do',
  associationSource: 'https://schoolzone.emac.kr/publicData/publicDataList.do',
  schoolSource: 'https://singa.sen.es.kr/12615/subMenu.do',
};
