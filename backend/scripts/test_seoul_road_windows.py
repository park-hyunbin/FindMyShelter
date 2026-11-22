from collections import Counter
import unittest

import numpy as np
from shapely.geometry import LineString, box
from shapely.ops import unary_union

from prepare_seoul_lane_windows import lane_item
from prepare_seoul_road_windows import ground_link_support, supported_runs
from prepare_songpa_road_markings import lane_style
from reconcile_seoul_marking_links import Network


class LaneStyleTest(unittest.TestCase):
    def test_subtypes_are_interpreted_with_their_marking_kind(self):
        cases = [
            ("010", "001", "yellow"), ("010", "002", "yellow-double"),
            ("011", "001", "white-dash"), ("012", "001", "white-guide-dash"), ("012", "002", "pink"),
            ("013", "001", "white"), ("013", "002", "white-dash"),
            ("018", "003", "yellow"), ("018", "004", "yellow-dash"),
            ("005", "003", "blue-double"),
            ("008", "002", "white-combined"), ("008", "003", "white-combined-reversed"),
            ("001", "004", "yellow-combined"), ("001", "005", "yellow-combined-reversed"),
        ]
        for kind, subtype, style in cases:
            with self.subTest(kind=kind, subtype=subtype):
                self.assertEqual(lane_style(kind, subtype), style)
        self.assertIsNone(lane_style("010", None))

    def test_a_mixed_marking_keeps_its_dash_phase_and_original_direction(self):
        original = LineString([(200000, 550000), (200020, 550000)])
        clipped = LineString([(200016, 550000), (200005, 550000)])
        item = lane_item(clipped, original, "white-combined-reversed", "008")
        self.assertEqual(item["dashOffsetM"], 5)
        self.assertLess(item["points"][0][0], item["points"][-1][0])

    def test_short_guides_keep_curve_vertices_and_measure_from_the_original_start(self):
        original = LineString([(200000, 550000), (200001, 550000), (200002, 550000.1), (200003, 550000)])
        clipped = LineString(list(original.coords)[1:])
        item = lane_item(clipped, original, "white-guide-dash", "012")
        self.assertEqual(item["dashOffsetM"], 1)
        self.assertEqual(len(item["points"]), 3)


class SupportedRunsTest(unittest.TestCase):
    def setUp(self):
        self.line = LineString([(0, 0), (20, 0)])
        self.window = box(-1, -2, 21, 2)
        self.ground = self.window
        self.rows = [(0, 8, "single_road", 0), (8, 8.04, "overlapping_roads", 0),
                     (8.04, 20, "single_road", 0)]

    def runs(self, ground=None, restored=None, confirm_ground=lambda line: False):
        return list(supported_runs(self.line, self.rows, self.ground if ground is None else ground,
                                   self.window, Counter(), restored if restored is not None else Counter(),
                                   confirm_ground))

    def test_one_original_line_continues_across_a_ground_polygon_seam(self):
        restored = Counter()
        runs = self.runs(restored=restored)
        self.assertEqual(len(runs), 1)
        self.assertTrue(runs[0].equals(self.line))
        self.assertAlmostEqual(restored["same_ground_overlap"], 0.04)

    def test_do_not_join_across_a_missing_road_surface(self):
        ground = unary_union([box(-1, -2, 8, 2), box(8.04, -2, 21, 2)])
        runs = self.runs(ground=ground)
        self.assertEqual(len(runs), 2)

    def test_do_not_join_across_a_structure_or_a_sidewalk(self):
        for status, structure in [("overlapping_roads", 0.04), ("road_and_walk", 0)]:
            with self.subTest(status=status, structure=structure):
                self.rows[1] = (8, 8.04, status, structure)
                runs = self.runs()
                self.assertEqual(len(runs), 2)

    def test_a_confirmed_ground_link_restores_continuity_near_a_structure(self):
        self.rows = [(0, 8, "single_road", 0), (8, 12, "single_road", 4), (12, 20, "single_road", 0)]
        restored = Counter()
        self.assertEqual(len(self.runs()), 2)
        link = Network(np.array([LineString([(0, 1), (20, 1)])]), ["ground-road"])
        runs = self.runs(restored=restored, confirm_ground=lambda line: ground_link_support(line, self.ground, link, False))
        self.assertEqual(len(runs), 1)
        self.assertTrue(runs[0].equals(self.line))
        self.assertEqual(restored["ground_near_structure"], 4)

    def test_a_parallel_road_across_a_median_does_not_confirm_the_lane(self):
        ground = unary_union([box(-1, -1, 21, 1), box(-1, 2, 21, 4)])
        link = Network(np.array([LineString([(0, 3), (20, 3)])]), ["other-road"])
        self.assertFalse(ground_link_support(self.line, ground, link, False))

    def test_exact_ground_axis_can_support_a_centerline(self):
        link = Network(np.array([self.line]), ["same-road"])
        self.assertTrue(ground_link_support(self.line, self.ground, link, False))

    def test_a_crossing_axis_only_supports_a_stop_line(self):
        transverse = Network(np.array([LineString([(10, -2), (10, 2)])]), ["across"])
        marking = LineString([(9, 0), (11, 0)])
        self.assertFalse(ground_link_support(marking, self.ground, transverse, False))
        self.assertTrue(ground_link_support(marking, self.ground, transverse, True))


if __name__ == "__main__":
    unittest.main()
