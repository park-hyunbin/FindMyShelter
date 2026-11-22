"""Reconcile displaced one-way elevated centerlines with independent survey sources."""

import argparse
from collections import Counter, defaultdict
from itertools import pairwise
import json
import math
from pathlib import Path
import re

import numpy as np
from shapely import union_all
from shapely.geometry import LineString, Point

from prepare_neighborhood_pavement import covered_segments
from prepare_seoul_current_crosswalks import digest, local_polygon
from prepare_seoul_ramp_lanes import MIN_ALIGNMENT, SOURCE, TO_METRES, inventory, tangent
from prepare_songpa_road_markings import REGIONS, gps


MAX_OFFSET_M = 12
SAMPLE_SPACING_M = 5


def corridor_name(name):
    return re.sub(r"(?:대로|도로|로)$", "", re.sub(r"\s+", "", name or ""))


def survey_match(point, heading, name, links, index):
    candidates = []
    for i in index.query(point, predicate="dwithin", distance=MAX_OFFSET_M):
        link = links[i]
        if link["CONNECT"] != "0" or corridor_name(link["ROAD_NAME"]) != name:
            continue
        line = index.geometries[i]
        station = line.project(point)
        if not 0.05 < station < line.length - 0.05 or np.dot(heading, tangent(line, station)) < MIN_ALIGNMENT:
            continue
        foot = line.interpolate(station)
        candidates.append((point.distance(foot), link["LINK_ID"], i, foot))
    candidates.sort(key=lambda item: item[:2])
    if not candidates or len(candidates) > 1 and candidates[1][0] - candidates[0][0] < 0.75:
        return None
    return candidates[0][2:]


def reconcile(road, nodes, deck, carriageway, links, index):
    originals = road["coordinates"]
    points = [Point(TO_METRES.transform(*position)) for position in originals]
    axis = LineString(points)
    if axis.length < SAMPLE_SPACING_M * 4:
        return None
    name = corridor_name(road["name"])
    count = math.ceil(axis.length / SAMPLE_SPACING_M)
    stations = (np.arange(count) + 0.5) * axis.length / count
    matches = []
    for station in stations:
        point = axis.interpolate(station)
        match = survey_match(point, tangent(axis, station) * road["oneWay"], name, links, index)
        if match and carriageway.covers(match[1]):
            matches.append((station, match[0]))

    if len(matches) < 4:
        return None
    chain = [links[i] for i in dict.fromkeys(i for _, i in matches)]
    if road["oneWay"] == -1:
        chain.reverse()
    if any(a["T_NODE"] != b["F_NODE"] for a, b in pairwise(chain)):
        return None
    replacement = points.copy()
    station = 0
    for i, (before, point) in enumerate(pairwise(points), 1):
        station += before.distance(point)
        if i == len(points) - 1 or nodes[road["nodeIds"][i]] > 1:
            continue
        match = survey_match(point, tangent(axis, station) * road["oneWay"], name, links, index)
        if (match and carriageway.covers(match[1])
            and sum(other == match[0] and abs(station - nearby) <= 20 for nearby, other in matches) >= 4):
            replacement[i] = match[1]

    edges = list(pairwise(points))
    corrected = [LineString(pair) for pair in pairwise(replacement)]
    if any(line.length < 0.05 for line in corrected):
        return None
    original_uncovered = [LineString(pair).difference(deck).length for pair in edges]
    actual_uncovered = [edge.difference(deck).length for edge in corrected]
    saved = [before - after for before, after in zip(original_uncovered, actual_uncovered, strict=True)]
    if min(saved) < -0.35 or sum(saved) < 15:
        return None
    coordinates = [original if old is new else gps([new.coords[0]])[0]
                   for original, old, new in zip(originals, points, replacement, strict=True)]
    return {"id": road["id"], "oneWay": road["oneWay"],
            "vertices": [[node, *point] for node, point in zip(road["nodeIds"], originals, strict=True)],
            "coordinates": coordinates, "links": [link["LINK_ID"] for link in chain],
            "reconciledM": round(sum(saved), 2)}


def owned_decks(pavement):
    result = defaultdict(list)
    for deck in pavement["elevatedRoads"]:
        outline = union_all([local_polygon(rings) for rings in deck["polygons"]])
        dividers = union_all([local_polygon(rings) for island in deck.get("dividers", []) for rings in island["polygons"]])
        for road_id in deck["roadIds"]:
            result[road_id].append((outline, outline.difference(dividers)))
    return result


def reconcile_way_joins(matches, surfaces, node_uses, links, index):
    starts, ends = {}, {}
    for road_id, (match, updated) in matches.items():
        a, b = (0, -1) if match["oneWay"] == 1 else (-1, 0)
        for position, registry in [(a, starts), (b, ends)]:
            node = updated["nodeIds"][position]
            if node_uses[node] == 2 and updated["nodeIds"].count(node) == 1:
                registry[node] = road_id, position
    for node in sorted(starts.keys() & ends.keys()):
        incoming, i = ends[node]
        outgoing, j = starts[node]
        if incoming == outgoing:
            continue
        before, arrived = matches[incoming]
        after, departing = matches[outgoing]
        common_links = set(before["links"]) & set(after["links"])
        if not common_links or corridor_name(arrived["name"]) != corridor_name(departing["name"]):
            continue
        raw = arrived["coordinates"][i]
        if raw != departing["coordinates"][j]:
            continue
        a = Point(TO_METRES.transform(*arrived["coordinates"][-2 if i == -1 else 1]))
        b = Point(TO_METRES.transform(*departing["coordinates"][-2 if j == -1 else 1]))
        heading = np.array([b.x - a.x, b.y - a.y]) / max(a.distance(b), 1e-6)
        point = Point(TO_METRES.transform(*raw))
        hit = survey_match(point, heading, corridor_name(arrived["name"]), links, index)
        if not hit or links[hit[0]]["LINK_ID"] not in common_links:
            continue
        foot = hit[1]
        left, left_carriageway = surfaces[incoming]
        right, right_carriageway = surfaces[outgoing]
        approach, departure = LineString([a, foot]), LineString([foot, b])
        if (point.distance(foot) < 0.05 or not left_carriageway.buffer(0.15).covers(approach)
            or not right_carriageway.buffer(0.15).covers(departure)):
            continue
        corrected = gps([foot.coords[0]])[0]
        arrived["coordinates"][i] = corrected
        departing["coordinates"][j] = corrected
        for evidence, deck, old, new in [(before, left, LineString([a, point]), approach),
                                         (after, right, LineString([point, b]), departure)]:
            evidence.setdefault("adjustedWayJoins", []).append(node)
            evidence["reconciledM"] = round(evidence["reconciledM"] + old.difference(deck).length
                                            - new.difference(deck).length, 2)


def build(archive, regions, output):
    graph_windows = defaultdict(list)
    extents = []
    for file in sorted(regions.glob("*/pavement.json")):
        pavement = json.loads(file.read_text(encoding="utf-8"))
        if not pavement.get("roadDataset") or not pavement.get("elevatedRoads"):
            continue
        site = json.loads(file.with_name("site.geojson").read_text(encoding="utf-8"))
        neighborhood = site.get("metadata", {}).get("neighborhood")
        graph_file = (regions.parent / "neighborhoods" / neighborhood if neighborhood else file.parent) / "streets.json"
        structures = tuple(sorted(source["sha256"] for source in pavement.get("structureSources", [])))
        graph_windows[graph_file, pavement["roadDataset"]["sha256"], structures].append((file, pavement, owned_decks(pavement)))
        extents.append(TO_METRES.transform_bounds(*pavement["roadDataset"]["bounds"]))
    if not graph_windows:
        raise ValueError("No paired elevated pavement windows")
    bounds = (*np.min(extents, axis=0)[:2] - 30, *np.max(extents, axis=0)[2:] + 30)
    links, index, date = inventory(archive, bounds)
    metadata = {"url": SOURCE, "archiveFileDate": date, "sha256": digest(archive)}
    results = {}
    for (graph_file, _, _), windows in graph_windows.items():
        roads = json.loads(graph_file.read_text(encoding="utf-8"))["roads"]
        node_uses = Counter(node for road in roads for node in set(road["nodeIds"]))
        matches = {}
        surfaces = {}
        for road in roads:
            if not (road["motor"] and not road["unpaved"] and road["bridge"] and road["oneWay"] and road.get("name")
                    and not road["category"].endswith("_link") and len(road["coordinates"]) > 2):
                continue
            assigned = [pair for _, _, decks in windows for pair in decks.get(road["id"], [])]
            if not assigned:
                continue
            deck = union_all([outline for outline, _ in assigned])
            carriageway = union_all([surface for _, surface in assigned])
            match = reconcile(road, node_uses, deck, carriageway, links, index)
            if match:
                matches[road["id"]] = match, {**road, "coordinates": match["coordinates"]}
                surfaces[road["id"]] = deck, carriageway
        reconcile_way_joins(matches, surfaces, node_uses, links, index)
        for file, pavement, decks in windows:
            pavement.pop("elevatedAlignment", None)
            records = []
            for road_id, (match, updated) in matches.items():
                if road_id not in decks:
                    continue
                deck = union_all([outline for outline, _ in decks[road_id]])
                covered = covered_segments({"roads": [updated]}, deck, {road_id})
                records.append({**match, "coveredSegments": covered})
            if records:
                pavement["elevatedAlignment"] = {**metadata, "roads": records}
            target = output / file.parent.name / file.name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(pavement, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
            results[file.parent.name] = [{"id": r["id"], "coveredM": r["reconciledM"], "links": r["links"]} for r in records]
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--regions", type=Path, default=REGIONS)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.archive, args.regions, args.output), ensure_ascii=False, indent=2))
