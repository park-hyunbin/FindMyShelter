"""Link official store locations and existing map POIs to tour footprints offline."""

import argparse
import csv
from datetime import date
import json
import math
from pathlib import Path
from tempfile import NamedTemporaryFile

from pyproj import Transformer
from shapely import STRtree
from shapely.geometry import Point, shape
from shapely.ops import transform


ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'frontend/public'
WEB_DATA = ROOT / 'frontend/components/data'
PROJECT = Transformer.from_crs(4326, 5186, always_xy=True)
LICENSE_COORDINATES = Transformer.from_crs(5174, 4326, always_xy=True)
LICENSE_SOURCE = 'https://www.data.go.kr/data/15045013/fileData.do'
OSM_SOURCE = 'https://www.openstreetmap.org/copyright'
KIND = {
    '대형마트': 'supermarket', '백화점': 'department_store', '쇼핑센터': 'mall', '복합쇼핑몰': 'mall',
    '시장': 'marketplace', '전문점': 'large_retail', '그 밖의 대규모점포': 'large_retail',
}


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write_json(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    output = json.dumps(content, ensure_ascii=False, separators=(',', ':')) + '\n'
    if path.exists() and path.read_text(encoding='utf-8') == output:
        return
    with NamedTemporaryFile(dir=path.parent, mode='w', encoding='utf-8', delete=False) as file:
        file.write(output)
    Path(file.name).replace(path)


def feature(identifier, name, kind, coordinate, source, source_date, business_type=None):
    return {
        'type': 'Feature',
        'properties': {'id': identifier, 'name': name, 'category': kind, 'source': source,
                       'source_date': source_date, 'business_type': business_type},
        'geometry': {'type': 'Point', 'coordinates': [round(value, 7) for value in coordinate]},
    }


def read_licenses(path):
    with path.open(encoding='cp949', newline='') as stream:
        rows = csv.DictReader(stream)
        required = {'사업장명', '업태구분명', '상세영업상태명', '개방자치단체코드', '관리번호',
                    '좌표정보(X)', '좌표정보(Y)', '데이터갱신시점', '최종수정시점'}
        if not required.issubset(rows.fieldnames or []):
            raise ValueError('Expected the LOCALDATA large-scale retail store CSV')
        stores, snapshot = [], None
        seen = set()
        for row in rows:
            stamp = date.fromisoformat(row['데이터갱신시점'][:10]) if row['데이터갱신시점'] else None
            if stamp and (snapshot is None or stamp > snapshot):
                snapshot = stamp
            kind = KIND.get(row['업태구분명'].strip())
            name = row['사업장명'].strip()
            if row['상세영업상태명'].strip() != '정상영업' or not name or not kind:
                continue
            try:
                x, y = [float(row[f'좌표정보({axis})']) for axis in ('X', 'Y')]
            except ValueError:
                continue
            lng, lat = LICENSE_COORDINATES.transform(x, y)
            if not (124 <= lng <= 132 and 33 <= lat <= 39):
                continue
            key = f'{row["개방자치단체코드"]}-{row["관리번호"]}'
            if key in seen:
                raise ValueError(f'Duplicate retail permit: {key}')
            seen.add(key)
            stores.append((row['최종수정시점'], name, kind, lng, lat, key, row['업태구분명'].strip()))
    if snapshot is None or not stores:
        raise ValueError('Retail snapshot date or eligible store rows are missing')
    # Some permits list the same branch more than once, with identical
    # coordinates and a legal-name prefix. Retain the last modified record.
    unique = []
    names_by_location = {}
    for _, name, kind, lng, lat, key, business_type in sorted(stores, reverse=True):
        names = names_by_location.setdefault((kind, lng, lat), [])
        normalized = ''.join(character for character in name.casefold() if character.isalnum())
        if any(normalized == previous or (min(len(normalized), len(previous)) >= 5
                                          and (normalized.endswith(previous) or previous.endswith(normalized)))
               for previous in names):
            continue
        names.append(normalized)
        unique.append(feature(f'permit-{key}', name, kind, (lng, lat), 'permit', snapshot.isoformat(), business_type))
    return unique, snapshot.isoformat()


def existing_places(path):
    dataset = read_json(path)
    metadata = dataset.get('metadata', {})
    tile = metadata.get('tile_source', '').split('/planet/')[-1].split('_')[0]
    source_date = metadata.get('snapshot') or (date(int(tile[:4]), int(tile[4:6]), int(tile[6:])).isoformat()
                                               if len(tile) == 8 and tile.isdigit() else None)
    for item in dataset['features']:
        row = item['properties']
        if row['category'] in {'convenience', 'beauty'} and row.get('name') and item['geometry']['type'] == 'Point':
            yield feature(str(row['id']), row['name'], row['category'], item['geometry']['coordinates'], 'osm', source_date)


def build_region(region, places_path, stores, radius, snapshot):
    directory = PUBLIC / 'datasets/buildings' / region
    manifest = read_json(directory / 'manifest.json')
    footprints, identifiers = [], []
    for chunk in manifest['chunks']:
        for entry in read_json(directory / chunk['url'])['features']:
            polygon = shape(entry['geometry'])
            if not polygon.is_empty and polygon.is_valid:
                footprints.append(transform(PROJECT.transform, polygon))
                identifiers.append(entry['properties']['id'])
    index = STRtree(footprints)
    origin = PROJECT.transform(*manifest['metadata']['center_lnglat'])
    result = []
    for store in [*stores, *existing_places(places_path)]:
        point = Point(PROJECT.transform(*store['geometry']['coordinates']))
        if store['properties']['source'] == 'permit' and math.hypot(point.x - origin[0], point.y - origin[1]) > radius:
            continue
        # The source location must lie strictly inside one footprint. Boundary and
        # overlapping polygons remain visible as points for QGIS review.
        matches = index.query(point, predicate='within')
        building_id = identifiers[matches[0]] if len(matches) == 1 else None
        result.append({**store, 'properties': {**store['properties'], 'building_id': building_id,
                                              'match': 'point_inside' if building_id else 'unmatched'}})
    path = PUBLIC / 'datasets/retail' / f'{region}.geojson'
    write_json(path, {'type': 'FeatureCollection', 'metadata': {
        'building_version': manifest['version'], 'permit_snapshot': snapshot, 'permit_radius_m': radius,
        'sources': {'permit': LICENSE_SOURCE, 'osm': OSM_SOURCE},
    }, 'features': result})
    permits = [row for row in result if row['properties']['source'] == 'permit']
    linked = sum(row['properties']['building_id'] is not None for row in result)
    print(f'{region}: {len(result)} places, {linked} polygon links, {len(permits)} permits')
    return '/' + path.relative_to(PUBLIC).as_posix()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('permits', type=Path, help='CP949 CSV from 행정안전부_생활_대규모점포')
    parser.add_argument('--radius', type=int, default=1000, help='Permit search radius in metres')
    args = parser.parse_args()
    if not 1 <= args.radius <= 1200:
        parser.error('Radius must be within the local tour tile (1–1,200m)')
    stores, snapshot = read_licenses(args.permits)
    paths = {'opo': PUBLIC / 'opo-pois.geojson'}
    for region in ('songpa', 'jamsil-leel'):
        paths[region] = PUBLIC / 'datasets/regions' / region / 'places.geojson'
    for scene in read_json(WEB_DATA / 'seoul-scenes.generated.json'):
        context = f'neighborhoods/{scene["neighborhood"]}' if scene.get('neighborhood') else f'regions/{scene["id"]}'
        paths[scene['id']] = PUBLIC / 'datasets' / context / 'places.geojson'
    coverage = {region: build_region(region, path, stores, args.radius, snapshot) for region, path in sorted(paths.items())}
    write_json(WEB_DATA / 'retail-coverage.generated.json', coverage)


if __name__ == '__main__':
    main()
