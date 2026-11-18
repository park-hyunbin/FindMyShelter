"""Export the public fields needed by the two existing tours from a K-apt snapshot."""
import argparse
import csv
import json
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOURS = {'opo': 'A46492201', 'songpa': 'A13816002'}
OUTPUT = ROOT / 'frontend/components/data/tour-complexes.generated.json'


def count(value):
    if not value.strip():
        return None
    number = Decimal(value.replace(',', ''))
    if not number.is_finite() or number < 0 or number != number.to_integral_value():
        raise ValueError('K-apt count must be a nonnegative integer')
    return int(number)


def summarize(row):
    chargers = [count(row[f'전기차 충전시설 설치대수({level})']) for level in ('지상', '지하')]
    flags = [row[f'전기충전기설치여부({level})'].strip() for level in ('지상', '지하')]
    amenities = [label.strip() for label in row['부대복리시설'].split(',') if label.strip()]
    return {
        'code': row['단지코드'],
        'households': count(row['세대수']),
        'parkingSpaces': count(row['총주차대수']),
        'corridorType': row['복도유형'].strip() or None,
        'playground': True if '어린이놀이터' in amenities else False if amenities == ['없음'] else None,
        'evCharging': True if '설치' in flags or any(chargers) else False if flags == ['미설치', '미설치'] else None,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--snapshot-date', type=date.fromisoformat, required=True)
    args = parser.parse_args()
    snapshots = {}
    region_by_code = {code: region for region, code in TOURS.items()}
    try:
        with args.source.open(encoding='utf-8-sig', newline='') as stream:
            for row in csv.DictReader(stream):
                region = region_by_code.get(row['단지코드'])
                if region is None:
                    continue
                if region in snapshots:
                    raise ValueError(f'Duplicate K-apt code for {region}')
                snapshots[region] = summarize(row)
        if snapshots.keys() != TOURS.keys():
            raise ValueError('Snapshot does not include all supported tour complexes')
        result = {'snapshotDate': args.snapshot_date.isoformat(),
                  'complexes': {region: snapshots[region] for region in TOURS}}
        temporary = OUTPUT.with_suffix('.json.tmp')
        temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        temporary.replace(OUTPUT)
    except (OSError, ValueError, KeyError, InvalidOperation) as exc:
        parser.exit(1, f'K-apt tour export failed: {exc}\n')


if __name__ == '__main__':
    main()
