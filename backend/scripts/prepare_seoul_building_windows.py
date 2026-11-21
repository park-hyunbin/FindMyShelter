"""Cut reusable Seoul building footprints into selected 3D tour build inputs."""

import argparse
import math
from pathlib import Path
from zipfile import ZipFile

import shapefile
from pyproj import CRS, Transformer
from shapely import orient_polygons, transform, union_all
from shapely.geometry import Point, mapping, shape

from audit_seoul_tour_coverage import read_json
from match_seoul_building_footprints import LAYER, archive_hash, write_json


TO_METRES = Transformer.from_crs(4326, 5186, always_xy=True).transform
TO_WGS84 = Transformer.from_crs(5186, 4326, always_xy=True).transform
CONTEXT_FIELDS = ['UFID', '명칭', '종류', '용도', '층수']


def region_windows(features, coverage, codes, base_radius):
    result = {}
    for code in codes:
        entry = coverage['complexes'].get(code)
        if not entry or entry['matchedTowers'] != entry['registeredTowers']:
            raise ValueError(f'{code}: full apartment footprint coverage is required for this build')
        outlines = [transform(shape(item['geometry']), TO_METRES, interleaved=False) for item in features
                    if item['properties']['kaptCode'] == code]
        if len(outlines) != entry['matchedTowers'] or not outlines:
            raise ValueError(f'{code}: inconsistent footprint inventory')
        west, south, east, north = union_all(outlines).bounds
        center = ((west + east) / 2, (south + north) / 2)
        radius = max(base_radius, math.ceil(math.hypot(east - west, north - south) / 2) + 50)
        result[code] = {'center': center, 'radius': radius, 'window': Point(center).buffer(radius), 'features': []}
    return result


def cut_context(archive, windows, official):
    if CRS.from_wkt(archive.read(f'{LAYER}.prj').decode('ascii')).to_epsg() != 5186:
        raise ValueError('The building window requires EPSG:5186 source geometry')
    extent = union_all([item['window'] for item in windows.values()]).bounds
    with archive.open(f'{LAYER}.shp') as shapes, archive.open(f'{LAYER}.shx') as offsets:
        with archive.open(f'{LAYER}.dbf') as records:
            with shapefile.Reader(shp=shapes, shx=offsets, dbf=records, encoding='cp949') as reader:
                for record in reader.iterShapeRecords(bbox=extent, fields=CONTEXT_FIELDS):
                    geometry = shape(record.shape.__geo_interface__)
                    if geometry.geom_type not in ('Polygon', 'MultiPolygon') or geometry.is_empty or not geometry.is_valid:
                        continue
                    destinations = [entry for entry in windows.values() if geometry.intersects(entry['window'])]
                    if not destinations:
                        continue
                    row = record.record
                    uid = row['UFID'].strip()
                    if not uid:
                        continue
                    tower = official.get(uid)
                    properties = tower if tower is not None else {
                        'id': uid, 'name': row['명칭'].strip() or None, 'dong': None, 'height_m': None,
                        'floors': row['층수'] if row['층수'] and row['층수'] > 0 else None,
                        'use': row['종류'].strip() or row['용도'].strip() or None, 'address': None,
                    }
                    wgs84 = orient_polygons(transform(geometry, TO_WGS84, interleaved=False))
                    feature = {'type': 'Feature', 'geometry': mapping(wgs84), 'properties': properties}
                    for entry in destinations:
                        entry['features'].append(feature)


def write_build_inputs(code, entry, output, metadata, expected_towers):
    features = sorted(entry['features'], key=lambda feature: feature['properties']['id'])
    ids = {item['properties']['id'] for item in features}
    if len(ids) != len(features) or not expected_towers <= ids:
        raise ValueError(f'{code}: duplicate IDs or lost apartment outlines during clipping')
    target = output / code
    target.mkdir(parents=True, exist_ok=True)
    source = target / 'buildings.geojson'
    write_json(source, {'type': 'FeatureCollection', 'metadata': metadata, 'features': features})
    write_json(target / 'config.json', {
        'region': f'seoul-{code.lower()}', 'kapt_code': code, 'source': str(source),
        'center_lnglat': TO_WGS84(*entry['center']), 'local_origin_xy': entry['center'],
        'radius_m': entry['radius'], 'simplify_m': 0.1, 'max_chunk_bytes': 180000,
        'output_directory': str(target / 'web'), 'require_verified': False,
        'mapping_status': 'registered_apartment_heights_joined_by_footprint_ufid',
        'provenance': metadata, 'fields': {
            'bldg_id': 'id', 'name': 'name', 'dong': 'dong', 'height_m': 'height_m',
            'floors': 'floors', 'use': 'use', 'address': 'address',
        },
    })
    print(f'{code}: {len(features):,} buildings in EPSG:5186 window, {len(expected_towers)} registered towers')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('joined_directory', type=Path)
    parser.add_argument('footprints', type=Path)
    parser.add_argument('--complex', action='append', required=True, dest='codes', metavar='KAPT_CODE')
    parser.add_argument('--radius', type=int, default=600, help='Minimum radius in metres')
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.radius <= 0:
            raise ValueError('Use a positive radius')
        joined = read_json(args.joined_directory / 'footprints.geojson')
        coverage = read_json(args.joined_directory / 'coverage.json')
        if joined['metadata'] != coverage['metadata'] or archive_hash(args.footprints) != joined['metadata']['footprintArchiveSha256']:
            raise ValueError('Footprints, coverage report and original archive must use the same source version')
        features = joined['features']
        official = {item['properties']['id']: item['properties'] for item in features}
        if len(official) != len(features):
            raise ValueError('Joined footprints have duplicate IDs')
        windows = region_windows(features, coverage, sorted(set(args.codes)), args.radius)
        with ZipFile(args.footprints) as archive:
            cut_context(archive, windows, official)
        for code, entry in windows.items():
            expected = {uid for uid, row in official.items() if row['kaptCode'] == code}
            write_build_inputs(code, entry, args.output_dir.resolve(), joined['metadata'], expected)
    except (OSError, KeyError, ValueError, shapefile.ShapefileException) as error:
        parser.exit(1, f'Seoul building window failed: {error}\n')


if __name__ == '__main__':
    main()
