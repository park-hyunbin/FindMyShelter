"""Join registered apartment towers to reusable Seoul building footprints."""

import argparse
import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from tempfile import NamedTemporaryFile
from zipfile import ZipFile

import shapefile
from pyproj import CRS, Transformer
from shapely import orient_polygons, transform
from shapely.geometry import mapping, shape

from audit_seoul_tour_coverage import read_json
from link_seoul_apartment_register import street_address


LAYER = 'N1A_B0010000'
SOURCE = f'https://openlab.eseoul.go.kr/qgisplugin/SHP/{LAYER}.zip'
REGISTER_SOURCE = 'https://www.hub.go.kr/portal/opn/lps/idx-lgcpt-pvsn-srvc-list.do?opnLgcptTaskSeCd=03'
FIELDS = ['종류', '용도', '주기', '층수', 'UFID', '도로명', '건물본번', '건물부번', '우편번호']
RESIDENTIAL_KINDS = {'아파트', '주상복합', '연립주택', '다세대주택'}


def archive_hash(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def address_key(address, postal_code):
    if not re.fullmatch(r'[0-9]{5}', postal_code or ''):
        return None
    match = re.fullmatch(r'\S+ (\S+) ([1-9][0-9]*)(?:-([1-9][0-9]*))?', street_address(address))
    if not match:
        return None
    road, main, sub = match.groups()
    return (road, int(main), int(sub or 0), postal_code)


def dong_name(value):
    text = unicodedata.normalize('NFKC', value or '')
    return re.sub(r'\s+', '', text).removesuffix('동').upper() or None


def geometry_records(archive, keys):
    indexed = defaultdict(list)
    with archive.open(f'{LAYER}.dbf') as columns, shapefile.Reader(dbf=columns, encoding='cp949') as reader:
        missing = set(FIELDS) - {field[0] for field in reader.fields}
        if missing:
            raise ValueError(f'Missing footprint fields: {", ".join(sorted(missing))}')
        for row in reader.iterRecords(fields=FIELDS):
            if row['종류'] not in RESIDENTIAL_KINDS or row['용도'] not in {'주택', '공동주택'}:
                continue
            key = (row['도로명'].strip(), row['건물본번'], row['건물부번'] or 0, row['우편번호'].strip())
            if key not in keys or not row['UFID'].strip():
                continue
            indexed[key].append({
                'index': row.oid, 'uid': row['UFID'].strip(), 'dong': dong_name(row['주기']),
                'floors': row['층수'] if row['층수'] and row['층수'] > 0 else None,
            })
    return indexed


def choose_footprint(building, candidates):
    if not candidates:
        return 'no_address_footprint', None
    dong = dong_name(building['dong'])
    named = [row for row in candidates if dong is not None and row['dong'] == dong]
    if len(named) > 1:
        return 'ambiguous_dong', None
    if len(named) == 1:
        return 'matched_dong', named[0]
    # For a single nameless outline, require matching registered and map floor counts too.
    if len(candidates) == 1 and candidates[0]['dong'] is None and building['singleTower']:
        candidate = candidates[0]
        if candidate['floors'] is not None and candidate['floors'] == building['floors']:
            return 'matched_single_tower', candidate
    return 'no_dong_footprint', None


def find_links(complexes, indexed):
    links = []
    owners = defaultdict(list)
    for code, complex_ in sorted(complexes.items()):
        for building in complex_['buildings']:
            key = address_key(building['address'], complex_['postalCode'])
            building_input = {**building, 'singleTower': len(complex_['buildings']) == 1}
            status, outline = choose_footprint(building_input, indexed.get(key, [])) if key else ('missing_address_key', None)
            link = {
                'kaptCode': code, 'complex': complex_['name'], 'district': complex_['district'],
                'building': building, 'status': status, 'outline': outline,
            }
            links.append(link)
            if outline is not None:
                owners[outline['uid']].append(link)
    for claimants in owners.values():
        if len(claimants) > 1:
            for link in claimants:
                link.update(outline=None, status='shared_outline')
    return links


def export_features(archive, links, crs):
    to_wgs84 = Transformer.from_crs(crs, 4326, always_xy=True).transform
    accepted = sorted((link for link in links if link['outline']), key=lambda link: link['outline']['index'])
    features = []
    with archive.open(f'{LAYER}.shp') as polygons, archive.open(f'{LAYER}.shx') as offsets:
        with shapefile.Reader(shp=polygons, shx=offsets) as reader:
            for link in accepted:
                outline, building = link['outline'], link['building']
                geometry = shape(reader.shape(outline['index']).__geo_interface__)
                if geometry.geom_type not in ('Polygon', 'MultiPolygon') or geometry.is_empty or not geometry.is_valid:
                    link.update(outline=None, status='invalid_outline')
                    continue
                wgs84 = orient_polygons(transform(geometry, to_wgs84, interleaved=False))
                features.append({
                    'type': 'Feature', 'geometry': mapping(wgs84),
                    'properties': {
                        'id': outline['uid'], 'registerId': building['registerId'], 'kaptCode': link['kaptCode'],
                        'district': link['district'], 'name': link['complex'], 'dong': building['dong'],
                        'address': building['address'], 'height_m': building['heightM'], 'floors': building['floors'],
                        'mappedFloors': outline['floors'], 'use': '공동주택', 'areaM2': round(geometry.area, 2),
                    },
                })
    return sorted(features, key=lambda item: item['properties']['id'])


def summarize(complexes, links, features):
    matched = defaultdict(list)
    by_district = defaultdict(Counter)
    for feature in features:
        matched[feature['properties']['kaptCode']].append(feature['properties'])
    for code, complex_ in complexes.items():
        counts = by_district[complex_['district']]
        counts['registeredComplexes'] += 1
        counts['registeredTowers'] += len(complex_['buildings'])
        total = len(matched[code])
        counts['complexesWithOutlines'] += total > 0
        counts['completeComplexes'] += total == len(complex_['buildings'])
        counts['matchedTowers'] += total
        counts['towersWithHeight'] += sum(row['height_m'] is not None for row in matched[code])
    return {
        'districts': dict(sorted(by_district.items())),
        'towerStatuses': Counter(link['status'] for link in links),
        'floorDisagreements': sum(row['mappedFloors'] != row['floors'] for rows in matched.values()
                                  for row in rows if row['mappedFloors'] and row['floors']),
        'complexes': {code: {'name': complex_['name'], 'district': complex_['district'],
                             'registeredTowers': len(complex_['buildings']),
                             'matchedTowers': len(matched[code])} for code, complex_ in complexes.items()},
        'review': [{key: value for key, value in link.items() if key != 'outline'} for link in links if not link['outline']],
    }


def write_json(path, value):
    temporary = None
    try:
        with NamedTemporaryFile(mode='w', encoding='utf-8', newline='\n', dir=path.parent,
                                suffix='.tmp', delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(value, stream, ensure_ascii=False, separators=(',', ':'))
            stream.write('\n')
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('register_links', type=Path)
    parser.add_argument('footprints', type=Path, help=f'Seoul {LAYER}.zip')
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    try:
        source = read_json(args.register_links)
        complexes = {code: entry for code, entry in source['complexes'].items() if entry['status'] == 'matched'}
        keys = {key for complex_ in complexes.values() for building in complex_['buildings']
                if (key := address_key(building['address'], complex_['postalCode']))}
        if not keys:
            raise ValueError('The register did not include usable building addresses and postcodes')
        with ZipFile(args.footprints) as archive:
            crs = CRS.from_wkt(archive.read(f'{LAYER}.prj').decode('ascii'))
            if crs.to_epsg() != 5186:
                raise ValueError(f'Expected EPSG:5186 footprint source, found {crs}')
            date = archive.getinfo(f'{LAYER}.shp').date_time
            links = find_links(complexes, geometry_records(archive, keys))
            features = export_features(archive, links, crs)
        summary = summarize(complexes, links, features)
        metadata = {
            'snapshotDate': source['catalogSnapshotDate'], 'registerMonth': source['registerSnapshotMonth'],
            'registerSource': REGISTER_SOURCE, 'footprintSource': SOURCE,
            'footprintArchiveSha256': archive_hash(args.footprints),
            'archiveFileDate': f'{date[0]:04}-{date[1]:02}-{date[2]:02}', 'sourceCrs': 'EPSG:5186',
        }
        args.output_dir.mkdir(parents=True, exist_ok=True)
        write_json(args.output_dir / 'footprints.geojson', {'type': 'FeatureCollection', 'metadata': metadata, 'features': features})
        write_json(args.output_dir / 'coverage.json', {'metadata': metadata, **summary})
    except (OSError, KeyError, ValueError, shapefile.ShapefileException) as error:
        parser.exit(1, f'Seoul footprint join failed: {error}\n')
    print(f'{len(features):,} matched footprints in {len(summary["districts"])} districts')


if __name__ == '__main__':
    main()
