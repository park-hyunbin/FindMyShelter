"""Read raw DEM windows only; export a small QGIS raster and measured JSON."""
from pathlib import Path
import sys,json
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import geopandas as gpd
import rasterio
from rasterio.windows import from_bounds,Window
from rasterio.warp import transform_bounds
from app.terrain_analysis import analyze_terrain
ROOT=Path(__file__).resolve().parents[2]
def main():
    cfg=json.loads((ROOT/'data/terrain.json').read_text());sample=json.loads((ROOT/'data/sample.json').read_text())
    buildings=gpd.read_file(ROOT/sample['working_source'],engine='pyogrio',encoding='UTF-8')
    target=buildings[buildings.bldg_id.astype(str)==sample['target_id']]
    if len(target)!=1:raise ValueError('One target building required')
    building=target.geometry.iloc[0];dem_path=ROOT/cfg['source_file']
    result=analyze_terrain(building,buildings.crs,dem_path,vertical_unit=cfg['vertical_unit'])
    result['building_id']=sample['target_id'];result['building_name']=sample['name'];result['source_provider']=cfg['source_provider']
    out=ROOT/'data/processed/terrain';out.mkdir(parents=True,exist_ok=True)
    (out/'sample_terrain.json').write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False)+'\n')
    crop=ROOT/'data/working/terrain/sample_dem_90m.tif';crop.parent.mkdir(parents=True,exist_ok=True)
    with rasterio.open(dem_path) as dem:
        region=building.centroid.buffer(1500)
        bounds=transform_bounds(buildings.crs,dem.crs,*region.bounds)
        win=from_bounds(*bounds,dem.transform).round_offsets().round_lengths()
        win=win.intersection(Window(0,0,dem.width,dem.height))
        band=dem.read(1,window=win)
        profile={'driver':'GTiff','dtype':dem.dtypes[0],'count':1,'width':band.shape[1],'height':band.shape[0],
                 'transform':dem.window_transform(win),'crs':dem.crs,'nodata':dem.nodata,'compress':'deflate'}
        with rasterio.open(crop,'w',**profile) as dst:dst.write(band,1)
    print('QGIS crop:',crop.relative_to(ROOT),crop.stat().st_size,'bytes')
    for r in result['measurements']:print(r['radius_m'],r['status'],r['valid_cell_count'],r['elevation'])
if __name__=='__main__':main()
