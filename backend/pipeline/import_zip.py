"""Register a VWorld building ZIP as immutable raw data without unpacking it."""
import argparse
import hashlib
import json
import shutil
import zipfile
from pathlib import Path

import pyogrio
from .cli import ROOT, save


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--dataset', required=True)
    args = parser.parse_args()
    if not args.dataset.replace('-', '').isalnum():
        parser.error('Use an alphanumeric dataset slug')
    src = args.source.resolve()
    with zipfile.ZipFile(src) as archive:
        members = archive.infolist()
        shapes = [f for f in members if f.filename.lower().endswith('.shp')]
        if len(shapes) != 1:
            parser.error('Expected one SHP layer per archive')
        info = pyogrio.read_info(f'/vsizip/{src}')
        layer = shapes[0].filename.rsplit('.', 1)[0]
        # No extraction: ZIP paths are never used as filesystem write targets.
        total = sum(f.file_size for f in members)
    directory = ROOT / 'data/raw/buildings' / args.dataset
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / src.name
    fingerprint = sha(src)
    if target.exists():
        if sha(target) != fingerprint:
            parser.error('Same raw filename with different content; choose a new dataset version')
    else:
        temporary = target.with_suffix('.zip.tmp')
        shutil.copyfile(src, temporary)
        if sha(temporary) != fingerprint:
            parser.error('Copy checksum mismatch')
        temporary.rename(target)
    metadata = {'source_file': target.name, 'sha256': fingerprint, 'layer': layer,
                'compressed_bytes': src.stat().st_size, 'uncompressed_bytes': total,
                'features': int(info['features']), 'crs': info['crs'],
                'bounds': list(info['total_bounds']), 'fields': list(info['fields']),
                'note': 'Archive part number is not a region code. Coverage must be queried spatially.',
                'height_policy': 'NMLY is floors, not metres; no automatic height inference'}
    save(directory / (target.stem + '.inventory.json'), metadata)
    print(json.dumps({'raw': str(target.relative_to(ROOT)), **metadata}, ensure_ascii=False))


if __name__ == '__main__':
    main()
