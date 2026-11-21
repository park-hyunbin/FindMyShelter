import unittest
import tempfile
import contextlib
import io
from pathlib import Path
from unittest.mock import patch

import geopandas as gpd
from shapely.geometry import box

from backend.pipeline.link_buildings import correspond
from backend.pipeline import cli, link_buildings


def frame(ids, shapes, heights=None, floors=None):
    size = len(ids)
    return gpd.GeoDataFrame({'bldg_id':ids, 'name':[None]*size, 'dong':[None]*size,
        'address':[None]*size, 'height_m':heights or [None]*size, 'floors':floors or [3]*size,
        'use':[None]*size, 'rev_status':['pending']*size, 'rev_note':[None]*size,
        'rev_date':[None]*size}, geometry=shapes, crs=5186)


class LinkingTest(unittest.TestCase):
    def test_link_preserves_base_geometry_and_candidate_lineage(self):
        shape = box(0,0,10,10)
        base = frame(['ufid-1'], [shape])
        donor = frame(['al-1'], [box(0.1,0,10.1,10)], [12])
        donor.loc[0, 'name'] = '건물 이름'
        linked, evidence = correspond(base, donor)
        self.assertTrue(linked.geometry.iloc[0].equals_exact(shape, 0))
        self.assertEqual(linked.loc[0,'height_m'],12)
        self.assertEqual(linked.loc[0,'name'],'건물 이름')
        self.assertEqual(linked.loc[0,'attr_id'],'al-1')
        self.assertEqual(linked.loc[0,'height_basis'],'attribute_candidate')
        self.assertEqual(linked.loc[0,'rev_status'],'pending')
        self.assertEqual(len(evidence),1)

    def test_conflicts_and_small_annex_do_not_inherit_tower_height(self):
        base = frame(['floors', 'annex', 'unmatched'],
            [box(0,0,10,10),box(30,0,32,2),box(100,0,102,2)])
        donor = frame(['tower-a','tower-b'],[box(0,0,10,10),box(30,0,40,10)], [90,90],[30,30])
        linked,_ = correspond(base,donor)
        self.assertTrue(linked.height_m.isna().all())
        self.assertEqual(linked.loc[0,'link_status'],'floor_conflict')
        self.assertEqual(linked.loc[1,'link_status'],'geometry_ambiguous')
        self.assertEqual(linked.loc[2,'link_status'],'unmatched')

    def test_multiple_equally_good_donors_are_not_auto_linked(self):
        shape = box(0,0,10,10)
        linked,_ = correspond(frame(['base'],[shape]),frame(['a','b'],[shape,shape],[12,20]))
        self.assertEqual(linked.loc[0,'link_status'],'geometry_ambiguous')
        self.assertTrue(linked.height_m.isna().all())

    def test_shared_donor_is_not_copied_twice(self):
        shape = box(0,0,10,10)
        linked,_ = correspond(frame(['a','b'],[shape,shape]),frame(['donor'],[shape],[12]))
        self.assertEqual(set(linked.link_status),{'shared_attribute'})
        self.assertTrue(linked.height_m.isna().all())

    def test_qgis_edits_are_validated_before_export(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            shape = box(200000,550000,200010,550010)
            frame(['ufid'],[shape]).to_file(root/'base.gpkg',layer='buildings')
            frame(['attr'],[shape],[12]).to_file(root/'attributes.gpkg',layer='buildings')
            fields = {name:name for name in cli.FIELDS}
            donor = {'region':'attributes','source':'attributes.gpkg','source_layer':'buildings','fields':fields}
            c = {'region':'linked','source':'base.gpkg','source_layer':'buildings','fields':fields,
                 'center_lnglat':[127,37.55],'radius_m':1000,'attributes_config':'attributes.json'}
            cli.save(root/'attributes.json',donor)
            with patch.object(cli,'ROOT',root), patch.object(link_buildings,'ROOT',root), contextlib.redirect_stdout(io.StringIO()):
                cli.init(c)
                cli.build(c)
                manifest = root/'frontend/public/datasets/buildings/linked/manifest.json'
                before = manifest.read_bytes()
                target = cli.working(c)
                edited = gpd.read_file(target,layer='buildings')
                edited.loc[0,'attr_id'] = 'nonexistent'
                edited.to_file(target,layer='buildings',driver='GPKG')
                with self.assertRaisesRegex(ValueError,'does not exist'):
                    cli.build(c)
                self.assertEqual(before,manifest.read_bytes())
                with self.assertRaisesRegex(ValueError,'preserved'):
                    cli.init(c)
