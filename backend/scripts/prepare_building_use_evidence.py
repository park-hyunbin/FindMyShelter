"""Join original building-use attributes to published IDs, without rewriting geometry."""

import argparse
import hashlib
import json
from pathlib import Path
from tempfile import NamedTemporaryFile

import pyogrio


ROOT = Path(__file__).resolve().parents[2]
DATASETS = ROOT / 'frontend/public/datasets/buildings'
OUTPUT = ROOT / 'frontend/components/data/building-use-evidence.generated.json'


def manifest_rows(path):
    manifest = json.loads(path.read_text(encoding='utf-8'))
    rows = {}
    for chunk in manifest['chunks']:
        collection = json.loads((path.parent / chunk['url']).read_text(encoding='utf-8'))
        for feature in collection['features']:
            row = feature['properties']
            if row['id'] in rows:
                raise ValueError(f'Duplicate published ID in {path}: {row["id"]}')
            rows[row['id']] = row
    return manifest, rows


def read_attributes(path, id_field, value_field, encoding, ids):
    # The driver filters by ID and reads only the two DBF columns. No geometry is decoded.
    if any(not identifier.isalnum() for identifier in ids):
        raise ValueError('Building IDs must be alphanumeric')
    literal_ids = ','.join(f"'{identifier}'" for identifier in sorted(ids))
    rows = pyogrio.read_dataframe(
        path, columns=[id_field, value_field], encoding=encoding, read_geometry=False,
        where=f'{id_field} IN ({literal_ids})',
    )
    source_ids = rows[id_field].astype(str)
    if source_ids.duplicated().any() or set(source_ids) != ids:
        raise ValueError(f'{path}: original IDs are duplicated or do not cover the published records')
    return {row_id: (value.strip() or None) if isinstance(value, str) else None
            for row_id, value in zip(source_ids, rows[value_field])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('songpa', type=Path, help='Original AL_D198_11710 shapefile')
    parser.add_argument('seoul', type=Path, help='Original Seoul N1A_B0010000 ZIP')
    args = parser.parse_args()
    songpa, songpa_rows = manifest_rows(DATASETS / 'songpa/manifest.json')
    if args.songpa.stem != songpa['quality']['provenance']['source_dataset']:
        raise ValueError('Use the AL_D198 snapshot identified by the Songpa manifest')
    songpa_codes = read_attributes(args.songpa, 'A0', 'A26', 'CP949', set(songpa_rows))

    checksum = hashlib.sha256()
    with args.seoul.open('rb') as archive:
        for block in iter(lambda: archive.read(1024 * 1024), b''):
            checksum.update(block)
    archive_hash = checksum.hexdigest()
    seoul_versions = {}
    seoul_ids = set()
    for path in sorted(DATASETS.glob('seoul-a*/manifest.json')):
        manifest, rows = manifest_rows(path)
        if manifest['quality']['provenance']['footprintArchiveSha256'] != archive_hash:
            raise ValueError(f'{manifest["region"]}: Seoul footprint archive hash mismatch')
        seoul_versions[manifest['region']] = manifest['version']
        # The register join replaced the map's more specific type with 공동주택.
        seoul_ids.update(row['id'] for row in rows.values() if row['use'] == '공동주택')
    seoul_kinds = read_attributes(f'/vsizip/{args.seoul.resolve()}/N1A_B0010000.dbf',
                                  'UFID', '종류', 'CP949', seoul_ids)
    temp_path = None
    try:
        with NamedTemporaryFile(mode='w', encoding='utf-8', dir=OUTPUT.parent, delete=False) as temp:
            temp_path = Path(temp.name)
            json.dump({'songpaVersion': songpa['version'], 'songpaCodes': songpa_codes,
                       'seoulVersions': seoul_versions, 'seoulKinds': seoul_kinds}, temp,
                      ensure_ascii=False, sort_keys=True, separators=(',', ':'))
            temp.write('\n')
        temp_path.replace(OUTPUT)
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
    print(f'Songpa: {len(songpa_codes)} codes; Seoul: {len(seoul_kinds)} original types across {len(seoul_versions)} scenes')


if __name__ == '__main__':
    main()
