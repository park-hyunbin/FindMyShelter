"""Extract exact complex matches from MOLIT sale and rental CSV snapshots."""
import argparse
import csv
import json
import re
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from unicodedata import normalize as unicode_normalize

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / 'frontend/components/data'
OUTPUT = CATALOG / 'tour-transactions.generated.json'
SCENES = CATALOG / 'seoul-scenes.generated.json'
RAW = ROOT / 'data/raw/transactions/molit'
KAPT = ROOT / 'data/processed/complexes/kapt/20261113_단지_기본정보.csv'
MAP_COMPLEXES = json.loads((ROOT / 'data/config/tour-maps/gwangju.json').read_text(encoding='utf-8'))
MOLIT_NAMES = {
    'A13816002': '동부센트레빌',
    'A12187602': '마포용강삼성래미안',
    'A13381608': '현대',
    'A13611103': '길음뉴타운1단지(래미안길음1차)',
}
EMPTY = {'', '-'}
PROVINCE_NAMES = {
    '서울': '서울특별시', '부산': '부산광역시', '대구': '대구광역시',
    '인천': '인천광역시', '광주': '광주광역시', '대전': '대전광역시',
    '울산': '울산광역시', '세종': '세종특별자치시', '경기': '경기도',
    '강원': '강원특별자치도', '충북': '충청북도', '충남': '충청남도',
    '전북': '전북특별자치도', '전남': '전라남도', '경북': '경상북도',
    '경남': '경상남도', '제주': '제주특별자치도',
}


def normalize(text):
    return ''.join(unicode_normalize('NFC', text).split()).casefold()


def complex_name(text):
    return normalize(text).removesuffix('아파트')


def address_tokens(address):
    parts = address.split()
    if parts:
        parts[0] = PROVINCE_NAMES.get(parts[0], parts[0])
    return parts


def road_key(address, name):
    parts = address_tokens(address)
    for i, part in enumerate(parts[1:], start=1):
        if part.endswith(('로', '길')) and i + 2 == len(parts) and re.fullmatch(r'\d+(?:-\d+)?', parts[-1]):
            return normalize(' '.join(parts[:i])), normalize(' '.join(parts[i:])), name
    return None


def add_key(index, key, region):
    if key in index and index[key] != region:
        index[key] = None
    else:
        index[key] = region


def build_lookup(kapt_path, scenes_path=SCENES):
    scenes = json.loads(scenes_path.read_text(encoding='utf-8'))
    by_code = {scene['kaptCode']: scene for scene in scenes}
    codes = {'A46492201': 'opo', 'A13816002': 'songpa',
             **{code: scene['id'] for code, scene in by_code.items()}}
    with kapt_path.open(encoding='utf-8-sig', newline='') as stream:
        rows = {row['단지코드']: row for row in csv.DictReader(stream) if row['단지코드'] in codes}

    parcels, roads = {}, {}
    covered_regions = []
    for code, region in codes.items():
        row, scene = rows.get(code, {}), by_code.get(code, {})
        lot = re.match(r'^(.+?) (\d+(?:-\d+)?)(?: |$)', ' '.join(address_tokens(row.get('법정동주소', ''))))
        names = {complex_name(value) for value in (row.get('단지명', ''), scene.get('name', ''), MOLIT_NAMES.get(code, '')) if value.strip()}
        has_address = bool(lot and names)
        for name in names:
            if lot:
                add_key(parcels, (normalize(lot[1]), lot[2], name), region)
            for address in (row.get('도로명주소', ''), scene.get('area', '')):
                key = road_key(address, name)
                if key:
                    has_address = True
                    add_key(roads, key, region)
        if has_address:
            covered_regions.append(region)
        else:
            print(f'{region}: transaction address unavailable; left unlinked')

    for item in MAP_COMPLEXES:
        region = item['id']
        locality = normalize(f'경기도 광주시 {item["locality"]}')
        if phases := item.get('phases'):
            for phase in phases:
                name = complex_name(phase['name'])
                add_key(parcels, (locality, phase['lot'], name), region)
                add_key(roads, road_key(f'경기도 광주시 {phase["road"]}', name), region)
        else:
            name = complex_name(item['tradeName'])
            pnu = item['pnu']
            main, sub = int(pnu[-8:-4]), int(pnu[-4:])
            lot = f'{main}-{sub}' if sub else str(main)
            add_key(parcels, (locality, lot, name), region)
            add_key(roads, road_key(item['address'], name), region)
        covered_regions.append(region)

    leel = json.loads((CATALOG / 'jamsil-leel.json').read_text(encoding='utf-8'))
    name = complex_name(leel['name'])
    locality, lot = leel['lotAddress'].rsplit(maxsplit=1)
    add_key(parcels, (normalize(locality), lot, name), 'jamsil-leel')
    add_key(roads, road_key(leel['address'], name), 'jamsil-leel')
    return [*covered_regions, 'jamsil-leel'], parcels, roads


def match_complex(record, parcels, roads):
    name = complex_name(record['단지명'])
    locality = address_tokens(record['시군구'])
    by_road = roads.get((normalize(' '.join(locality[:-1])), normalize(record['도로명']), name))
    by_lot = parcels.get((normalize(' '.join(locality)), record['번지'].strip(), name))
    if by_road and by_lot and by_road != by_lot:
        raise ValueError(f'Conflicting road and lot matches for {name} in {locality}')
    return by_lot or by_road


def extract(source, kind, lookup):
    regions, parcels, roads = lookup
    result = {region: [] for region in regions}
    phases_by_region = {item['id']: {complex_name(phase['name']): phase for phase in item['phases']}
                        for item in MAP_COMPLEXES if 'phases' in item}
    interval = None
    with source.open('rb') as prefix:
        encoding = 'utf-8-sig' if prefix.read(3) == b'\xef\xbb\xbf' else 'cp949'
    with source.open(encoding=encoding, newline='') as stream:
        for row in csv.reader(stream):
            if row and '계약일자' in row[0]:
                values = re.findall(r'\d{4}-\d{2}-\d{2}', row[0])
                if len(values) == 2:
                    interval = [date.fromisoformat(value).isoformat() for value in values]
            if {'단지명', '시군구', '번지', '도로명'}.issubset(row):
                headers = row
                break
        else:
            raise ValueError(f'Invalid transaction CSV header: {source.name}')
        price_columns = {'거래금액(만원)', '해제사유발생일'} if kind == 'sale' else {'보증금(만원)', '월세금(만원)', '전월세구분'}
        if not price_columns.issubset(headers) or not interval or interval[0] > interval[1]:
            raise ValueError(f'Missing search interval or price columns: {source.name}')
        for record in csv.DictReader(stream, fieldnames=headers):
            region = match_complex(record, parcels, roads)
            if region is None or (kind == 'sale' and record['해제사유발생일'].strip() not in EMPTY):
                continue
            transaction_kind = kind if kind == 'sale' else {'전세': 'jeonse', '월세': 'monthly'}.get(record['전월세구분'])
            if transaction_kind is None:
                raise ValueError('Unknown rental kind')
            amount_column = '거래금액(만원)' if kind == 'sale' else '보증금(만원)'
            amount = int(record[amount_column].replace(',', ''))
            monthly = int(record['월세금(만원)'].replace(',', '')) if transaction_kind == 'monthly' else None
            area = float(Decimal(record['전용면적(㎡)']))
            month = record['계약년월']
            contract_date = date(int(month[:4]), int(month[4:]), int(record['계약일'])).isoformat()
            if not interval[0] <= contract_date <= interval[1] or not 0 < area < 1000 or amount < 0 or (monthly is not None and monthly < 0):
                raise ValueError(f'Invalid contract values for {region}')
            trade = {'kind': transaction_kind, 'date': contract_date, 'area': area,
                     'amount': amount, 'monthly': monthly}
            if region in phases_by_region:
                phase = phases_by_region[region][complex_name(record['단지명'])]
                if record['번지'].strip() not in (phase['lot'], '') or normalize(record['도로명']) not in (normalize(phase['road']), ''):
                    raise ValueError(f'Conflicting address for {phase["name"]}')
                trade['phase'] = phase['label']
            result[region].append(trade)
    return tuple(interval), result


def discover(directory):
    files = {'sale': [], 'rent': []}
    for source in sorted(directory.glob('*.csv')):
        name = unicode_normalize('NFC', source.name)
        for kind, label in (('sale', '매매'), ('rent', '전월세')):
            if name.startswith(f'아파트({label})_실거래가_'):
                files[kind].append(source)
    return files


def index_periods(sources, kind, lookup):
    periods = {}
    for source in sources:
        period, records = extract(source, kind, lookup)
        if period in periods:
            raise ValueError(f'Multiple {kind} files for {period[0]}~{period[1]}; select one explicitly')
        periods[period] = records
    return periods


def combine(sales, rentals):
    if not sales or sales.keys() != rentals.keys():
        raise ValueError('Each contract period needs matching sale and rental CSVs')
    periods = sorted(sales)
    for previous, current in zip(periods, periods[1:]):
        if date.fromisoformat(current[0]) - date.fromisoformat(previous[1]) != timedelta(days=1):
            raise ValueError(f'Contract periods must be continuous without overlaps: {previous} and {current}')
    complexes = {region: [] for region in sales[periods[0]]}
    for period in periods:
        for region in complexes:
            complexes[region].extend(sales[period][region] + rentals[period][region])
    return {'startDate': periods[0][0], 'endDate': periods[-1][1], 'complexes': {
        region: sorted(records, key=lambda record: record['date'], reverse=True)
        for region, records in complexes.items()
    }}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sale', type=Path, action='append')
    parser.add_argument('--rent', type=Path, action='append')
    parser.add_argument('--directory', type=Path)
    parser.add_argument('--kapt', type=Path, default=KAPT, help='K-apt complex CSV used to verify addresses')
    parser.add_argument('--scenes', type=Path, default=SCENES, help='Registry of 3D tour scenes')
    parser.add_argument('--if-available', action='store_true', help='Keep existing output if a local source is absent')
    args = parser.parse_args()
    if (args.sale or args.rent) and (args.directory or not (args.sale and args.rent)):
        parser.error('Use --directory or pass both --sale and --rent (repeat for multiple periods)')
    sources = {'sale': args.sale, 'rent': args.rent} if args.sale else discover(args.directory or RAW)
    if args.if_available and (not args.kapt.is_file() or not sources['sale'] or not sources['rent']):
        print('Local transaction CSVs or K-apt snapshot unavailable; keeping the current transaction export.')
        return
    try:
        lookup = build_lookup(args.kapt, args.scenes)
        result = combine(index_periods(sources['sale'], 'sale', lookup), index_periods(sources['rent'], 'rent', lookup))
    except (OSError, ValueError) as exc:
        parser.exit(1, f'Transaction export failed: {exc}\n')
    temporary = OUTPUT.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(OUTPUT)
    print({region: len(records) for region, records in result['complexes'].items()})


if __name__ == '__main__':
    main()
