"""Build compact, north-up exploration maps from the existing tour GIS snapshots."""
import argparse
import csv
import json
from pathlib import Path

import pyogrio
from pyproj import Transformer
from shapely import make_valid, union_all
from shapely.geometry import Polygon, box, mapping, shape
from shapely.ops import transform

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'frontend/public'
DATA = ROOT / 'frontend/components/data'
OUTPUT = PUBLIC / 'datasets/tour-maps'
PROJECT = Transformer.from_crs(4326, 5186, always_xy=True).transform
UNPROJECT = Transformer.from_crs(5186, 4326, always_xy=True).transform
CONFIG = ROOT / 'data/config/tour-maps'
GWANGJU = CONFIG / 'gwangju.json'
KAPT = ROOT / 'data/processed/complexes/kapt/20261113_단지_기본정보.csv'
REGISTER = ROOT / 'data/archive/previous-gwangju/apartments_qgis_review.gpkg'
WIDTH, HEIGHT = 900, 600
AREAS = (
    ('opo', '경기 광주 · 오포권', {'opo': '오포 롯데캐슬'}),
    ('songpa', '서울 · 송파', {
        'songpa': '동부센트레빌', 'seoul-a13880407': '가락금호',
        'jamsil-leel': '잠실 르엘', 'seoul-a13822004': '잠실엘스',
        'seoul-a13820007': '문정시영',
    }),
    ('mapo', '서울 · 마포', {'seoul-a12187501': '마포리버웰', 'seoul-a12187602': '용강래미안'}),
    ('seongdong', '서울 · 성동', {'seoul-a13305006': '왕십리삼성', 'seoul-a13381608': '청계현대'}),
    ('seongbuk', '서울 · 성북', {'seoul-a10023926': '롯데캐슬클라시아', 'seoul-a13611103': '래미안길음1차'}),
)
MAJOR_ROADS = {'trunk', 'primary', 'secondary', 'tertiary'}
SEOUL_SUBAREAS = (
    ('garak', '가락동', ('songpa', 'seoul-a13880407'), ('가락',)),
    ('jamsil', '잠실·신천', ('jamsil-leel', 'seoul-a13822004'), ('잠실', '잠실동', '신천동')),
    ('munjeong', '문정동', ('seoul-a13820007',), ('문정',)),
)
GWANGJU_SUBAREAS = (('neungpyeong', '능평동'), ('sinhyeon', '신현동'), ('yangbeol', '양벌동'))


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')


def site_boundary(region):
    path = PUBLIC / ('opo-site.geojson' if region == 'opo' else f'datasets/regions/{region}/site.geojson')
    boundary = [project(feature) for feature in read(path)['features'] if feature['properties']['kind'] == 'boundary']
    if not boundary:
        raise ValueError(f'Missing site boundary for {region}')
    return union_all(boundary)


def environment_path(region, scenes):
    if region == 'opo':
        return PUBLIC / 'opo-environment.geojson'
    neighborhood = scenes.get(region, {}).get('neighborhood')
    prefix = f'neighborhoods/{neighborhood}' if neighborhood else f'regions/{region}'
    return PUBLIC / 'datasets' / prefix / 'environment.geojson'


def project(feature):
    return make_valid(transform(PROJECT, shape(feature['geometry'])))


def parts(geom, kind):
    if geom.geom_type == kind and not geom.is_empty:
        yield geom
    elif hasattr(geom, 'geoms'):
        for child in geom.geoms:
            yield from parts(child, kind)


def layer_for(properties):
    kind, category = properties['kind'], properties.get('category')
    if properties.get('brunnel') == 'tunnel':
        return None
    if kind == 'road':
        return 'major' if category in MAJOR_ROADS else 'minor' if category == 'minor' else None
    if kind == 'water' and category != 'swimming_pool':
        return 'water'
    if kind == 'green' and properties.get('subclass') != 'golf_course':
        return 'green'
    if kind == 'stream':
        return 'stream'
    return None


def build_map(area, labels, scenes, added_sites=None, added_footprints=None, backdrop=None):
    added_sites = added_sites or {}
    sites = {region: added_sites[region] if region in added_sites else site_boundary(region) for region in labels}
    min_x, min_y, max_x, max_y = union_all(list(sites.values())).bounds
    center_x, center_y = (min_x + max_x) / 2, (min_y + max_y) / 2
    metres_per_unit = max((max_x - min_x + 950) / WIDTH, (max_y - min_y + 950) / HEIGHT, 1.85)
    left, top = center_x - WIDTH * metres_per_unit / 2, center_y + HEIGHT * metres_per_unit / 2
    window = box(left, top - HEIGHT * metres_per_unit, left + WIDTH * metres_per_unit, top)

    def position(x, y):
        return [round((x - left) / metres_per_unit, 1), round((top - y) / metres_per_unit, 1)]

    def path(coords, closed=False):
        points = [','.join(map(str, position(x, y))) for x, y in coords]
        return 'M' + 'L'.join(points[:-1] if closed else points) + ('Z' if closed else '')

    geometries = {layer: set() for layer in ('green', 'water', 'stream', 'minor', 'major')}
    sources = [backdrop] if backdrop else sorted({environment_path(region, scenes) for region in labels})
    backdrop_source = None
    for source in sources:
        snapshot = read(source)
        if backdrop:
            backdrop_source = snapshot['metadata']['tile_source']
        for feature in snapshot['features']:
            layer = layer_for(feature['properties'])
            if layer:
                geom = project(feature).intersection(window)
                if not geom.is_empty:
                    geometries[layer].add(geom)

    layers = {}
    for layer, items in geometries.items():
        combined = union_all(sorted(items, key=lambda geom: geom.wkb)).simplify(
            metres_per_unit * .7, preserve_topology=True
        )
        if layer in ('green', 'water'):
            layers[layer] = ''.join(
                path(poly.exterior.coords, True) + ''.join(path(ring.coords, True) for ring in poly.interiors)
                for poly in parts(combined, 'Polygon') if poly.area >= 120
            )
        else:
            layers[layer] = ''.join(path(line.coords) for line in parts(combined, 'LineString') if line.length >= 8)

    markers = {}
    for region, site in sites.items():
        point = site.representative_point()
        markers[region] = position(point.x, point.y)
    layers['sites'] = ''.join(path(poly.exterior.coords, True) for site in sites.values() for poly in parts(site, 'Polygon'))
    sites_by_region = {region: ''.join(
        path(poly.exterior.coords, True) + ''.join(path(ring.coords, True) for ring in poly.interiors)
        for poly in parts(site, 'Polygon')
    ) for region, site in sites.items()}
    result = {'area': area, 'width': WIDTH, 'height': HEIGHT, 'metresPerUnit': metres_per_unit,
            'markers': markers, 'layers': layers, 'sitesByRegion': sites_by_region}
    footprints = {region: ''.join(path(poly.exterior.coords, True) +
                                  ''.join(path(ring.coords, True) for ring in poly.interiors)
                                  for poly in parts(footprint, 'Polygon'))
                  for region, footprint in (added_footprints or {}).items() if region in labels}
    if footprints:
        result['footprintsByRegion'] = footprints
    if backdrop_source:
        result['backdropSource'] = backdrop_source
    return result


def gwangju_geometry(complexes, register, kapt):
    with kapt.open(encoding='utf-8-sig', newline='') as stream:
        facts = {row['단지코드']: row for row in csv.DictReader(stream)}
    buildings = pyogrio.read_dataframe(register, columns=['A1', 'A2', 'A13', 'A14', 'A16', 'A26']).to_crs(5186)
    osm = read(CONFIG / 'woobang-osm.json')
    elements = {element['id']: element for element in osm['elements']}

    def osm_polygon(element):
        return transform(PROJECT, Polygon([(p['lon'], p['lat']) for p in element['geometry']]))

    sites, footprints, features, catalog = {}, {}, [], []
    for item in complexes:
        region, code = item['id'], item['kaptCode']
        expected = int(facts[code]['동수'])
        if 'phases' in item:
            outlines = [osm_polygon(elements[phase['osmBoundary']]) for phase in item['phases']]
            for phase, boundary in zip(item['phases'], outlines):
                feature = elements[phase['osmBoundary']]
                if phase['name'] not in feature['tags']['name']:
                    raise ValueError(f'OSM site name mismatch: {phase["name"]}')
                features.append({'type': 'Feature', 'geometry': mapping(transform(UNPROJECT, boundary)),
                                 'properties': {'id': region, 'kaptCode': code, 'kind': 'mapped-site',
                                                'phase': phase['label'], 'sourceId': feature['id'],
                                                'source': 'OpenStreetMap', 'snapshot': osm['snapshot']}})
            sites[region] = union_all(outlines)
            rows = [(geom, str(element['id']), element['tags']['name'], 'OpenStreetMap', osm['snapshot'])
                    for element in elements.values() if element['tags'].get('building') == 'apartments'
                    and sites[region].covers((geom := osm_polygon(element)))]
            if not rows or len(rows) > expected or len({row[2] for row in rows}) != len(rows):
                raise ValueError(f'Invalid apartment footprint matches for {region}')
        else:
            if item['address'] != facts[code]['도로명주소']:
                raise ValueError(f'K-apt street address changed for {region}')
            matching = buildings[(buildings.A2 == item['pnu']) & (buildings.A13 == item['registerName'])
                                 & (buildings.A26 == '02001') & (buildings.A16 == '주건축물')]
            if len(matching) != expected or matching.A14.nunique() != expected:
                raise ValueError(f'Register and K-apt tower count mismatch for {region}')
            rows = [(row.geometry, row.A1, row.A14, 'AL_D198_41610', '2026-07-15') for row in matching.itertuples()]
        if any(not geom.is_valid or geom.is_empty for geom, *_ in rows):
            raise ValueError(f'Invalid building polygon for {region}')
        footprints[region] = union_all([row[0] for row in rows])
        if region not in sites:
            sites[region] = footprints[region]
        point = transform(UNPROJECT, sites[region].representative_point())
        phases = item.get('phases', [])
        keywords = ' '.join([item['keywords'], item['locality'],
                             *(f'{phase["name"]} {phase["road"]} {phase["lot"]}' for phase in phases)])
        catalog.append({key: item[key] for key in ('id', 'kaptCode', 'name', 'address', 'locality')} |
                       {'coordinates': [point.x, point.y], 'mappedTowers': len(rows), 'towerCount': expected,
                        'keywords': keywords, 'phases': [phase['label'] for phase in phases]})
        for geom, source_id, tower, source, date in rows:
            features.append({'type': 'Feature', 'geometry': mapping(transform(UNPROJECT, geom)),
                             'properties': {'id': region, 'kaptCode': code, 'kind': 'building',
                                            'tower': tower, 'sourceId': source_id, 'source': source, 'snapshot': date}})
    return sites, footprints, features, catalog


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--gwangju-environment', type=Path)
    parser.add_argument('--gwangju-register', type=Path, default=REGISTER)
    parser.add_argument('--kapt', type=Path, default=KAPT)
    args = parser.parse_args()
    scenes = {scene['id']: scene for scene in read(DATA / 'seoul-scenes.generated.json')}
    complexes = read(GWANGJU)
    sites, footprints = {}, {}
    OUTPUT.mkdir(parents=True, exist_ok=True)
    if args.gwangju_environment:
        sites, footprints, features, catalog = gwangju_geometry(complexes, args.gwangju_register, args.kapt)
        write(DATA / 'gwangju-map-complexes.generated.json', catalog)
        write(OUTPUT / 'gwangju-buildings.geojson', {'type': 'FeatureCollection', 'features': features})
    profiles = []

    def add(area, name, labels, group, label, aliases=(), parent=None):
        is_gwangju = group == '경기도 광주시'
        if not is_gwangju or args.gwangju_environment:
            write(OUTPUT / f'{area}.json', build_map(area, labels, scenes, sites, footprints,
                                                     args.gwangju_environment if is_gwangju else None))
        profiles.append({'id': area, 'name': name, 'group': group, 'label': label, 'aliases': aliases,
                         'parent': parent,
                         'villages': [{'id': region, 'label': title} for region, title in labels.items()]})

    for area, name, labels in AREAS:
        if area == 'opo':
            gwangju = {item['id']: item['label'] for item in complexes}
            add(area, name, labels | gwangju, '경기도 광주시', '오포권 전체', ('경기 광주', '오포읍', '광주 전체'))
            for town, locality in GWANGJU_SUBAREAS:
                local = labels.copy() if town == 'neungpyeong' else {}
                local.update({item['id']: item['label'] for item in complexes if item['locality'] == locality})
                add(town, f'경기 광주 · {locality}', local, '경기도 광주시', locality,
                    ('경기 광주 ' + locality, '오포 ' + locality), 'opo')
        else:
            district = name.split(' · ')[-1]
            add(area, name, labels, '서울특별시', district + '구', ('서울 ' + district,))
            if area == 'songpa':
                for subarea, locality, ids, aliases in SEOUL_SUBAREAS:
                    add(subarea, f'서울 송파 · {locality}', {key: labels[key] for key in ids},
                        '서울특별시 송파구', locality, (*aliases, f'송파 {locality}'), area)
    write(DATA / 'tour-map-areas.generated.json', profiles)


if __name__ == '__main__':
    main()
