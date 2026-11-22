import unittest

from shapely.geometry import LineString, box
from shapely.ops import unary_union

from extract_seoul_road_window import TO_METRES
from prepare_seoul_directional_road_curves import corrected_axis, opposite_pairs, surveyed_runs
from prepare_songpa_road_markings import gps


class DirectionalCarriagewayTest(unittest.TestCase):
    def setUp(self):
        self.vertices = [(200000 + x, 550000) for x in (0, 8, 50, 92, 100)]
        self.original = LineString(self.vertices)
        self.opposite = LineString([(200000, 550000), (200008, 550004),
                                    (200092, 550004), (200100, 550000)])
        self.pavement = unary_union([box(200004, 550002, 200096, 550007),
                                    box(200004, 549993, 200096, 549998)])
        self.road = {"id": 10, "nodeIds": [1, 3, 4, 5, 2], "coordinates": gps(self.vertices),
                     "name": "Main", "oneWay": 1, "category": "residential", "motor": True,
                     "bridge": False, "unpaved": False}

    def test_reverse_ways_must_share_the_same_directed_connections(self):
        mate = {**self.road, "id": 20, "nodeIds": [2, 7, 1], "coordinates": gps(self.opposite.reverse().coords)}
        self.assertEqual(list(opposite_pairs([self.road, mate])), [(self.road, mate)])
        self.assertEqual(list(opposite_pairs([self.road, {**mate, "oneWay": -1}])), [])

    def test_alignment_uses_the_surveyed_carriageway_and_keeps_every_junction(self):
        runs = list(surveyed_runs(self.original, self.opposite, self.pavement, 1))
        adjusted, gain = corrected_axis(self.road, self.original, runs, self.pavement)
        self.assertGreater(gain, 50)
        self.assertEqual([(node, point) for node, point in zip(adjusted["nodeIds"], adjusted["coordinates"], strict=True)
                          if node >= 0], list(zip(self.road["nodeIds"], self.road["coordinates"], strict=True)))
        projected = [TO_METRES.transform(*p) for node, p in zip(adjusted["nodeIds"], adjusted["coordinates"], strict=True)
                     if node < 0]
        self.assertTrue(projected)
        self.assertTrue(all(y < 549998 for _, y in projected))

    def test_a_single_surveyed_strip_cannot_confirm_the_other_direction(self):
        ground = box(200004, 550002, 200096, 550007)
        self.assertEqual(list(surveyed_runs(self.original, self.opposite, ground, 1)), [])


if __name__ == "__main__":
    unittest.main()
