import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import geopandas as gpd
from shapely.geometry import box

from backend.pipeline import cli


class PipelineTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.mock = patch.object(cli, 'ROOT', self.root)
        self.mock.start()
        self.addCleanup(self.mock.stop)
        frame = gpd.GeoDataFrame({
            'id': ['stable-a', 'stable-b'], 'height': [12., 0.], 'levels': [4, 2],
        }, geometry=[box(200000, 550000, 200010, 550010), box(200030, 550000, 200040, 550010)], crs=5186)
        frame.to_file(self.root / 'source.gpkg', layer='buildings', driver='GPKG')
        self.c = {'region': 'test', 'source': 'source.gpkg', 'source_layer': 'buildings',
                  'center_lnglat': [127, 37.55], 'radius_m': 1000,
                  'fields': {'bldg_id': 'id', 'height_m': 'height', 'floors': 'levels'}}
        self.quiet = contextlib.redirect_stdout(io.StringIO())

    def test_repeatable_build_and_manual_review(self):
        with self.quiet:
            cli.init(self.c)
            cli.build(self.c)
        folder = self.root / 'frontend/public/datasets/buildings/test'
        manifest = folder / 'manifest.json'
        first = manifest.read_bytes()
        dates = {p: p.stat().st_mtime_ns for p in folder.rglob('*') if p.is_file()}
        with self.quiet:
            cli.build(self.c)
        self.assertEqual(dates, {p: p.stat().st_mtime_ns for p in dates})
        data = json.loads(first)
        self.assertEqual(data['quality']['gaps']['missing_height_m'], 1)
        for ch in data['chunks']:
            payload = (folder / ch['url']).read_bytes()
            self.assertEqual(cli.digest(payload), ch['sha256'])
            self.assertLessEqual(len(payload), 180000)
        target = cli.working(self.c)
        edited = gpd.read_file(target)
        edited.loc[0, ['height_m', 'rev_status', 'rev_note', 'rev_date']] = [15, 'verified', 'QGIS field check', '2026-11-17']
        edited.to_file(target, layer='buildings', driver='GPKG')
        with self.quiet:
            cli.build(self.c)
        self.assertNotEqual(first, manifest.read_bytes())
        with self.assertRaisesRegex(ValueError, 'already exists'):
            cli.init(self.c)
        self.assertEqual(gpd.read_file(target).loc[0, 'height_m'], 15)

    def test_invalid_edits_keep_last_release(self):
        with self.quiet:
            cli.init(self.c)
            cli.build(self.c)
        manifest = self.root / 'frontend/public/datasets/buildings/test/manifest.json'
        before = manifest.read_bytes()
        target = cli.working(self.c)
        edited = gpd.read_file(target)
        edited.loc[0, 'floors'] = -1
        edited.to_file(target, layer='buildings', driver='GPKG')
        with self.assertRaisesRegex(ValueError, 'floors'):
            cli.build(self.c)
        self.assertEqual(before, manifest.read_bytes())
        edited.loc[0, 'floors'] = 4
        edited.loc[0, 'bldg_id'] = 'changed'
        edited.to_file(target, layer='buildings', driver='GPKG')
        with self.assertRaisesRegex(ValueError, 'IDs added'):
            cli.build(self.c)
        self.assertEqual(before, manifest.read_bytes())


if __name__ == '__main__':
    unittest.main()
