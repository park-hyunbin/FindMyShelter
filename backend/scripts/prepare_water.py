"""Local-only legal small-stream zones, not water surface or flow network."""
from pathlib import Path
import json,re
import geopandas as gpd
ROOT=Path(__file__).resolve().parents[2]
def main():
 source=next((ROOT/'data/raw/water').rglob('*.shp'))
 g=gpd.read_file(source,engine='pyogrio',encoding='EUC-KR').to_crs(5186)
 cfg=json.loads((ROOT/'data/sample.json').read_text());b=gpd.read_file(ROOT/cfg['working_source'],engine='pyogrio',encoding='UTF-8')
 target=b[b.bldg_id.astype(str)==cfg['target_id']].geometry.iloc[0]
 nearby=g.iloc[g.sindex.query(target.buffer(2000),predicate='intersects')].copy()
 if not nearby.geometry.is_valid.all():raise ValueError('Invalid local water polygons; inspect in QGIS')
 def code(v):
  m=re.search(r'UJC\d{3}',str(v));return m.group(0) if m else 'unknown'
 nearby['zone_code']=nearby.MNUM.map(code)
 nearby['zone_kind']=nearby.zone_code.map({'UJC100':'small_stream_zone','UJC200':'planned_small_stream_zone'}).fillna('unclassified')
 nearby['source_record']=nearby.index.astype(str)
 existing=nearby[nearby.zone_code=='UJC100']
 report={'source':str(source.relative_to(ROOT)),'source_records':len(g),'local_records':len(nearby),
 'zone_counts':nearby.zone_code.value_counts().to_dict(),'radius_m':2000,'geometry_clipped':False,
 'nearest_existing_zone_distance_m':round(float(existing.geometry.distance(target).min()),2) if len(existing) else None,
 'source_crs':'EPSG:5186','geojson_crs':'EPSG:4326','interpretation':'Legal small-stream zones and planned zones, NOT verified surface water or flow direction.',
 'license_reference':'https://www.data.go.kr/data/15161704/fileData.do','license_status':'Official related dataset indicates KOGL type 4; local review only until exact download permissions verified','publish':False}
 out=ROOT/'data/processed/water';out.mkdir(parents=True,exist_ok=True)
 collection=json.loads(nearby.to_crs(4326).to_json(drop_id=True,ensure_ascii=False));collection['metadata']=report
 (out/'sample-water.geojson').write_text(json.dumps(collection,ensure_ascii=False,separators=(',',':')))
 (out/'manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
 print(json.dumps(report,ensure_ascii=False))
if __name__=='__main__':main()
