import tempfile,unittest
from pathlib import Path
import numpy as np
import rasterio
from rasterio.transform import from_origin
from shapely.geometry import box
from app.terrain_analysis import analyze_terrain
class TerrainTests(unittest.TestCase):
 def write(self,path,array):
  with rasterio.open(path,'w',driver='GTiff',width=20,height=20,count=1,dtype='float32',crs='EPSG:5186',transform=from_origin(-1000,1000,100,100),nodata=-9999) as d:d.write(array.astype('float32'),1)
 def test_known_constant_and_unknown_facing(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t)/'test.tif';self.write(p,np.full((20,20),50.0))
   r=analyze_terrain(box(-5,-5,5,5),'EPSG:5186',p,radii=[500])['measurements'][0]
   self.assertEqual(r['elevation']['mean'],50);self.assertIsNone(r['relative_sectors']);self.assertEqual(r['coverage'],1)
 def test_nodata_is_missing_not_zero(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t)/'test.tif';self.write(p,np.full((20,20),-9999.0))
   r=analyze_terrain(box(-5,-5,5,5),'EPSG:5186',p,radii=[500])['measurements'][0]
   self.assertEqual(r['status'],'missing');self.assertIsNone(r['elevation'])
 def test_north_and_facing_are_explicit(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t)/'test.tif';self.write(p,np.repeat(np.arange(20,0,-1)[:,None],20,axis=1))
   r=analyze_terrain(box(-5,-5,5,5),'EPSG:5186',p,radii=[500],facing_degrees=0)['measurements'][0]
   self.assertGreater(r['cardinal_sectors']['north']['mean'],r['cardinal_sectors']['south']['mean'])
   self.assertEqual(r['relative_sectors']['front']['mean'],r['cardinal_sectors']['north']['mean'])
if __name__=='__main__':unittest.main()
