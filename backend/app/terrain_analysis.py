"""DEM measurements only. No traditional interpretation or inferred ridge lines."""
from pathlib import Path
import numpy as np
import rasterio
from rasterio.windows import from_bounds, Window
from pyproj import Transformer
from shapely import contains_xy
from shapely.geometry import box
from shapely.ops import transform

def analyze_terrain(building, building_crs, dem_path, radii=(250,500,1000), facing_degrees=None, vertical_unit=None):
    if building.is_empty or not building.is_valid:raise ValueError('Valid building polygon required')
    if facing_degrees is not None and not 0<=facing_degrees<360:raise ValueError('Facing must be in [0,360)')
    with rasterio.open(dem_path) as dem:
        if dem.crs is None:raise ValueError('DEM CRS missing')
        # All buffer/direction measurements use metre-based building CRS.
        from pyproj import CRS
        crs=CRS(building_crs)
        if not crs.is_projected or any(abs(a.unit_conversion_factor-1)>1e-8 for a in crs.axis_info):raise ValueError('Building CRS must use metres')
        if dem.count!=1:raise ValueError('Single-band DEM required')
        forward=Transformer.from_crs(crs,dem.crs,always_xy=True)
        backward=Transformer.from_crs(dem.crs,crs,always_xy=True)
        center=building.centroid;results=[]
        for radius in radii:
            if radius<=0:raise ValueError('Radius must be positive')
            circle=center.buffer(radius,quad_segs=64)
            bounds=transform(forward.transform,circle).bounds
            request=from_bounds(*bounds,dem.transform).round_offsets().round_lengths()
            # Include a one-pixel border to avoid rounding out requested cell centres.
            request=Window(request.col_off-1,request.row_off-1,request.width+2,request.height+2)
            values=dem.read(1,window=request,boundless=True,masked=True)
            affine=dem.window_transform(request)
            rr,cc=np.indices(values.shape)
            xs,ys=rasterio.transform.xy(affine,rr.ravel(),cc.ravel())
            x,y=backward.transform(np.array(xs),np.array(ys))
            inside=contains_xy(circle,x,y)
            valid=inside&~np.ma.getmaskarray(values).ravel()&np.isfinite(values.data.ravel())
            numbers=values.data.ravel();eligible=int(inside.sum());count=int(valid.sum())
            coverage=count/eligible if eligible else 0
            def stats(selection):
                n=numbers[selection]
                return {'cell_count':int(len(n)),'min':float(n.min()) if n.size else None,'max':float(n.max()) if n.size else None,'mean':float(n.mean()) if n.size else None,'median':float(np.median(n)) if n.size else None}
            available=count>=4 and coverage>=.8
            bearing=np.degrees(np.arctan2(x-center.x,y-center.y))%360
            sectors={}
            if available:
                for name,angle in [('north',0),('east',90),('south',180),('west',270)]:
                    mask=valid&(np.abs((bearing-angle+180)%360-180)<=45)
                    sectors[name]=stats(mask)
            relative=None
            if available and facing_degrees is not None:
                relative={}
                for name,delta in [('front',0),('right',90),('rear',180),('left',270)]:
                    relative[name]=stats(valid&(np.abs((bearing-facing_degrees-delta+180)%360-180)<=45))
            results.append({'radius_m':radius,'status':'available' if available else 'missing','missing_reason':None if available else 'insufficient_valid_cells',
                            'eligible_cell_count':eligible,'valid_cell_count':count,'coverage':coverage,
                            'elevation':stats(valid) if available else None,'cardinal_sectors':sectors or None,'relative_sectors':relative})
        return {'source':Path(dem_path).name,'resolution':list(dem.res),'horizontal_crs':dem.crs.to_wkt(),
                'vertical_unit':vertical_unit,'vertical_datum':None,'method':'centroid_circle_pixel_centres_v1',
                'facing_degrees':facing_degrees,'measurements':results,
                'ridge_analysis':{'status':'not_implemented','reason':'DEM alone is not a verified yongmaek dataset; ridge extraction and traditional interpretation require separate validation'},
                'limitations':['90m cells are unsuitable for building-scale microterrain.','Elevation statistics remain in source units until vertical units are verified.','Cardinal sectors are geographic directions, not house facing.']}
