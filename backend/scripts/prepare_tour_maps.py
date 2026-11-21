"""Build compact, north-up exploration maps from the existing tour GIS snapshots."""
import json
from pathlib import Path

from pyproj import Transformer
from shapely import make_valid, union_all
from shapely.geometry import box, shape
from shapely.ops import transform

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'frontend/public'
DATA = ROOT / 'frontend/components/data'
OUTPUT = PUBLIC / 'datasets/tour-maps'
PROJECT = Transformer.from_crs(4326, 5186, always_xy=True).transform
WIDTH, HEIGHT = 900, 600
AREAS = (
    ('opo', '경기 광주 · 오포', {'opo': '오포 롯데캐슬'}),
    ('songpa', '서울 · 송파', {
        'songpa': '동부센트레빌', 'seoul-a13880407': '가락금호',
        'jamsil-leel': '잠실 르엘', 'seoul-a13822004': '잠실엘스',
    }),
    ('mapo', '서울 · 마포', {'seoul-a12187501': '마포리버웰', 'seoul-a12187602': '용강래미안'}),
    ('seongdong', '서울 · 성동', {'seoul-a13305006': '왕십리삼성', 'seoul-a13381608': '청계현대'}),
    ('seongbuk', '서울 · 성북', {'seoul-a10023926': '롯데캐슬클라시아', 'seoul-a13611103': '래미안길음1차'}),
)
MAJOR_ROADS = {'trunk', 'primary', 'secondary', 'tertiary'}


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


def build_map(area, labels, scenes):
    sites = {region: site_boundary(region) for region in labels}
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
    for source in sorted({environment_path(region, scenes) for region in labels}):
        for feature in read(source)['features']:
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
    return {'area': area, 'width': WIDTH, 'height': HEIGHT, 'metresPerUnit': metres_per_unit,
            'markers': markers, 'layers': layers}


def main():
    scenes = {scene['id']: scene for scene in read(DATA / 'seoul-scenes.generated.json')}
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for area, name, labels in AREAS:
        write(OUTPUT / f'{area}.json', build_map(area, labels, scenes))
        print(f'{name}: {len(labels)}개 단지, {(OUTPUT / f"{area}.json").stat().st_size:,} bytes')
    write(DATA / 'tour-map-areas.generated.json', [
        {'id': area, 'name': name, 'villages': [{'id': region, 'label': label} for region, label in labels.items()]}
        for area, name, labels in AREAS
    ])


if __name__ == '__main__':
    main()
