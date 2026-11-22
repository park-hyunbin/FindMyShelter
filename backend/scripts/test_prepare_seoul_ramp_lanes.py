import unittest

from shapely import STRtree
from shapely.geometry import LineString, box

from prepare_seoul_ramp_curves import bend, restore_bends
from prepare_seoul_ramp_lanes import infer_lanes
from prepare_songpa_road_markings import gps


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


class RampCurveTest(unittest.TestCase):
    def setUp(self):
        self.chord = LineString([(200000, 550000), (200030, 550000)])
        self.axis = LineString([(200000, 550000), (200008, 550001), (200022, 550001), (200030, 550000)])
        self.driveway = self.axis.buffer(0.4)

    def test_bend_inserts_surveyed_points_without_replacing_network_nodes(self):
        coords = gps(list(self.chord.coords))
        road = {"id": 15, "oneWay": 1, "nodeIds": [1, 2], "coordinates": coords}
        updated, gain = restore_bends(road, coords, [self.axis], self.driveway)
        self.assertGreater(gain, 20)
        self.assertEqual([updated["coordinates"][0], updated["coordinates"][-1]], coords)
        self.assertEqual(len(updated["coordinates"]), 4)
        self.assertEqual([node for node in updated["nodeIds"] if node > 0], [1, 2])
        self.assertEqual(len(set(updated["nodeIds"])), len(updated["nodeIds"]))
        self.assertEqual(updated, restore_bends(road, coords, [self.axis], self.driveway)[0])

    def test_does_not_follow_a_link_against_traffic_or_shift_to_a_new_gap(self):
        self.assertIsNone(bend(self.chord, self.axis.reverse(), 1, self.driveway))
        incomplete = box(199999, 549999.8, 200007, 550000.2).union(
            LineString(list(self.axis.coords)[1:]).buffer(0.35)
        )
        self.assertIsNone(bend(self.chord, self.axis, 1, incomplete))


if __name__ == "__main__":
    unittest.main()
