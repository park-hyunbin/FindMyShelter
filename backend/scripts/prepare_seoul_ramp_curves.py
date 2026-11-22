"""Retain surveyed bends in matched Seoul ground ramps."""

import argparse
from collections import defaultdict
import hashlib
from itertools import pairwise
import json
from pathlib import Path

from shapely import union_all
from shapely.geometry import LineString, Point
from shapely.ops import substring

from extract_seoul_road_window import TO_METRES
from prepare_neighborhood_pavement import GRID_M, covered_segments, parts
from prepare_seoul_current_crosswalks import digest, local_polygon
from prepare_seoul_ramp_lanes import MIN_ALIGNMENT, RADIUS_M, infer_lanes, inventory, tangent
from prepare_seoul_road_windows import RAMP_EVIDENCE, align_ground_ramps
from prepare_songpa_road_markings import REGIONS, gps


MIN_SEGMENT_M = 0.25
MIN_GAIN_M = 2


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def outside_stations(line, chord, footprint):
    for piece in parts(line.difference(footprint), "LineString"):
        stations = [chord.project(Point(vertex)) for vertex in piece.coords]
        yield min(stations), max(stations)


def bend(chord, axis, one_way, driveway):
    start, end = chord.coords
    a, b = Point(start), Point(end)
    first, last = axis.project(a), axis.project(b)
    if (last - first) * one_way <= MIN_SEGMENT_M:
        return None
    if a.distance(axis.interpolate(first)) > RADIUS_M or b.distance(axis.interpolate(last)) > RADIUS_M:
        return None
    direction = [(b.x - a.x) * one_way / chord.length, (b.y - a.y) * one_way / chord.length]
    if any(sum(x * y for x, y in zip(direction, tangent(axis, station), strict=True)) < MIN_ALIGNMENT
           for station in (first, last)):
        return None
    original_outside = chord.difference(driveway).length
    if original_outside < MIN_GAIN_M:
        return None
    arc = substring(axis, first, last).simplify(GRID_M * 5)
    vertices = [start]
    for position in arc.coords:
        if Point(position).distance(Point(vertices[-1])) >= MIN_SEGMENT_M and Point(position).distance(b) >= MIN_SEGMENT_M:
            vertices.append(position)
    vertices.append(end)
    if len(vertices) < 3:
        return None
    candidate = LineString(vertices)
    stations = [chord.project(Point(position)) for position in vertices]
    if not candidate.is_simple or candidate.hausdorff_distance(chord) > RADIUS_M \
            or any(right < left for left, right in pairwise(stations)):
        return None
    gain = original_outside - candidate.difference(driveway).length
    if gain < MIN_GAIN_M:
        return None
    # Confirm that the bend does not leave the surveyed carriageway at a new
    # road station. The original ends are retained for network connectivity.
    existing_gaps = list(outside_stations(chord, chord, driveway))
    if any(not any(left - GRID_M <= begin and finish <= right + GRID_M for left, right in existing_gaps)
           for begin, finish in outside_stations(candidate, chord, driveway)):
        return None
    return vertices[1:-1], gain


def restore_bends(road, base, matched_axes, driveway):
    coordinates = [TO_METRES.transform(*position) for position in base]
    nodes = road["nodeIds"]
    new_nodes, new_coordinates = [nodes[0]], [base[0]]
    gain = 0
    for i, (a, b) in enumerate(pairwise(coordinates)):
        chord = LineString([a, b])
        candidates = [result for axis in matched_axes if (result := bend(chord, axis, road["oneWay"], driveway))]
        if len(candidates) == 1:
            interior, saved = candidates[0]
            for ordinal, position in enumerate(gps(interior)):
                key = f"{road['id']}:{nodes[i]}:{nodes[i + 1]}:{ordinal}"
                new_nodes.append(-int.from_bytes(hashlib.sha256(key.encode()).digest()[:6], "big") - 1)
                new_coordinates.append(position)
            gain += saved
        new_nodes.append(nodes[i + 1])
        new_coordinates.append(base[i + 1])
    if not gain:
        return None
    return {**road, "nodeIds": new_nodes, "coordinates": new_coordinates}, gain


def build(archive, regions, output):
    evidence = read(RAMP_EVIDENCE)
    if digest(archive) != evidence["sha256"]:
        raise ValueError("Ramp curves must use the same national archive as the matched ramps")
    graphs, windows, variants = {}, [], defaultdict(list)
    for file in sorted(regions.glob("*/pavement.json")):
        pavement = read(file)
        if not pavement.get("roadDataset"):
            continue
        neighborhood = read(file.with_name("site.geojson"))["metadata"].get("neighborhood")
        graph_file = (regions.parent / "neighborhoods" / neighborhood if neighborhood else file.parent) / "streets.json"
        if graph_file not in graphs:
            graphs[graph_file] = read(graph_file)["roads"]
        driveway = union_all([local_polygon(rings) for rings in pavement["roads"]], grid_size=GRID_M)
        window = file, pavement, driveway
        windows.append(window)
        for road in graphs[graph_file]:
            if (road["motor"] and not road["bridge"] and not road["unpaved"] and road["oneWay"]
                    and road["category"].endswith("_link") and len(road["coordinates"]) >= 2):
                variants[road["id"]].append((road, window))
    if not windows:
        raise ValueError("No paired Seoul pavement windows")
    city_bounds = union_all([window[2].envelope for window in windows]).bounds
    links, index, _ = inventory(archive, city_bounds)
    axes = {link["LINK_ID"]: line for link, line in zip(links, index.geometries, strict=True)
            if link["ROAD_TYPE"] == "000" and link["CONNECT"] == "1"}
    # Include all occurrences of a node so a shared point cannot be adjusted
    # simply because one scene clips an adjoining way.
    node_roads = defaultdict(set)
    for roads in graphs.values():
        for road in roads:
            for node in road["nodeIds"]:
                node_roads[node].add(road["id"])
    node_uses = {key: len(ids) for key, ids in node_roads.items()}
    results = {file: [] for file, _, _ in windows}
    inserted = set()
    considered, matched = 0, 0
    for road_id, uses in sorted(variants.items()):
        road, _ = uses[0]
        if any(other["coordinates"] != road["coordinates"] or other["nodeIds"] != road["nodeIds"]
               or other["oneWay"] != road["oneWay"] for other, _ in uses):
            continue
        if len({window[1]["roadDataset"]["sha256"] for _, window in uses}) != 1:
            continue
        points = [TO_METRES.transform(*position) for position in road["coordinates"]]
        directed = LineString(points if road["oneWay"] == 1 else points[::-1])
        if directed.length < 20:
            continue
        considered += 1
        match = infer_lanes(road, directed, links, index)
        if match is None or any(key not in axes for key in match["links"]):
            continue
        matched += 1
        ids = match["links"]
        footprint = union_all([window[2] for _, window in uses], grid_size=GRID_M)
        base = align_ground_ramps({"roads": [road]}, footprint, {str(road_id): match}, axes, node_uses=node_uses)
        corrected = restore_bends(road, base.get(road_id, road["coordinates"]), [axes[key] for key in ids], footprint)
        if corrected is None:
            continue
        adjusted, gain = corrected
        nodes = {key for key in adjusted["nodeIds"] if key < 0}
        if nodes.intersection(node_uses) or nodes & inserted or len(nodes) + len(road["nodeIds"]) != len(adjusted["nodeIds"]):
            raise ValueError(f"Conflicting ramp curvature nodes for {road_id}")
        inserted.update(nodes)
        for _, (file, _, driveway) in uses:
            results[file].append({"id": road_id, "nodeIds": adjusted["nodeIds"], "coordinates": adjusted["coordinates"],
                                  "vertices": match["vertices"], "oneWay": road["oneWay"],
                                  "links": ids, "reconciledM": round(gain, 2),
                                  "coveredSegments": covered_segments({"roads": [adjusted]}, driveway)})

    for file, pavement, _ in windows:
        pavement.pop("rampCurves", None)
        if results[file]:
            pavement["rampCurves"] = {"sha256": evidence["sha256"], "roads": results[file]}
        target = output / file.parent.name / file.name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(pavement, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return {
        "ground_ramps_considered": considered, "matched_ground_ramps": matched,
        "regions": {file.parent.name: [{key: record[key] for key in ("id", "links", "reconciledM")} for record in records]
                    for file, records in results.items()},
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--regions", type=Path, default=REGIONS)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.archive, args.regions, args.output), indent=2))
