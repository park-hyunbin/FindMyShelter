"""Measure Seoul apartment catalog and local tour coverage from a K-apt CSV snapshot."""

import argparse
import csv
import hashlib
import json
import math
import re
from collections import Counter
from datetime import date
from pathlib import Path
from tempfile import NamedTemporaryFile


ROOT = Path(__file__).resolve().parents[2]
DISTRICTS = (
    '강남구', '강동구', '강북구', '강서구', '관악구', '광진구', '구로구', '금천구', '노원구',
    '도봉구', '동대문구', '동작구', '마포구', '서대문구', '서초구', '성동구', '성북구', '송파구',
    '양천구', '영등포구', '용산구', '은평구', '종로구', '중구', '중랑구',
)
APARTMENT_TYPES = {'아파트', '주상복합', '도시형 생활주택(아파트)', '도시형 생활주택(주상복합)'}


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def registered_scene_configs(root):
    catalog = root / 'frontend/components/data/seoul-scenes.generated.json'
    scenes = {row['id'] for row in read_json(catalog)} if catalog.exists() else set()
    for path in sorted((root / 'data/config/buildings').glob('*.json')):
        config = read_json(path)
        if config.get('kapt_code') and (not config.get('catalog') or config['region'] in scenes):
            yield config


def has_route_profile(route, profiles):
    profile = profiles.get(route['id'], {})
    if not profile.get('samples'):
        return False
    path = ';'.join(f'{lon:.7f},{lat:.7f}' for segment in route['segments'] for lon, lat in segment['coordinates'])
    return profile.get('path') == path


def audit_scene(region, datasets):
    buildings = datasets / 'buildings' / region
    scene = datasets / 'regions' / region
    manifest = read_json(buildings / 'manifest.json')
    terrain = read_json(scene / 'terrain.json')
    if manifest['metadata']['local_origin_xy'] != terrain['originEPSG5186']:
        raise ValueError(f'{region}: terrain and building origins disagree')
    for filename, field in (('site.geojson', 'features'), ('environment.geojson', 'features'),
                            ('streets.json', 'roads')):
        if not read_json(scene / filename)[field]:
            raise ValueError(f'{region}: empty scene layer {filename}')

    building_ids = set()
    with_height = 0
    for chunk in manifest['chunks']:
        digest = chunk['sha256']
        if not re.fullmatch('[a-f0-9]{64}', digest) or chunk['url'] != f'chunks/{digest}.geojson':
            raise ValueError(f'{region}: chunk URL and hash disagree')
        payload = (buildings / chunk['url']).read_bytes()
        features = json.loads(payload)['features']
        if hashlib.sha256(payload).hexdigest() != digest or len(features) != chunk['count']:
            raise ValueError(f'{region}: chunk hash or feature count disagrees')
        for feature in features:
            properties = feature['properties']
            if properties['id'] in building_ids:
                raise ValueError(f'{region}: duplicate building {properties["id"]}')
            building_ids.add(properties['id'])
            height = properties.get('height_m')
            with_height += type(height) in (float, int) and math.isfinite(height) and height > 0
    if len(building_ids) != manifest['count'] or not building_ids:
        raise ValueError(f'{region}: manifest has an invalid building count')

    access_file = scene / 'access.json'
    elevation_file = scene / 'route-elevation.json'
    routes = read_json(access_file)['routes'] if access_file.exists() else []
    profiles = read_json(elevation_file)['routes'] if elevation_file.exists() else {}
    return {
        'region': region,
        'radiusM': manifest['metadata']['radius_m'],
        'buildings': len(building_ids),
        'buildingsWithHeight': with_height,
        'walkingRoutes': len(routes),
        'walkingRoutesWithElevation': sum(has_route_profile(route, profiles) for route in routes),
    }


def build_report(source, snapshot_date, root):
    catalog = {}
    types = Counter()
    with source.open(encoding='utf-8-sig', newline='') as file:
        for row in csv.DictReader(file):
            if row['시도'].strip() != '서울특별시':
                continue
            district, kind, code = (row[column].strip() for column in ('시군구', '단지분류', '단지코드'))
            types[kind or '미분류'] += 1
            if kind not in APARTMENT_TYPES:
                continue
            name = row['단지명'].strip()
            if district not in DISTRICTS or not name or not code or code in catalog:
                raise ValueError(f'Invalid or duplicate Seoul catalog entry: {district} {code} {name}')
            catalog[code] = {
                'kaptCode': code, 'district': district, 'name': name, 'type': kind,
                'address': row['도로명주소'].strip() or None, 'tour': None,
            }
    missing = set(DISTRICTS) - {entry['district'] for entry in catalog.values()}
    if missing:
        raise ValueError(f'Seoul districts missing from snapshot: {", ".join(sorted(missing))}')

    datasets = root / 'frontend/public/datasets'
    for config in registered_scene_configs(root):
        code = config['kapt_code']
        if code not in catalog or catalog[code]['tour'] is not None:
            raise ValueError(f'{config["region"]}: K-apt code {code} is absent or already linked')
        catalog[code]['tour'] = audit_scene(config['region'], datasets)

    entries = sorted(catalog.values(), key=lambda item: (item['district'], item['name'], item['kaptCode']))
    by_district = {district: {'catalog': 0, 'roadAddress': 0, 'scenes': 0, 'withWalkingRoutes': 0}
                   for district in DISTRICTS}
    for entry in entries:
        counts = by_district[entry['district']]
        counts['catalog'] += 1
        counts['roadAddress'] += entry['address'] is not None
        if entry['tour'] is not None:
            counts['scenes'] += 1
            counts['withWalkingRoutes'] += entry['tour']['walkingRoutes'] > 0
    return {
        'snapshotDate': snapshot_date.isoformat(), 'sourceCsvSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'sourceSeoulTypes': dict(sorted(types.items())), 'districts': by_district, 'complexes': entries,
    }


def public_catalog(report, register, footprints):
    metadata = footprints['metadata']
    if not (report['snapshotDate'] == register['catalogSnapshotDate'] == metadata['snapshotDate']
            and register['registerSnapshotMonth'] == metadata['registerMonth']):
        raise ValueError('Catalog, register and footprint snapshots disagree')

    records = register['complexes']
    outlines = footprints['complexes']
    if records.keys() != {entry['kaptCode'] for entry in report['complexes']}:
        raise ValueError('Catalog and register complex IDs disagree')
    if outlines.keys() != {code for code, record in records.items() if record['status'] == 'matched'}:
        raise ValueError('Matched register and footprint complex IDs disagree')

    districts = {district: {**counts, 'fullOutlines': 0, 'withRouteProfiles': 0}
                 for district, counts in report['districts'].items()}
    complexes = []
    for entry in report['complexes']:
        code, district, tour = entry['kaptCode'], entry['district'], entry['tour']
        register_row = records[code]
        footprint = outlines.get(code)
        if register_row['district'] != district or (footprint and footprint['district'] != district):
            raise ValueError(f'{code}: district disagrees across sources')
        geometry = 'register_pending'
        if footprint:
            total, matched = footprint['registeredTowers'], footprint['matchedTowers']
            if not (0 <= matched <= total == len(register_row['buildings']) and total > 0):
                raise ValueError(f'{code}: inconsistent matched tower counts')
            geometry = 'complete' if matched == total else 'partial' if matched else 'outline_pending'

        districts[district]['fullOutlines'] += geometry == 'complete'
        districts[district]['withRouteProfiles'] += bool(tour and tour['walkingRoutesWithElevation'])
        complexes.append({**entry, 'geometry': geometry})

    return {
        'snapshotDate': report['snapshotDate'], 'registerMonth': register['registerSnapshotMonth'],
        'footprintDate': metadata['archiveFileDate'], 'districts': districts, 'complexes': complexes,
    }


def write_json(output, data, compact=False):
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with NamedTemporaryFile(mode='w', encoding='utf-8', newline='\n', dir=output.parent,
                                suffix='.tmp', delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(data, stream, ensure_ascii=False, indent=None if compact else 2)
            stream.write('\n')
        temporary.replace(output)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='CSV produced by prepare_kapt_complexes.py')
    parser.add_argument('--snapshot-date', type=date.fromisoformat, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--public-output', type=Path, help='Publish combined catalog and data availability as JSON')
    parser.add_argument('--register-links', type=Path)
    parser.add_argument('--footprint-coverage', type=Path)
    args = parser.parse_args()
    if args.public_output and not (args.register_links and args.footprint_coverage):
        parser.error('--public-output requires --register-links and --footprint-coverage')
    try:
        report = build_report(args.source, args.snapshot_date, ROOT)
        if args.public_output:
            catalog = public_catalog(report, read_json(args.register_links), read_json(args.footprint_coverage))
            write_json(args.public_output, catalog, compact=True)
        write_json(args.output, report)
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(1, f'Seoul tour coverage audit failed: {error}\n')
    print(f'{len(report["districts"])} districts, {len(report["complexes"]):,} apartment complexes')


if __name__ == '__main__':
    main()
