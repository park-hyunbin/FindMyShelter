"""Local, repeatable GIS -> QGIS -> static web pipeline. No network requests."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path

import geopandas as gpd
import pandas as pd
import pyogrio
from pyogrio.errors import DataSourceError
from shapely.geometry import Point, mapping

ROOT = Path(__file__).resolve().parents[2]
FIELDS = ['bldg_id', 'name', 'dong', 'address', 'height_m', 'floors', 'use',
          'rev_status', 'rev_note', 'rev_date']


def path(value):
    return ROOT / value


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def save(target, value):
    """Atomic replacement; unchanged files retain modification times and cache keys."""
    target = Path(target)
    payload = encode(value)
    if target.exists() and target.read_bytes() == payload:
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix(target.suffix + '.tmp')
    temp.write_bytes(payload)
    os.replace(temp, target)


def config(file):
    c = json.loads(Path(file).read_text())
    if not c['region'].replace('-', '').replace('_', '').isalnum():
        raise ValueError('region must be an alphanumeric slug')
    return c


def read(c):
    kwargs = {'engine': 'pyogrio'}
    if c.get('source_layer'):
        kwargs['layer'] = c['source_layer']
    if c.get('encoding'):
        kwargs['encoding'] = c['encoding']
    # Read only a local window using the source spatial filter, not a national frame.
    if c.get('center_lnglat') and c.get('radius_m'):
        info = pyogrio.read_info(path(c['source']), layer=c.get('source_layer'))
        if not info['crs']:
            raise ValueError('Source CRS missing; assign the correct CRS in QGIS first')
        center = gpd.GeoSeries([Point(c['center_lnglat'])], crs=4326).to_crs(5186)
        window = gpd.GeoSeries([center.iloc[0].buffer(c['radius_m'])], crs=5186)
        kwargs['bbox'] = tuple(window.to_crs(info['crs']).total_bounds)
    frame = gpd.read_file(path(c['source']), **kwargs)
    if frame.crs is None:
        raise ValueError('Source CRS missing')
    frame = frame.to_crs(5186)
    if c.get('center_lnglat') and c.get('radius_m'):
        center = gpd.GeoSeries([Point(c['center_lnglat'])], crs=4326).to_crs(5186).iloc[0]
        frame = frame.loc[frame.geometry.intersects(center.buffer(c['radius_m']))].copy()
    return frame


def inspect(c):
    frame = read(c)
    result = {'region': c['region'], 'crs': str(frame.crs), 'selected_count': len(frame),
              'geometry_types': frame.geom_type.value_counts().to_dict(),
              'columns': {col: {'dtype': str(frame[col].dtype), 'nulls': int(frame[col].isna().sum()),
                               'examples': [str(v) for v in frame[col].dropna().head(3)]}
                          for col in frame.columns if col != frame.geometry.name}}
    save(path(f"data/processed/buildings/{c['region']}/inventory.json"), result)
    print(json.dumps(result, ensure_ascii=False, indent=2))


def normalize(c, frame):
    result = gpd.GeoDataFrame(geometry=frame.geometry.copy(), crs=5186)
    for field in FIELDS:
        source = c['fields'].get(field)
        if source and source not in frame.columns:
            raise ValueError(f'Mapped column missing: {field} -> {source}')
        result[field] = frame[source] if source else None
    if result.bldg_id.isna().any():
        raise ValueError('Stable source building ID is required; row numbers are not identifiers')
    result['bldg_id'] = result.bldg_id.astype(str)
    if 'rev_status' not in c['fields']:
        result['rev_status'] = 'pending'
    return result


def validate(frame):
    errors = []
    if not len(frame):
        errors.append('No polygons in selection')
    for field in FIELDS:
        if field not in frame:
            errors.append(f'Missing column: {field}')
    if errors:
        return errors, {}
    ids = frame.bldg_id
    if ids.isna().any() or ids.astype(str).str.strip().eq('').any() or ids.duplicated().any():
        errors.append('Missing/blank/duplicate bldg_id')
    bad = frame.geometry.isna() | frame.geometry.is_empty | ~frame.geometry.is_valid | ~frame.geom_type.isin(['Polygon', 'MultiPolygon'])
    if bad.any():
        errors.append(f'Invalid/empty/non-polygon geometry: {int(bad.sum())}; fix in QGIS')
    for field, limit in [('height_m', 500), ('floors', 150)]:
        raw = frame[field]
        values = pd.to_numeric(raw, errors='coerce')
        invalid = (raw.notna() & values.isna()) | (values.notna() & (~values.map(lambda v: math.isfinite(v)) | (values < 0) | (values > limit)))
        if field == 'floors':
            invalid |= values.notna() & (values % 1 != 0)
        if invalid.any():
            errors.append(f'{field}: invalid values at {list(ids[invalid].astype(str).head(8))}')
        frame[field] = values.mask(values == 0)  # Unknown remains null; never infer from floors.
    if not frame.rev_status.isin(['pending', 'edited', 'verified']).all():
        errors.append('rev_status must be pending, edited or verified')
    verified = frame.rev_status.eq('verified')
    dates = pd.to_datetime(frame.rev_date, format='%Y-%m-%d', errors='coerce')
    if (verified & (frame.rev_note.fillna('').str.strip().eq('') | dates.isna())).any():
        errors.append('verified requires rev_note and a valid YYYY-MM-DD rev_date')
    gaps = {f'missing_{f}': int((frame[f].isna() | frame[f].astype(str).str.strip().eq('')).sum())
            for f in ['height_m', 'floors', 'name', 'dong', 'address', 'use']}
    gaps['review_status'] = frame.rev_status.value_counts().to_dict()
    return errors, gaps


def working(c):
    return path(f"data/working/buildings/{c['region']}/buildings.gpkg")


def init(c):
    target = working(c)
    if target.exists():
        raise ValueError(f'QGIS file already exists; preserved: {target}. Use a new region/version for reimport.')
    frame = normalize(c, read(c))
    errors, gaps = validate(frame)
    if errors:
        raise ValueError('; '.join(errors))
    target.parent.mkdir(parents=True, exist_ok=True)
    frame.to_file(target, layer='buildings', driver='GPKG', engine='pyogrio')
    baseline = {'ids': sorted(frame.bldg_id.astype(str)), 'config': c, 'gaps': gaps}
    save(target.parent / 'import.json', baseline)
    print(f'QGIS: {target}\n{len(frame)} polygons; {gaps}')


def check(c):
    target = working(c)
    frame = gpd.read_file(target, layer='buildings', engine='pyogrio').to_crs(5186)
    errors, gaps = validate(frame)
    baseline = json.loads((target.parent / 'import.json').read_text())
    if baseline['config'] != c:
        errors.append('Config changed since import. Create a new region/version; do not silently reinterpret QGIS work.')
    if 'bldg_id' in frame and sorted(frame.bldg_id.astype(str)) != baseline['ids']:
        errors.append('IDs added/deleted/changed since import; reimport explicitly as a new region/version')
    report = {'region': c['region'], 'count': len(frame), 'errors': errors, 'gaps': gaps,
              'source': c['source'], 'provenance': c.get('provenance', {}),
              'height_policy': 'null/zero -> flat; no floor-based inferred height',
              'mapping_status': c.get('mapping_status', 'unverified')}
    save(path(f"data/processed/buildings/{c['region']}/quality.json"), report)
    if errors:
        raise ValueError('; '.join(errors))
    return frame, report


def build(c):
    frame, report = check(c)
    if c.get('require_verified') and not frame.rev_status.eq('verified').all():
        raise ValueError('Release requires all records verified in QGIS')
    frame = frame.sort_values('bldg_id').reset_index(drop=True)
    origin = c.get('local_origin_xy')
    if origin is None:
        origin = list(gpd.GeoSeries([Point(c['center_lnglat'])], crs=4326).to_crs(5186).iloc[0].coords[0])
    center = gpd.GeoSeries([Point(origin)], crs=5186).to_crs(4326).iloc[0]
    # Simplification affects the web copy only; canonical QGIS geometry is untouched.
    tolerance = c.get('simplify_m', 0.1)
    if not 0 <= tolerance <= 1:
        raise ValueError('simplify_m must be between 0 and 1 metre')
    simplified = frame.geometry.simplify(tolerance, preserve_topology=True)
    relative = (simplified.area - frame.area).abs() / frame.area.clip(lower=0.01)
    frame['geometry'] = simplified.where(relative <= 0.01, frame.geometry)
    wgs = frame.to_crs(4326)
    features = []
    for i, row in frame.iterrows():
        props = {field: (None if pd.isna(row[field]) else row[field]) for field in FIELDS if field != 'bldg_id'}
        props['id'] = str(row.bldg_id)
        props['review_status'] = props.pop('rev_status')
        props.pop('rev_note'); props.pop('rev_date')  # Keep manual evidence in canonical data, not every client request.
        features.append({'type': 'Feature', 'geometry': mapping(wgs.geometry.iloc[i]), 'properties': props})
    output = path(f"frontend/public/datasets/buildings/{c['region']}")
    max_bytes = c.get('max_chunk_bytes', 180000)
    if not 10000 <= max_bytes <= 1000000:
        raise ValueError('max_chunk_bytes must be 10000..1000000')
    # Spatial grid + recursive byte cap. Whole polygons assigned by centroid, never clipped.
    buckets = {}
    for i, shape in enumerate(frame.geometry):
        key = (math.floor(shape.centroid.x / 250), math.floor(shape.centroid.y / 250))
        buckets.setdefault(key, []).append(features[i])
    chunks = []

    def emit(items):
        collection = {'type': 'FeatureCollection', 'features': items}
        payload = encode(collection)
        if len(payload) > max_bytes:
            if len(items) == 1:
                raise ValueError(f'Polygon exceeds byte budget: {items[0]["properties"]["id"]}')
            half = len(items) // 2
            emit(items[:half]); emit(items[half:]); return
        key = digest(payload)
        file = f'chunks/{key}.geojson'
        # Avoid a second GeoDataFrame decode: bounds from nested coordinate pairs.
        def pairs(node):
            if isinstance(node[0], (int, float)):
                yield node
            else:
                for part in node:
                    yield from pairs(part)
        coords = [xy for f in items for xy in pairs(f['geometry']['coordinates'])]
        chunks.append({'url': file, 'sha256': key, 'bytes': len(payload), 'count': len(items),
                       'bounds': [min(p[0] for p in coords), min(p[1] for p in coords), max(p[0] for p in coords), max(p[1] for p in coords)]})
        save(output / file, collection)

    for key in sorted(buckets):
        emit(buckets[key])
    metadata = {'center_lnglat': [center.x, center.y], 'local_origin_xy': origin,
                'radius_m': c['radius_m'], 'source_crs': 'EPSG:5186', 'geojson_crs': 'EPSG:4326'}
    manifest = {'schema_version': 1, 'region': c['region'], 'metadata': metadata,
                'count': len(features), 'bytes': sum(ch['bytes'] for ch in chunks), 'chunks': chunks,
                'quality': report, 'simplify_m': tolerance}
    manifest['version'] = digest(encode(manifest))
    # Publish manifest last. Failed builds retain the previous manifest and chunks.
    save(output / 'manifest.json', manifest)
    print(json.dumps({'manifest': str(output / 'manifest.json'), 'count': len(features),
                      'chunks': len(chunks), 'bytes': manifest['bytes'], 'gaps': report['gaps']}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['inspect', 'init', 'check', 'build'])
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    try:
        c = config(args.config)
        if args.command == 'check':
            _, report = check(c)
            print(json.dumps(report, ensure_ascii=False, indent=2))
        else:
            {'inspect': inspect, 'init': init, 'build': build}[args.command](c)
    except (ValueError, OSError, DataSourceError) as exc:
        parser.exit(1, f'Pipeline stopped: {exc}\n')
