"""Link the Seoul K-apt catalog to primary residential buildings in the national register."""

import argparse
import csv
import json
import re
import unicodedata
from collections import Counter, defaultdict
from contextlib import contextmanager
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from tempfile import NamedTemporaryFile
from zipfile import ZipFile

from openpyxl import load_workbook

from audit_seoul_tour_coverage import APARTMENT_TYPES, DISTRICTS, ROOT, read_json


PNU_PATTERN = re.compile(r'\d{10}[12]\d{8}', re.ASCII)
REGISTER_FILE = 'mart_djy_03.txt'
RESIDENTIAL_FIELD = '|공동주택|'.encode('utf-8')
REGISTER_FIELDS = {
    'register_id': 0, 'road_address': 6, 'dong': 22, 'primary_code': 23, 'use': 35,
    'households': 40, 'height': 42, 'floors': 43, 'approved_on': 60,
}


def street_address(value):
    value = unicodedata.normalize('NFKC', value).strip()
    value = re.sub(r'\s*\([^()]*\)\s*$', '', value)
    value = re.sub(r'^서울(?:특별시|시)?\s+', '', value)
    return ' '.join(value.split())


def number(value):
    cleaned = value.strip().replace(',', '')
    if not cleaned:
        return None
    result = Decimal(cleaned)
    if not result.is_finite() or result < 0 or result != result.to_integral_value():
        raise ValueError(f'Invalid register count: {value!r}')
    return int(result)


def read_catalog(path):
    with path.open(encoding='utf-8-sig', newline='') as stream:
        rows = csv.DictReader(stream)
        catalog = {}
        for row in rows:
            if row['시도'].strip() != '서울특별시' or row['단지분류'].strip() not in APARTMENT_TYPES:
                continue
            code = row['단지코드'].strip()
            if not code or code in catalog or row['시군구'].strip() not in DISTRICTS:
                raise ValueError(f'Invalid or duplicate catalog code {code!r}')
            catalog[code] = {
                'name': row['단지명'].strip(), 'district': row['시군구'].strip(), 'address': row['도로명주소'].strip(),
                'expectedBuildings': number(row['동수']), 'expectedHouseholds': number(row['세대수']),
            }
        return catalog


def read_parcels(path, codes):
    workbook = load_workbook(path, data_only=True, read_only=True)
    parcels = defaultdict(set)
    try:
        sheet = workbook.active
        sheet.reset_dimensions()
        rows = iter(sheet.values)
        if ('고유번호', '단지코드(kapt)') not in rows:
            raise ValueError('Missing K-apt parcel header')
        for land_id, code in rows:
            code = str(code or '').strip()
            if code not in codes:
                continue
            land_id = str(land_id or '').strip()
            if not PNU_PATTERN.fullmatch(land_id) or not land_id.startswith('11'):
                raise ValueError(f'{code}: invalid Seoul parcel number {land_id!r}')
            parcels[code].add(land_id)
    finally:
        workbook.close()
    return parcels


@contextmanager
def register_lines(path):
    if path.suffix.lower() == '.zip':
        with ZipFile(path) as archive, archive.open(REGISTER_FILE) as lines:
            yield lines
    else:
        with path.open('rb') as lines:
            yield lines


def index_register(path, parcel_ids, addresses):
    by_parcel = defaultdict(list)
    by_address = defaultdict(list)
    with register_lines(path) as lines:
        for line in lines:
            if RESIDENTIAL_FIELD not in line:
                continue
            head = line.split(b'|', 13)
            if len(head) != 14 or not head[8].startswith(b'11') or head[10] not in (b'0', b'1'):
                continue
            # PNU = legal-dong code, land category (1 land / 2 mountain), 4+4 lot digits.
            pnu = (head[8] + head[9] + (b'1' if head[10] == b'0' else b'2')
                   + head[11].zfill(4) + head[12].zfill(4)).decode('ascii')
            address = street_address(head[6].decode('utf-8'))
            if pnu not in parcel_ids and address not in addresses:
                continue
            fields = line.decode('utf-8-sig').rstrip('\r\n').split('|')
            if len(fields) != 77:
                raise ValueError(f'Unexpected register column count at {pnu}: {len(fields)}')
            row = {key: fields[index].strip() for key, index in REGISTER_FIELDS.items()}
            if row['primary_code'] != '0' or row['use'] != '공동주택':
                continue
            households = number(row['households'])
            if not households:
                continue
            height = float(row['height'] or 0)
            record = {
                'registerId': row['register_id'], 'parcel': pnu, 'address': row['road_address'],
                'dong': re.sub(r'\s+', '', row['dong']).removesuffix('동') or None,
                'households': households, 'heightM': height if 0 < height <= 1000 else None,
                'floors': number(row['floors']) or None, 'approvedOn': row['approved_on'] or None,
            }
            by_parcel[pnu].append(record)
            if address:
                by_address[address].append(record)
    return by_parcel, by_address


def link_complex(complex_, parcels, by_parcel, by_address):
    address = street_address(complex_['address'])
    candidates = [row for parcel in parcels for row in by_parcel.get(parcel, [])]
    exact_address = by_address.get(address, [])
    anchor_parcels = {row['parcel'] for row in exact_address if row['parcel'] in parcels}
    legal_dongs = {parcel[:10] for parcel in anchor_parcels}
    # Additional lots can join only where the same street address is anchored to a K-apt parcel.
    street_matches = [row for row in exact_address if row['parcel'][:10] in legal_dongs]
    expected = complex_['expectedBuildings']
    ids = {row['registerId'] for row in street_matches}
    dong_names = {row['dong'] for row in street_matches}
    registered_households = sum(row['households'] or 0 for row in street_matches)
    if not parcels:
        status = 'missing_parcel'
    elif not candidates:
        status = 'no_primary_residential_records'
    elif not street_matches:
        status = 'address_mismatch'
    elif not expected or len(street_matches) != expected:
        status = 'building_count_mismatch'
    elif '' in ids or len(ids) != expected or (expected > 1 and (None in dong_names or len(dong_names) != expected)):
        status = 'ambiguous_buildings'
    elif registered_households != complex_['expectedHouseholds']:
        status = 'household_count_mismatch'
    else:
        status = 'matched'
    return {
        **complex_, 'parcels': sorted(parcels), 'status': status, 'parcelCandidates': len(candidates),
        'streetMatches': len(street_matches), 'registeredHouseholds': registered_households if street_matches else None,
        'buildings': sorted(street_matches, key=lambda row: (row['dong'] or '', row['registerId'])) if status == 'matched' else [],
    }


def compare_tour_buildings(complex_, region, datasets):
    path = datasets / 'buildings' / region
    manifest = read_json(path / 'manifest.json')
    name = re.sub(r'\s+', '', complex_['name'])
    outlines = defaultdict(list)
    for chunk in manifest['chunks']:
        for feature in read_json(path / chunk['url'])['features']:
            properties = feature['properties']
            if re.sub(r'\s+', '', properties['name'] or '') == name and properties['dong']:
                outlines[properties['dong'].strip().removesuffix('동')].append(properties)

    matches = []
    for building in complex_['buildings']:
        named = outlines.get(building['dong'], [])
        if len(named) != 1:
            continue
        model = named[0]
        model_height, register_height = model.get('height_m'), building['heightM']
        matches.append({
            'registerId': building['registerId'], 'buildingId': model['id'], 'dong': building['dong'],
            'heightAgrees': abs(model_height - register_height) <= 0.01
            if model_height is not None and register_height is not None else None,
            'floorsAgree': model['floors'] == building['floors']
            if model.get('floors') and building['floors'] else None,
        })
    return {'region': region, 'namedOutlines': sum(map(len, outlines.values())), 'matches': matches}


def build_links(catalog_path, parcel_path, register_path, snapshot_date, register_month):
    catalog = read_catalog(catalog_path)
    parcels = read_parcels(parcel_path, catalog.keys())
    addresses = {street_address(entry['address']) for entry in catalog.values() if entry['address']}
    by_parcel, by_address = index_register(register_path, set().union(*parcels.values()), addresses)
    complexes = {code: link_complex(entry, parcels.get(code, set()), by_parcel, by_address)
                 for code, entry in sorted(catalog.items())}
    claimants = defaultdict(list)
    for code, entry in complexes.items():
        for building in entry['buildings']:
            claimants[building['registerId']].append(code)
    for codes in claimants.values():
        if len(codes) > 1:
            for code in codes:
                complexes[code].update(status='shared_register_record', buildings=[])

    for path in sorted((ROOT / 'data/config/buildings').glob('*.json')):
        config = read_json(path)
        code = config.get('kapt_code')
        if code in complexes:
            complexes[code]['scene'] = compare_tour_buildings(
                complexes[code], config['region'], ROOT / 'frontend/public/datasets',
            )
    by_district = {district: Counter() for district in DISTRICTS}
    for result in complexes.values():
        by_district[result['district']][result['status']] += 1
    return {
        'catalogSnapshotDate': snapshot_date.isoformat(), 'registerSnapshotMonth': register_month,
        'districts': by_district, 'complexes': complexes,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('catalog', type=Path)
    parser.add_argument('parcels', type=Path)
    parser.add_argument('register', type=Path, help='National title-register ZIP or extracted mart_djy_03.txt')
    parser.add_argument('--snapshot-date', type=date.fromisoformat, required=True)
    parser.add_argument('--register-month', required=True, help='Title-register month, YYYY-MM')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    temporary = None
    try:
        date.fromisoformat(f'{args.register_month}-01')
        links = build_links(args.catalog, args.parcels, args.register, args.snapshot_date, args.register_month)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with NamedTemporaryFile(mode='w', encoding='utf-8', newline='\n', dir=args.output.parent,
                                suffix='.tmp', delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(links, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
        temporary.replace(args.output)
    except (OSError, ValueError, KeyError, InvalidOperation) as error:
        parser.exit(1, f'Apartment title register link failed: {error}\n')
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    print(dict(Counter(entry['status'] for entry in links['complexes'].values())))


if __name__ == '__main__':
    main()
