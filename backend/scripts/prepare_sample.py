"""QGIS-edited SHP -> single browser GeoJSON. Never modifies editing source."""
from pathlib import Path
import json, math, os
import geopandas as gpd
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'frontend/public/sample-buildings.geojson'

def numeric(value, field, identity):
    if value is None or str(value).lower() in ('nan','none',''): return None
    try: n=float(value)
    except (ValueError,TypeError):raise ValueError(f'{identity}: {field} is not numeric')
    if not math.isfinite(n):raise ValueError(f'{identity}: {field} must be finite')
    if n==0:return None
    limit=500 if field=='height_m' else 150
    if not 0<n<limit:raise ValueError(f'{identity}: check {field}={n}')
    if field=='floors' and n!=int(n):raise ValueError(f'{identity}: floors must be an integer')
    return int(n) if field=='floors' else n

def text(v):return v if isinstance(v,str) else None

def export(source=None, output=OUT):
    config=json.loads((ROOT/'data/sample.json').read_text())
    source=Path(source) if source else ROOT/config['working_source']
    g=gpd.read_file(source,engine='pyogrio',encoding='UTF-8')
    required={'bldg_id','name','dong','address','height_m','floors','use','rev_status','rev_note','rev_date'}
    if required-set(g.columns):raise ValueError(f'Missing fields: {required-set(g.columns)}')
    if g.crs is None:raise ValueError('Missing CRS')
    g=g.to_crs(5186)
    if g.geometry.isna().any() or g.geometry.is_empty.any() or not g.geometry.is_valid.all():raise ValueError('Empty or invalid geometry; fix in QGIS first')
    if not g.geom_type.isin(['Polygon','MultiPolygon']).all():raise ValueError('Polygon geometry required')
    ids=g.bldg_id.astype(str)
    if ids.duplicated().any():raise ValueError('Duplicate bldg_id; do not change identifiers')
    original=json.loads((ROOT/config['baseline']).read_text())
    expected={f['properties']['id'] for f in original['features']}
    if set(ids)!=expected:raise ValueError('Building IDs added, changed or deleted; restore sample IDs before exporting')
    target=g.loc[ids==config['target_id']]
    if len(target)!=1:raise ValueError('Target must match exactly once')
    anchor=target.geometry.iloc[0].centroid;target_shape=target.geometry.iloc[0]
    wgs=g.to_crs(4326);features=[];missing_height=missing_floors=0
    for i,r in g.iterrows():
        shape=r.geometry;polys=[shape] if shape.geom_type=='Polygon' else list(shape.geoms)
        local=[[[[round(x-anchor.x,2),round(y-anchor.y,2)] for x,y,*_ in ring.coords] for ring in [p.exterior,*p.interiors]] for p in polys]
        identity=str(r.bldg_id);height=numeric(r.height_m,'height_m',identity);floors=numeric(r.floors,'floors',identity)
        missing_height+=height is None;missing_floors+=floors is None
        status=text(r.rev_status) or 'pending'
        if status not in ['pending','edited','verified']:raise ValueError(f'{identity}: rev_status must be pending, edited or verified')
        props={'id':identity,'target':identity==config['target_id'],'name':text(r['name']),'dong':text(r.dong),'address':text(r.address) or '',
          'height_m':height,'floors':floors,'use':text(r['use']),'area_m2':round(shape.area,2),'distance_to_target_m':round(shape.distance(target_shape),2),
          'display_local_rings_m':local,'review_status':status,'review_note':text(r.rev_note),'review_date':text(r.rev_date),
          'mapping_status':'candidate_pending_qgis_review' if status!='verified' else 'user_marked_verified'}
        features.append({'type':'Feature','geometry':wgs.loc[i].geometry.__geo_interface__,'properties':props})
    centre=gpd.GeoSeries([anchor],crs=5186).to_crs(4326).iloc[0]
    metadata={**original['metadata'],'source':str(source.relative_to(ROOT)) if source.is_relative_to(ROOT) else source.name,
       'local_origin_xy':[anchor.x,anchor.y],'center_lnglat':[centre.x,centre.y],'building_count':len(features),
       'selection':'fixed 214-building sample; QGIS edits preserved','missing_height_count':missing_height,'missing_floors_count':missing_floors,
       'height_status':'QGIS height_m; null/zero remains flat; no inferred height'}
    data={'type':'FeatureCollection','features':features,'metadata':metadata}
    payload=json.dumps(data,ensure_ascii=False,separators=(',',':'),allow_nan=False)
    output=Path(output);output.parent.mkdir(parents=True,exist_ok=True)
    temp=output.with_suffix('.geojson.tmp');temp.write_text(payload,encoding='utf-8');os.replace(temp,output)
    print(json.dumps({'buildings':len(features),'bytes':output.stat().st_size,'missing_height':missing_height,'missing_floors':missing_floors,'source':str(source.relative_to(ROOT)) if source.is_relative_to(ROOT) else source.name},ensure_ascii=False))
    return data
if __name__=='__main__':export()
