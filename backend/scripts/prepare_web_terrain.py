"""Small local raster-dem tiles. Native 90m data resampled bilinear for display, no new detail.
Display assumes native elevation values are metres; assumption is explicit in manifest/UI.
"""
from pathlib import Path
import json,math
import numpy as np
import rasterio
from rasterio.transform import from_bounds
from rasterio.warp import reproject,Resampling
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'frontend/public/dem';OUT.mkdir(parents=True,exist_ok=True)
def main():
 cfg=json.loads((ROOT/'data/terrain.json').read_text());sample=json.loads((ROOT/'frontend/public/sample-buildings.geojson').read_text())
 lng,lat=sample['metadata']['center_lnglat'];z=14;n=2**z;cx=int((lng+180)/360*n);cy=int((1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n)
 size=40075016.68557849/n;origin=20037508.342789244;files=[]
 with rasterio.open(ROOT/cfg['source_file']) as src:
  for x in range(cx-1,cx+2):
   for y in range(cy-1,cy+2):
    west=-origin+x*size;east=west+size;north=origin-y*size;south=north-size
    values=np.full((256,256),np.nan,dtype='float32')
    reproject(rasterio.band(src,1),values,src_transform=src.transform,src_crs=src.crs,src_nodata=src.nodata,dst_transform=from_bounds(west,south,east,north,256,256),dst_crs='EPSG:3857',dst_nodata=np.nan,resampling=Resampling.bilinear)
    if not np.isfinite(values).all():raise ValueError('Missing DEM cells in sample tile; do not fill with invented terrain')
    encoded=np.rint((values+10000)*10).astype('uint32')
    rgb=np.stack([(encoded>>16)&255,(encoded>>8)&255,encoded&255],axis=-1).astype('uint8')
    decoded=(rgb[:,:,0].astype('uint32')*65536+rgb[:,:,1].astype('uint32')*256+rgb[:,:,2])/10-10000
    assert np.max(np.abs(decoded-values))<.051
    path=OUT/str(z)/str(x)/f'{y}.png';path.parent.mkdir(parents=True,exist_ok=True);Image.fromarray(rgb).save(path);files.append(path)
 west=(cx-1)/n*360-180;east=(cx+2)/n*360-180
 north=math.degrees(math.atan(math.sinh(math.pi*(1-2*(cy-1)/n))));south=math.degrees(math.atan(math.sinh(math.pi*(1-2*(cy+2)/n))))
 meta={'source':'User-provided VWorld Korea DEM','native_resolution_m':90,'vertical_unit_confirmed':False,'display_assumption':'source elevation values treated as metres for preview only','vertical_datum':None,'encoding':'mapbox','minzoom':z,'maxzoom':z,'tile_size':256,'bounds':[west,south,east,north],'tiles':[f'/dem/{{z}}/{{x}}/{{y}}.png'],'tile_count':len(files),'bytes':sum(p.stat().st_size for p in files),'exaggeration':1,'resampling':'bilinear display interpolation (native analysis remains 90m)' }
 (OUT/'manifest.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
 report=json.loads((ROOT/'data/processed/terrain/sample_terrain.json').read_text());(OUT/'measurements.json').write_text(json.dumps({'measurements':report['measurements'],'vertical_unit':report['vertical_unit'],'facing_degrees':report['facing_degrees']},ensure_ascii=False,separators=(',',':')))
 # Contour lines come from the original coarse crop; never label them ridges.
 import matplotlib
 matplotlib.use('Agg')
 import matplotlib.pyplot as plt
 from pyproj import Transformer
 with rasterio.open(ROOT/'data/working/terrain/sample_dem_90m.tif') as crop:
  a=crop.read(1,masked=True);rr,cc=np.indices(a.shape);xx,yy=rasterio.transform.xy(crop.transform,rr.ravel(),cc.ravel());xx=np.asarray(xx).reshape(a.shape);yy=np.asarray(yy).reshape(a.shape)
  fig,ax=plt.subplots();contours=ax.contour(xx,yy,a,levels=np.arange(np.ceil(a.min()/20)*20,a.max(),20));convert=Transformer.from_crs(crop.crs,4326,always_xy=True);features=[]
  for level,segments in zip(contours.levels,contours.allsegs):
   for segment in segments:
    if len(segment)<2:continue
    lng,lat=convert.transform(segment[:,0],segment[:,1]);features.append({'type':'Feature','properties':{'elevation_source_value':float(level),'status':'DEM-derived contour; not ridge'},'geometry':{'type':'LineString','coordinates':np.column_stack([lng,lat]).tolist()}})
  (OUT/'contours.geojson').write_text(json.dumps({'type':'FeatureCollection','features':features},separators=(',',':')));plt.close(fig)
 print(json.dumps(meta,ensure_ascii=False))
if __name__=='__main__':main()
