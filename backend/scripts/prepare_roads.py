"""Local road area polygons. No numeric road-width or traffic volume inference."""
from pathlib import Path
import json
import geopandas as gpd
from shapely.ops import transform
from pyproj import Transformer
ROOT=Path(__file__).resolve().parents[2]
def main():
 cfg=json.loads((ROOT/'data/sample.json').read_text());b=gpd.read_file(ROOT/cfg['working_source'],engine='pyogrio',encoding='UTF-8');target=b[b.bldg_id.astype(str)==cfg['target_id']].geometry.iloc[0]
 region=target.buffer(1000);project=Transformer.from_crs(5186,5179,always_xy=True)
 bounds=transform(project.transform,region).bounds
 source=ROOT/'data/raw/roads/TL_SPRD_RW_41/TL_SPRD_RW_41.shp'
 roads=gpd.read_file(source,engine='pyogrio',encoding='EUC-KR',bbox=bounds).to_crs(5186)
 roads=roads[roads.geometry.intersects(region)].copy()
 if not roads.geometry.is_valid.all():raise ValueError('Invalid nearby road polygon; QGIS review needed')
 nearest=float(roads.geometry.distance(target).min()) if len(roads) else None
 roads.geometry=roads.geometry.intersection(region)
 out=ROOT/'data/processed/roads';out.mkdir(parents=True,exist_ok=True)
 document=json.loads(roads.to_crs(4326).to_json(drop_id=True,ensure_ascii=False))
 document['metadata']={'source':source.name,'source_crs':'EPSG:5179','calculation_crs':'EPSG:5186','radius_m':1000,'records':len(roads),'geometry_clipped':True,'numeric_width_field':None,'nearest_road_area_distance_m':round(nearest,2) if nearest is not None else None,'traffic_volume':None,'publish':False,'license_status':'Exact download terms not supplied; local review only'}
 (out/'sample-roads.geojson').write_text(json.dumps(document,ensure_ascii=False,separators=(',',':')))
 print(json.dumps(document['metadata'],ensure_ascii=False))
if __name__=='__main__':main()
