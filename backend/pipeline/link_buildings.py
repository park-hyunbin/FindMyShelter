"""Conservative polygon correspondence; geometry is always from the base source."""
from collections import Counter
import json

import geopandas as gpd
import pandas as pd

from .cli import ROOT, config, normalize, read, save, validate, working


def present(value):
    return not pd.isna(value) and str(value).strip() != ''


def correspond(base, attributes):
    """Return enriched rows and auditable candidates, never nearest-only assignment."""
    for frame in [base, attributes]:
        errors, _ = validate(frame)
        if errors:
            raise ValueError('; '.join(errors))
    base = base.reset_index(drop=True).copy()
    attributes = attributes.reset_index(drop=True)
    index = attributes.sindex
    proposals, candidates = {}, []
    for i, row in base.iterrows():
        scores = []
        for j in index.query(row.geometry, predicate='intersects'):
            donor = attributes.iloc[j]
            area = row.geometry.intersection(donor.geometry).area
            if area <= 1:
                continue
            coverage = area / row.geometry.area
            donor_coverage = area / donor.geometry.area
            iou = area / (row.geometry.area + donor.geometry.area - area)
            if max(coverage, donor_coverage) < 0.1:
                continue
            score = {'base_index':i, 'donor_index':int(j), 'base_id':str(row.bldg_id),
                     'attribute_id':str(donor.bldg_id), 'iou':float(iou),
                     'base_coverage':float(coverage), 'attribute_coverage':float(donor_coverage),
                     'centroid_distance_m':float(row.geometry.centroid.distance(donor.geometry.centroid))}
            scores.append(score)
        scores.sort(key=lambda s: (-s['iou'], s['attribute_id']))
        candidates.extend(scores)
        if scores:
            best = scores[0]
            margin = best['iou'] - (scores[1]['iou'] if len(scores) > 1 else 0)
            donor = attributes.iloc[best['donor_index']]
            reason = 'geometry_ambiguous'
            if best['iou'] >= 0.7 and min(best['base_coverage'], best['attribute_coverage']) >= 0.8 and margin >= 0.15:
                reason = 'candidate'
                if present(row.floors) and present(donor.floors) and row.floors != donor.floors:
                    reason = 'floor_conflict'
                if present(row['name']) and present(donor['name']) and row['name'].replace(' ', '') != donor['name'].replace(' ', ''):
                    reason = 'name_conflict'
            proposals[i] = {**best, 'margin':margin, 'reason':reason}
    uses = Counter(p['attribute_id'] for p in proposals.values() if p['reason'] == 'candidate')
    for col in ['attr_id', 'candidate_id', 'link_status', 'height_basis', 'name_basis', 'dong_basis', 'address_basis', 'use_basis']:
        base[col] = None
    for col in ['link_iou', 'base_cover', 'attr_cover', 'link_margin']:
        base[col] = float('nan')
    base['link_status'] = 'unmatched'
    base['height_basis'] = base.height_m.map(lambda v: 'base_source' if present(v) else None)
    for field in ['name', 'dong', 'address', 'use']:
        base[f'{field}_basis'] = base[field].map(lambda v: 'base_source' if present(v) else None)
    for i, proposal in proposals.items():
        reason = proposal['reason']
        if reason == 'candidate' and uses[proposal['attribute_id']] > 1:
            reason = 'shared_attribute'
        base.loc[i, ['candidate_id', 'link_status', 'link_iou', 'base_cover', 'attr_cover', 'link_margin']] = [
            proposal['attribute_id'], reason, proposal['iou'], proposal['base_coverage'], proposal['attribute_coverage'], proposal['margin']]
        if reason != 'candidate':
            continue
        donor = attributes.iloc[proposal['donor_index']]
        base.loc[i, 'attr_id'] = str(donor.bldg_id)
        for field in ['height_m', 'name', 'dong', 'address', 'use']:
            if not present(base.loc[i, field]) and present(donor[field]):
                base.loc[i, field] = donor[field]
                base.loc[i, 'height_basis' if field == 'height_m' else f'{field}_basis'] = 'attribute_candidate'
        # Floors are retained from the geometry source, never replaced or converted to height.
    evidence = pd.DataFrame(candidates)
    if len(evidence):
        evidence['link_result'] = evidence.base_index.map(lambda i: base.loc[i, 'link_status'])
    return base, evidence


def initialize(c):
    target = working(c)
    if target.exists():
        raise ValueError(f'QGIS linked file already exists; preserved: {target}')
    source = read(c)
    base = normalize(c, source)
    donor_config = config(ROOT / c['attributes_config'])
    donor_config.update(center_lnglat=c['center_lnglat'], radius_m=c['radius_m'] + 100)
    donor_source = read(donor_config)
    donor = normalize(donor_config, donor_source)
    result, evidence = correspond(base, donor)
    # Keep the original names, annotation, floor values alongside the linked values in QGIS.
    result['topo_name'] = source[c['fields']['name']].reset_index(drop=True)
    result['topo_floors'] = source[c['fields']['floors']].reset_index(drop=True)
    if 'ANNO' in source:
        result['topo_anno'] = source.ANNO.reset_index(drop=True)
    errors, gaps = validate(result)
    if errors:
        raise ValueError('; '.join(errors))
    target.parent.mkdir(parents=True, exist_ok=True)
    result.to_file(target, layer='buildings', driver='GPKG')
    donor.to_file(target, layer='attribute_source', driver='GPKG')
    if len(evidence):
        # Relational table, not duplicated polygon geometry per match.
        import sqlite3
        with sqlite3.connect(target) as connection:
            evidence.to_sql('link_candidates', connection, index=False)
            connection.execute("INSERT INTO gpkg_contents (table_name,data_type,identifier,description) VALUES (?,?,?,?)",
                               ('link_candidates','attributes','link_candidates','Spatial correspondence candidates; not verified building identities'))
    summary = {'count':len(result), 'attribute_count':len(donor),
               'link_status':result.link_status.value_counts().to_dict(),
               'heights_linked':int(result.height_basis.eq('attribute_candidate').sum()),
               'gaps':gaps, 'policy':'All automatic links are unverified candidates; no nearest-only join or floor-based heights.'}
    save(target.parent / 'link-summary.json', summary)
    save(target.parent / 'import.json', {'ids':sorted(result.bldg_id.astype(str)), 'config':c, 'gaps':gaps})
    print(json.dumps({'qgis':str(target.relative_to(ROOT)), **summary}, ensure_ascii=False))
