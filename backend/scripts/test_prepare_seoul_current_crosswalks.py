import json
import sqlite3
import unittest
from datetime import date

from shapely import STRtree
from shapely.geometry import Point, box, mapping

from prepare_seoul_current_crosswalks import ZEBRA_TYPES, companion_axis, confirmed_outlines, export_window


class CurrentCrosswalkTest(unittest.TestCase):
    def test_keeps_only_active_ordinary_zebras_with_one_verified_outline(self):
        snapshot = sqlite3.connect(":memory:")
        self.addCleanup(snapshot.close)
        snapshot.execute("CREATE TABLE feature(layer, id, properties, geometry)")
        visible = {"STAT_CDE": "001", "VIEW_CDE": "002", "EVE_CDE": "001", "A004_KND_CDE": "003"}
        shape = json.dumps(mapping(box(0, 0, 10, 3)))
        rows = [
            ("included", {}),
            ("hidden", {"VIEW_CDE": "001"}),
            ("future", {"ESB_YMD": "20270101"}),
            ("arrowed", {"A004_KND_CDE": "001"}),
            ("far", {}),
            ("duplicate", {}),
            ("duplicate", {}),
            ("missing", {}),
        ]
        for index, (identifier, overrides) in enumerate(rows):
            tags = {**visible, "MGRNU": identifier, **overrides}
            snapshot.execute("INSERT INTO feature VALUES (?,?,?,?)", ("A004_A", str(index), json.dumps(tags), shape))
        inventory = {key: [(ZEBRA_TYPES["003"], Point(5, 1))] for key, _ in rows if key != "missing"}
        inventory["far"] = [(ZEBRA_TYPES["003"], Point(5, 10))]
        matches = confirmed_outlines(snapshot, inventory, date(2026, 11, 22))
        self.assertEqual([(identifier, kind, outline.area) for identifier, kind, outline in matches],
                         [("included", "003", 30)])

    def test_direction_requires_an_aligned_crossing(self):
        short = box(200000, 550000, 200008, 550006)
        aligned = box(200010, 550000, 200026, 550006)
        (lon1, lat1), (lon2, lat2) = companion_axis(short, STRtree([short, aligned]))
        self.assertGreater(abs(lon1 - lon2), abs(lat1 - lat2))
        offset = box(200010, 550003, 200026, 550009)
        self.assertIsNone(companion_axis(short, STRtree([short, offset])))

    def test_rejects_publication_against_a_different_road_snapshot(self):
        markings = {"roadDataset": {"sha256": "old"}}
        pavement = {"roadDataset": {"sha256": "old"}}
        with self.assertRaisesRegex(ValueError, "same T-GIS snapshot"):
            export_window(markings, pavement, {"sha256": "new"}, None, ())


if __name__ == "__main__":
    unittest.main()
