import unittest

from shapely import STRtree
from shapely.geometry import LineString

from prepare_seoul_ramp_lanes import infer_lanes


class RampLaneEvidenceTest(unittest.TestCase):
    road = {"nodeIds": [1, 2], "coordinates": [(127, 37), (127.001, 37)], "oneWay": 1, "bridge": False}
    axis = LineString([(0, 0), (120, 0)])

    def match(self, *candidates):
        attributes = [link for link, _ in candidates]
        index = STRtree([geometry for _, geometry in candidates])
        return infer_lanes(self.road, self.axis, attributes, index)

    def link(self, identifier="ramp", lanes=1, connection="1", level="000", coordinates=((0, 2), (120, 2))):
        return (
            {"LINK_ID": identifier, "LANES": lanes, "CONNECT": connection, "ROAD_TYPE": level,
             "F_NODE": identifier + "-start", "T_NODE": identifier + "-end"},
            LineString(coordinates),
        )

    def test_uses_aligned_connection_lane_count(self):
        result = self.match(self.link())
        self.assertEqual(result["lanes"], 1)
        self.assertEqual(result["links"], ["ramp"])

    def test_rejects_the_wrong_direction_or_level(self):
        self.assertIsNone(self.match(self.link(coordinates=((120, 2), (0, 2)))))
        self.assertIsNone(self.match(self.link(level="001")))
        self.assertIsNone(self.match(self.link(), self.link("overpass", level="001")))

    def test_rejects_mainline_or_ambiguous_parallel_connection(self):
        self.assertIsNone(self.match(self.link(), self.link("main", connection="0", coordinates=((0, 0), (120, 0)))))
        self.assertIsNone(self.match(self.link(), self.link("other", lanes=2, coordinates=((0, 2.5), (120, 2.5)))))

    def test_rejects_unconnected_sources_with_the_same_lane_count(self):
        a = self.link("first", coordinates=((0, 2), (60, 2)))
        b = self.link("second", coordinates=((60, 2), (120, 2)))
        self.assertIsNone(self.match(a, b))


if __name__ == "__main__":
    unittest.main()
