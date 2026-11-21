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
RAW = ROOT / 'data/raw/transactions/molit'
KAPT = ROOT / 'data/processed/complexes/kapt/20261113_단지_기본정보.csv'
MOLIT_NAMES = {
    'A13816002': '동부센트레빌',
    'A12187602': '마포용강삼성래미안',
    'A13381608': '현대',
    'A13611103': '길음뉴타운1단지(래미안길음1차)',
}
EMPTY = {'', '-'}


def normalize(text):
    return ''.join(unicode_normalize('NFC', text).split()).casefold()


def complex_name(text):
    return normalize(text).removesuffix('아파트')


def build_lookup(kapt_path):
    scenes = json.loads((CATALOG / 'seoul-scenes.generated.json').read_text(encoding='utf-8'))
    codes = {'A46492201': 'opo', 'A13816002': 'songpa', **{scene['kaptCode']: scene['id'] for scene in scenes}}
    with kapt_path.open(encoding='utf-8-sig', newline='') as stream:
        rows = {row['단지코드']: row for row in csv.DictReader(stream) if row['단지코드'] in codes}

    parcels, roads = {}, {}
    for code, region in codes.items():
        if code not in rows:
            raise ValueError(f'Missing K-apt complex {code} ({region})')
        row = rows[code]
        lot = re.match(r'^(.+?) (\d+(?:-\d+)?)(?: |$)', ' '.join(row['법정동주소'].split()))
        road_address = row['도로명주소'].split(maxsplit=2)
        if not lot or len(road_address) != 3:
            raise ValueError(f'Missing K-apt lot or road address for {code} ({region})')
        names = {complex_name(row['단지명']), complex_name(MOLIT_NAMES.get(code, row['단지명']))}
        for name in names:
            parcels[normalize(lot[1]), lot[2], name] = region
            roads[normalize(' '.join(road_address[:2])), normalize(road_address[2]), name] = region

    leel = json.loads((CATALOG / 'jamsil-leel.json').read_text(encoding='utf-8'))
    _, district, road = leel['address'].split(maxsplit=2)
    roads[normalize(f'서울특별시 {district}'), normalize(road), complex_name(leel['name'])] = 'jamsil-leel'
    return [*codes.values(), 'jamsil-leel'], parcels, roads


def match_complex(record, parcels, roads):
    name = complex_name(record['단지명'])
    locality = record['시군구']
    district = normalize(' '.join(locality.split()[:2]))
    by_road = roads.get((district, normalize(record['도로명']), name))
    by_lot = parcels.get((normalize(locality), record['번지'].strip(), name))
    if by_road and by_lot and by_road != by_lot:
        raise ValueError(f'Conflicting road and lot matches for {name} in {locality}')
    return by_lot or by_road


def extract(source, kind, lookup):
    regions, parcels, roads = lookup
    result = {region: [] for region in regions}
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
            result[region].append({'kind': transaction_kind, 'date': contract_date, 'area': area,
                                   'amount': amount, 'monthly': monthly})
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
    args = parser.parse_args()
    if (args.sale or args.rent) and (args.directory or not (args.sale and args.rent)):
        parser.error('Use --directory or pass both --sale and --rent (repeat for multiple periods)')
    sources = {'sale': args.sale, 'rent': args.rent} if args.sale else discover(args.directory or RAW)
    try:
        lookup = build_lookup(args.kapt)
        result = combine(index_periods(sources['sale'], 'sale', lookup), index_periods(sources['rent'], 'rent', lookup))
    except (OSError, ValueError) as exc:
        parser.exit(1, f'Transaction export failed: {exc}\n')
    temporary = OUTPUT.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(OUTPUT)
    print({region: len(records) for region, records in result['complexes'].items()})


if __name__ == '__main__':
    main()
