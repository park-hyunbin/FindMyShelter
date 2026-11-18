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
OUTPUT = ROOT / 'frontend/components/data/tour-transactions.generated.json'
RAW = ROOT / 'data/raw/transactions/molit'
COMPLEXES = {
    'opo': ('경기도 광주시 능평동', '0917', '0000', '수레실길 7', '오포롯데캐슬포레스트'),
    'songpa': ('서울특별시 송파구 가락동', '0095', '0000', '송파대로32길 33', '동부센트레빌', '가락동부센트레빌'),
}
EMPTY = {'', '-'}


def normalize(text):
    return ''.join(text.split()).casefold()


def extract(source, kind):
    result = {region: [] for region in COMPLEXES}
    interval = None
    with source.open('rb') as prefix:
        encoding = 'utf-8-sig' if prefix.read(3) == b'\xef\xbb\xbf' else 'cp949'
    with source.open(encoding=encoding, newline='') as stream:
        for row in csv.reader(stream):
            if row and '계약일자' in row[0]:
                values = re.findall(r'\d{4}-\d{2}-\d{2}', row[0])
                if len(values) == 2:
                    interval = [date.fromisoformat(value).isoformat() for value in values]
            if {'단지명', '시군구', '본번', '부번', '도로명'}.issubset(row):
                headers = row
                break
        else:
            raise ValueError(f'Invalid transaction CSV header: {source.name}')
        price_columns = {'거래금액(만원)', '해제사유발생일'} if kind == 'sale' else {'보증금(만원)', '월세금(만원)', '전월세구분'}
        if not price_columns.issubset(headers) or not interval or interval[0] > interval[1]:
            raise ValueError(f'Missing search interval or price columns: {source.name}')
        for record in csv.DictReader(stream, fieldnames=headers):
            address = tuple(normalize((record.get(key) or '').strip()) for key in ('시군구', '본번', '부번', '도로명'))
            for region, place in COMPLEXES.items():
                if address != tuple(map(normalize, place[:4])) or normalize(record['단지명']) not in map(normalize, place[4:]):
                    continue
                if kind == 'sale' and record['해제사유발생일'].strip() not in EMPTY:
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


def index_periods(sources, kind):
    periods = {}
    for source in sources:
        period, records = extract(source, kind)
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
    complexes = {region: [] for region in COMPLEXES}
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
    args = parser.parse_args()
    if (args.sale or args.rent) and (args.directory or not (args.sale and args.rent)):
        parser.error('Use --directory or pass both --sale and --rent (repeat for multiple periods)')
    sources = {'sale': args.sale, 'rent': args.rent} if args.sale else discover(args.directory or RAW)
    try:
        result = combine(index_periods(sources['sale'], 'sale'), index_periods(sources['rent'], 'rent'))
    except (OSError, ValueError) as exc:
        parser.exit(1, f'Transaction export failed: {exc}\n')
    temporary = OUTPUT.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(OUTPUT)
    print({region: len(records) for region, records in result['complexes'].items()})


if __name__ == '__main__':
    main()
