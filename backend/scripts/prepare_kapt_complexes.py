"""Convert a K-apt basic information workbook to a local UTF-8 CSV snapshot."""

import argparse
import csv
from pathlib import Path
from tempfile import NamedTemporaryFile

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / 'data/processed/complexes/kapt'
REQUIRED = {'단지코드', '단지명', '도로명주소'}


def export(source, target):
    workbook = load_workbook(source, read_only=True, data_only=True)
    temporary = None
    try:
        sheet = workbook.active
        sheet.reset_dimensions()
        rows = enumerate(sheet.values, 1)
        for _, row in rows:
            if REQUIRED.issubset(row):
                headers = list(row)
                while headers[-1] is None:
                    headers.pop()
                break
        else:
            raise ValueError('단지코드·단지명·도로명주소가 있는 헤더를 찾지 못했습니다.')
        if any(not header for header in headers) or len(headers) != len(set(headers)):
            raise ValueError('헤더가 비어 있거나 중복됩니다.')
        key_column = headers.index('단지코드')
        ids = set()
        target.parent.mkdir(parents=True, exist_ok=True)
        with NamedTemporaryFile(mode='w', encoding='utf-8-sig', newline='',
                                dir=target.parent, suffix='.tmp', delete=False) as stream:
            temporary = Path(stream.name)
            writer = csv.writer(stream)
            writer.writerow(headers)
            for row_number, row in rows:
                if not any(value not in ('', None) for value in row):
                    continue
                if any(value not in ('', None) for value in row[len(headers):]):
                    raise ValueError(f'{row_number}행에 헤더 범위 밖 값이 있습니다.')
                record = list(row[:len(headers)])
                record.extend([None] * (len(headers) - len(record)))
                key = str(record[key_column] or '').strip()
                if not key or key in ids:
                    raise ValueError(f'{row_number}행에 단지코드가 없거나 중복됩니다.')
                ids.add(key)
                record[key_column] = key
                writer.writerow(record)
        if not ids:
            raise ValueError('단지 정보 행이 없습니다.')
        temporary.replace(target)
        return len(ids), len(headers)
    finally:
        workbook.close()
        if temporary:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    args = parser.parse_args()
    target = OUTPUT_DIR / f'{args.source.stem}.csv'
    try:
        rows, columns = export(args.source, target)
    except (OSError, ValueError) as exc:
        parser.exit(1, f'K-apt CSV 변환 실패: {exc}\n')
    print(f'{target}\n{rows:,}개 단지 · {columns}개 칼럼')


if __name__ == '__main__':
    main()
