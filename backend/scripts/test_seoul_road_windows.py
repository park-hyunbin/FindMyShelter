from collections import Counter
import unittest

from shapely.geometry import LineString, box
from shapely.ops import unary_union

from prepare_seoul_road_windows import supported_runs


class SupportedRunsTest(unittest.TestCase):
    def setUp(self):
        self.line = LineString([(0, 0), (20, 0)])
        self.window = box(-1, -2, 21, 2)
        self.ground = self.window
        self.rows = [(0, 8, "single_road", 0), (8, 8.04, "overlapping_roads", 0),
                     (8.04, 20, "single_road", 0)]

    def test_one_original_line_continues_across_a_ground_polygon_seam(self):
        restored = Counter()
        runs = list(supported_runs(self.line, self.rows, self.ground, self.window, Counter(), restored))
        self.assertEqual(len(runs), 1)
        self.assertTrue(runs[0].equals(self.line))
        self.assertAlmostEqual(restored["same_ground_overlap"], 0.04)

    def test_do_not_join_across_a_missing_road_surface(self):
        ground = unary_union([box(-1, -2, 8, 2), box(8.04, -2, 21, 2)])
        runs = list(supported_runs(self.line, self.rows, ground, self.window, Counter(), Counter()))
        self.assertEqual(len(runs), 2)

    def test_do_not_join_across_a_structure_or_a_sidewalk(self):
        for status, structure in [("overlapping_roads", 0.04), ("road_and_walk", 0)]:
            with self.subTest(status=status, structure=structure):
                self.rows[1] = (8, 8.04, status, structure)
                runs = list(supported_runs(self.line, self.rows, self.ground, self.window, Counter(), Counter()))
                self.assertEqual(len(runs), 2)


if __name__ == "__main__":
    unittest.main()
