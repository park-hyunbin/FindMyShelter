"""Compare two building sources in the right-hand config's local window."""
import argparse
import json

import geopandas as gpd
from shapely import union_all

from .cli import ROOT, config, read, save


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--existing', required=True)
    parser.add_argument('--candidate', required=True)
    args = parser.parse_args()
    right = config(args.candidate)
    left = config(args.existing)
    left.update(center_lnglat=right['center_lnglat'], radius_m=right['radius_m'])
    existing, candidate = read(left), read(right)
    directory = ROOT / 'data/working/comparisons' / right['region']
    output = directory / 'source-comparison.gpkg'
    if output.exists():
        parser.error(f'Comparison exists; preserve QGIS edits and use a new candidate region name: {output}')
    directory.mkdir(parents=True, exist_ok=True)
    occupied = union_all(existing.geometry)
    candidate = candidate.copy()
    candidate['old_overlap_ratio'] = candidate.geometry.map(
        lambda shape: round(shape.intersection(occupied).area / shape.area, 4) if shape.area else None)
    candidate['check_needed'] = candidate.old_overlap_ratio < 0.2
    # Keep all original columns (ANNO, UFID etc.) for manual QGIS comparison.
    existing.to_file(output, layer='existing_buildings', driver='GPKG')
    candidate.to_file(output, layer='candidate_buildings', driver='GPKG')
    report = {'window_center_lnglat':right['center_lnglat'], 'radius_m':right['radius_m'],
              'existing_count':len(existing), 'candidate_count':len(candidate),
              'low_overlap_candidates':int(candidate.check_needed.sum()),
              'method':'EPSG:5186; candidate intersection area with union of existing polygons / candidate area; threshold <0.2',
              'limitation':'Low overlap flags review candidates, not confirmed new buildings. Roof structures, acquisition date and geometry differences must be checked.',
              'qgis':str(output.relative_to(ROOT))}
    save(directory / 'comparison.json', report)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
