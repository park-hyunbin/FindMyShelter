from collections import Counter
import unittest

import numpy as np
from shapely import STRtree
from shapely.geometry import LineString, box
from shapely.ops import unary_union

from prepare_seoul_elevated_markings import export_window, unambiguous_deck_paint
from prepare_seoul_lane_windows import lane_item
from prepare_seoul_road_windows import CentrelineEvidence, align_ground_ramps, ground_link_support, supported_runs
from prepare_songpa_road_markings import gps, lane_style
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


class RampAlignmentTest(unittest.TestCase):
    def setUp(self):
        self.axis = LineString([(200000, 550000), (200020, 550000)])
        self.road = {"id": 20, "nodeIds": [1, 2, 3], "oneWay": 1, "bridge": False,
                     "coordinates": gps([(200000, 550000), (200010, 550002), (200020, 550000)])}
        self.evidence = {"20": {"vertices": [[node, *position] for node, position in
                                              zip(self.road["nodeIds"], self.road["coordinates"], strict=True)],
                                 "oneWay": 1, "links": ["ramp"]}}
        self.pavement = box(199999, 549999.1, 200021, 550000.9)

    def test_aligned_road_returns_to_the_measured_surface_between_junctions(self):
        result = align_ground_ramps({"roads": [self.road]}, self.pavement, self.evidence, {"ramp": self.axis})
        self.assertEqual(result[20], gps([(200000, 550000), (200010, 550000), (200020, 550000)]))

    def test_shared_nodes_and_reversed_links_keep_their_original_geometry(self):
        intersecting = {"id": 40, "nodeIds": [2, 4], "oneWay": 0, "bridge": False}
        self.assertFalse(align_ground_ramps({"roads": [self.road, intersecting]}, self.pavement,
                                            self.evidence, {"ramp": self.axis}))
        self.assertFalse(align_ground_ramps({"roads": [self.road]}, self.pavement, self.evidence,
                                            {"ramp": self.axis.reverse()}))


class SupportedRunsTest(unittest.TestCase):
    def setUp(self):
        self.line = LineString([(0, 0), (20, 0)])
        self.window = box(-1, -2, 21, 2)
        self.ground = self.window
        self.rows = [(0, 8, "single_road", 0), (8, 8.04, "overlapping_roads", 0),
                     (8.04, 20, "single_road", 0)]

    def runs(self, ground=None, restored=None, confirm_ground=lambda line: [], *, is_stop=False):
        return list(supported_runs(self.line, self.rows, self.ground if ground is None else ground,
                                   self.window, Counter(), restored if restored is not None else Counter(),
                                   confirm_ground, is_stop=is_stop))

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

    def test_one_unsupported_station_does_not_erase_the_entire_centerline(self):
        self.rows = [(0, 20, "single_road", 4)]
        ground = unary_union([box(-1, -1, 12, 1), box(13, -1, 21, 1)])
        links = Network(np.array([LineString([(0, 0.5), (8, 0.5)]),
                                  LineString([(13, 0.5), (20, 0.5)])]), ["west", "east"])
        runs = self.runs(ground=ground, confirm_ground=lambda line: ground_link_support(line, ground, links, False))
        self.assertEqual([(line.coords[0][0], line.coords[-1][0]) for line in runs], [(0, 8), (13, 20)])

    def test_stop_line_is_not_partially_recovered_across_a_road_gap(self):
        self.rows = [(0, 20, "single_road", 4)]
        ground = unary_union([box(-1, -1, 12, 1), box(13, -1, 21, 1)])
        runs = self.runs(ground=ground, confirm_ground=lambda line: [(0, line.length)], is_stop=True)
        self.assertEqual(runs, [])

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


class CentrelinePairTest(unittest.TestCase):
    road = ("Main Road", "61")
    original = LineString([(0, 0), (20, 0)])
    ground = box(-1, -4, 21, 4)

    def links(self, other_road=None, *, other_side=-1, reverse=True, extra=False):
        a = LineString([(0, 1), (20, 1)])
        b = LineString([(0, other_side), (20, other_side)])
        lines = [a, b.reverse() if reverse else b]
        roads = [self.road, self.road if other_road is None else other_road]
        if extra:
            lines.append(LineString([(0, 1.5), (20, 1.5)]))
            roads.append(self.road)
        return Network(np.array(lines), list(range(len(lines))), roads=roads)

    def support(self, links, *, graded_y=10, footprints=(), ground=None):
        graded = Network(np.array([LineString([(0, graded_y), (20, graded_y)])]), ["graded"])
        evidence = CentrelineEvidence(graded, np.array([True]), STRtree(footprints))
        return ground_link_support(self.original, self.ground if ground is None else ground, links, False,
                                   centreline=evidence)

    def test_two_links_of_one_road_can_confirm_the_original_stripe(self):
        links = self.links()
        self.assertEqual(ground_link_support(self.original, self.ground, links, False), [])
        self.assertEqual(self.support(links), [(0, 20)])

    def test_the_pair_must_belong_to_one_identified_road_and_straddle_the_stripe(self):
        for links in [self.links(("Side Road", "61")), self.links(("Main Road", "62")),
                      self.links(other_side=1.5), self.links(reverse=False), self.links(extra=True)]:
            with self.subTest(links=links.roads):
                self.assertEqual(self.support(links), [])

    def test_competing_graded_link_blocks_a_pair_even_outside_the_ground_polygon(self):
        self.assertEqual(self.support(self.links(), graded_y=2, ground=box(-1, -1.1, 21, 1.1)), [])

    def test_structure_footprint_blocks_the_interval_even_between_sample_centres(self):
        self.assertEqual(self.support(self.links(), footprints=[box(4.1, -1, 4.2, 1)]), [(0, 4), (8, 20)])


class DeckPaintTest(unittest.TestCase):
    def test_a_road_with_a_ground_approach_keeps_verified_sections_on_each_deck(self):
        def outline(start, end):
            return [gps(box(200000 + start, 549998, 200000 + end, 550002).exterior.coords)]

        original = LineString([(200000, 550000), (200070, 550000)])
        observed = LineString([(200044, 550000.2), (200058, 550000.2)])
        pavement = {
            "roadDataset": {"sha256": "snapshot"},
            "structureSources": [{"sha256": "structures"}],
            "roads": [outline(0, 12)],
            "sidewalks": [outline(58, 60)],
            "elevatedRoads": [
                {"sourceId": "first", "roadIds": [10], "polygons": [outline(0, 37)]},
                {"sourceId": "second", "roadIds": [20], "polygons": [outline(37, 70)]},
            ],
        }
        roads = [{"id": id_, "motor": True, "bridge": True, "unpaved": False,
                  "coordinates": gps([(200000 + start, 550001), (200000 + end, 550001)])}
                 for id_, start, end in [(10, 0, 37), (20, 37, 70)]]
        markings = {"roadDataset": pavement["roadDataset"]}
        export_window(markings, pavement, "snapshot", [("observed", "2", "001", "yellow", observed)],
                      STRtree([observed]), [("original", "1", "001", "yellow-dash", original)],
                      STRtree([original]), roads)
        records = markings["elevatedMarkings"]["records"]
        inferred = [record for record in records if record.get("sourceLevel") == "001"]
        self.assertEqual([record["deckId"] for record in inferred], ["first", "second"])
        self.assertAlmostEqual(inferred[0]["dashOffsetM"], 12.02, delta=0.02)
        self.assertAlmostEqual(inferred[1]["dashOffsetM"], 60.02, delta=0.02)
        self.assertEqual([record["featureId"] for record in records if record["managementId"] == "2"], ["observed"])

    def test_crossing_ground_road_does_not_claim_bridge_paint(self):
        line = LineString([(0, 0), (20, 0)])
        outline = box(-1, -2, 21, 2)
        upper = Network(np.array([LineString([(0, 1), (20, 1)])]), ["bridge"])
        lower = Network(np.array([LineString([(10, -2), (10, 2)])]), ["ground"])
        self.assertEqual(list(unambiguous_deck_paint(line, outline, outline, upper, lower)), [line])

    def test_parallel_ground_axis_keeps_the_conflicting_section_unassigned(self):
        line = LineString([(0, 0), (20, 0)])
        outline = box(-1, -2, 21, 2)
        upper = Network(np.array([LineString([(0, 1), (20, 1)])]), ["bridge"])
        lower = Network(np.array([LineString([(8, -1), (12, -1)])]), ["ground"])
        self.assertEqual([item.length for item in unambiguous_deck_paint(line, outline, outline, upper, lower)], [8, 8])

    def test_deck_divider_blocks_matching_to_the_other_carriageway(self):
        line = LineString([(0, 0), (20, 0)])
        outline = box(-1, -2, 21, 2)
        pavement = outline.difference(box(-1, .3, 21, .7))
        upper = Network(np.array([LineString([(0, 1), (20, 1)])]), ["bridge"])
        self.assertEqual(list(unambiguous_deck_paint(line, pavement, outline, upper, None)), [])


if __name__ == "__main__":
    unittest.main()
