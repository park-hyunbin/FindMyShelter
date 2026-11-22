"""Keep paired one-way roads inside their separately surveyed carriageways."""

import argparse
from collections import defaultdict
import hashlib
from itertools import pairwise
import json
from pathlib import Path

import numpy as np
from shapely import union_all
from shapely.geometry import LineString, Point

from extract_seoul_road_window import TO_METRES
from prepare_neighborhood_pavement import GRID_M, covered_segments, parts
from prepare_seoul_current_crosswalks import local_polygon
from prepare_seoul_ramp_curves import outside_stations, read
from prepare_seoul_ramp_lanes import MIN_ALIGNMENT, tangent
from prepare_songpa_road_markings import REGIONS, gps


STEP_M = 4
SECTION_RADIUS_M = 13
MIN_RUN_SAMPLES = 5
MAX_SHIFT_M = 5


def opposite_pairs(roads):
    by_endpoints = defaultdict(list)
    for road in roads:
        if not (road["motor"] and road["oneWay"] and road.get("name") and not road["category"].endswith("_link")
                and not road["bridge"]
                and not road["unpaved"] and len(road["coordinates"]) >= 2):
            continue
        a, b = road["nodeIds"][0], road["nodeIds"][-1]
        start, end = (a, b) if road["oneWay"] == 1 else (b, a)
        by_endpoints[road["name"], start, end].append(road)
    for (name, start, end), forward in by_endpoints.items():
        backward = by_endpoints.get((name, end, start), [])
        if start < end and len(forward) == len(backward) == 1:
            yield forward[0], backward[0]


def carriageway_point(axis, other, pavement, station, one_way):
    center = np.asarray(axis.interpolate(station).coords[0])
    heading = tangent(axis, station) * one_way
    left = np.array([-heading[1], heading[0]])
    point = Point(center)
    near = other.project(point)
    mate = other.interpolate(near)
    lateral = np.dot(np.asarray(mate.coords[0]) - center, left)
    if lateral <= GRID_M or point.distance(mate) > SECTION_RADIUS_M or (
        abs(np.dot(tangent(other, near), heading)) < MIN_ALIGNMENT
    ):
        return None
    ray = LineString([center - SECTION_RADIUS_M * left, center + SECTION_RADIUS_M * left])
    sections = [sorted(np.dot(np.asarray(p) - center, left) for p in (part.coords[0], part.coords[-1]))
                for part in parts(ray.intersection(pavement), "LineString")]
    if any(a - GRID_M <= 0 <= b + GRID_M for a, b in sections):
        return None
    known = [side for side in sections if side[0] - GRID_M <= lateral <= side[1] + GRID_M]
    alternatives = [side for side in sections if side[1] < -GRID_M and -side[1] <= MAX_SHIFT_M]
    if len(known) != 1 or len(alternatives) != 1:
        return None
    start, stop = alternatives[0]
    middle = (start + stop) / 2
    if not 2 <= stop - start <= 9 or -middle > MAX_SHIFT_M:
        return None
    return tuple(center + middle * left)


def surveyed_runs(axis, other, pavement, one_way):
    run = []
    for station in np.arange(STEP_M * 2, axis.length - STEP_M * 2, STEP_M):
        point = carriageway_point(axis, other, pavement, float(station), one_way)
        if point is None or (run and not pavement.covers(LineString([run[-1][1], point]))):
            if len(run) >= MIN_RUN_SAMPLES:
                yield run
            run = []
        if point is not None:
            run.append((float(station), point))
    if len(run) >= MIN_RUN_SAMPLES:
        yield run


def corrected_axis(road, axis, runs, pavement):
    source = road["coordinates"]
    nodes = road["nodeIds"]
    coordinates, node_ids = [source[0]], [nodes[0]]
    gain = 0
    station = 0
    for i, (a, b) in enumerate(pairwise(axis.coords)):
        chord = LineString([a, b])
        end = station + chord.length
        vertices = [point for run in runs for at, point in run if station + 2 < at < end - 2]
        adjusted = LineString([a, *vertices, b])
        positions = [chord.project(Point(point)) for point in vertices]
        saved = chord.difference(pavement).length - adjusted.difference(pavement).length
        before = list(outside_stations(chord, chord, pavement))
        if vertices and adjusted.is_simple and adjusted.hausdorff_distance(chord) <= MAX_SHIFT_M \
                and all(left < right for left, right in pairwise(positions)) and saved >= STEP_M \
                and all(any(a - GRID_M <= from_ and to <= b + GRID_M for a, b in before)
                        for from_, to in outside_stations(adjusted, chord, pavement)):
            for ordinal, position in enumerate(gps(vertices)):
                key = f"carriageway:{road['id']}:{nodes[i]}:{nodes[i + 1]}:{ordinal}"
                node_ids.append(-int.from_bytes(hashlib.sha256(key.encode()).digest()[:6], "big") - 1)
                coordinates.append(position)
            gain += saved
        node_ids.append(nodes[i + 1])
        coordinates.append(source[i + 1])
        station = end
    if gain:
        return {**road, "coordinates": coordinates, "nodeIds": node_ids}, round(gain, 2)
    return None


def build(regions, output):
    groups = defaultdict(list)
    for file in sorted(regions.glob("*/pavement.json")):
        pavement = read(file)
        if not pavement.get("roadDataset"):
            continue
        neighborhood = read(file.with_name("site.geojson"))["metadata"].get("neighborhood")
        if not neighborhood:
            continue
        graph = regions.parent / "neighborhoods" / neighborhood / "streets.json"
        driveway = union_all([local_polygon(rings) for rings in pavement["roads"]], grid_size=GRID_M)
        groups[graph, pavement["roadDataset"]["sha256"]].append((file, pavement, driveway))

    result = {}
    for (graph, sha), windows in groups.items():
        pavement = union_all([driveway for _, _, driveway in windows], grid_size=GRID_M)
        matched = []
        for a, b in opposite_pairs(read(graph)["roads"]):
            pair = []
            for road in (a, b):
                axis = LineString([TO_METRES.transform(*point) for point in road["coordinates"]])
                if axis.length:
                    pair.append((axis.intersection(pavement).length / axis.length, axis, road))
            if len(pair) != 2:
                continue
            (known, other, mate), (coverage, axis, road) = sorted(pair, key=lambda entry: -entry[0])
            if known < 0.8 or coverage > 0.45:
                continue
            runs = list(surveyed_runs(axis, other, pavement, road["oneWay"]))
            match = corrected_axis(road, axis, runs, pavement)
            if match:
                adjusted, gain = match
                matched.append((adjusted, {
                    "id": road["id"], "otherRoadId": mate["id"], "reconciledM": gain,
                    "vertices": [[node, *point] for node, point in zip(road["nodeIds"], road["coordinates"], strict=True)],
                    "oneWay": road["oneWay"], "nodeIds": adjusted["nodeIds"], "coordinates": adjusted["coordinates"],
                }))
        for file, previous, driveway in windows:
            previous.pop("surveyedCarriagewayCurves", None)
            curves = [{**entry, "coveredSegments": covered_segments({"roads": [road]}, driveway)}
                      for road, entry in matched if driveway.intersects(
                          LineString([TO_METRES.transform(*point) for point in road["coordinates"]])
                      )]
            if curves:
                previous["surveyedCarriagewayCurves"] = {"sha256": sha, "roads": curves}
            destination = output / file.parent.name / file.name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(json.dumps(previous, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
            result[file.parent.name] = [{"id": curve["id"], "reconciledM": curve["reconciledM"]} for curve in curves]
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--regions", type=Path, default=REGIONS)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.regions, args.output), indent=2))
