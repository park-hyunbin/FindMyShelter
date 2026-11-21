"""Find persistent inner-road boundary pairs around unmatched Seoul marking runs."""

import argparse
from collections import Counter, defaultdict
from contextlib import closing
from itertools import islice
import json
from pathlib import Path
import sqlite3

import numpy as np
from shapely import (
    STRtree, from_wkb, get_parts, get_type_id, intersection, line_interpolate_point,
    line_locate_point, linestrings,
)
from shapely.geometry import shape

from audit_seoul_road_sources import layer_metadata, open_layer


MIN_SPAN_M = 3.0
STATION_SPACING_M = 5.0
MAX_SIDE_DISTANCE_M = 18.0
TIE_DISTANCE_M = 0.05


def load_edges(directory):
    lines, ids = [], []
    with open_layer(directory, "internal-road-edges", attributes=True) as source:
        for record in source.iterShapeRecords(fields=["UFID"]):
            if record.shape.points and record.record["UFID"]:
                lines.append(shape(record.shape.__geo_interface__))
                ids.append(record.record["UFID"])
    if not lines:
        raise ValueError("No usable internal road boundaries")
    return STRtree(lines), ids


def nearest_owner(hits):
    if not hits:
        return None
    owner = min(hits, key=hits.get)
    distance = hits[owner]
    if any(key != owner and other - distance < TIE_DISTANCE_M for key, other in hits.items()):
        return None
    return owner, distance


def opposite_edges(cross_sections, tree, ids):
    section_ids, edge_ids = tree.query(cross_sections, predicate="intersects")
    geometries = intersection(cross_sections[section_ids], tree.geometries[edge_ids])
    points, parents = get_parts(geometries, return_index=True)
    point_parts = get_type_id(points) == 0
    parents = parents[point_parts]
    sections = section_ids[parents]
    offsets = line_locate_point(cross_sections[sections], points[point_parts]) - MAX_SIDE_DISTANCE_M

    left, right = [defaultdict(dict) for _ in range(2)]
    for section, edge, offset in zip(sections, edge_ids[parents], offsets):
        if abs(offset) < TIE_DISTANCE_M:
            continue
        side = left if offset < 0 else right
        owner = ids[edge]
        side[section][owner] = min(abs(offset), side[section].get(owner, MAX_SIDE_DISTANCE_M))

    pairs = []
    for section in range(len(cross_sections)):
        a = nearest_owner(left[section])
        b = nearest_owner(right[section])
        pairs.append((a[0], b[0], a[1] + b[1]) if a and b and a[0] != b[0] else None)
    return pairs


def probe_batch(rows, tree, edge_ids):
    lines = from_wkb([row[5] for row in rows])
    starts = np.asarray([row[1] for row in rows])
    lengths = np.asarray([row[2] - row[1] for row in rows])
    counts = np.maximum(3, np.ceil(lengths / STATION_SPACING_M).astype(int))
    indices = np.repeat(np.arange(len(rows)), counts)
    local = np.arange(len(indices)) - np.repeat(np.cumsum(counts) - counts, counts)
    distances = starts[indices] + lengths[indices] * (local + 0.5) / counts[indices]
    points = line_interpolate_point(lines[indices], distances)
    step = np.minimum(0.25, lengths[indices] / (4 * counts[indices]))
    a = line_interpolate_point(lines[indices], distances - step)
    b = line_interpolate_point(lines[indices], distances + step)
    centers = np.asarray([[point.x, point.y] for point in points])
    deltas = np.asarray([(last.x - first.x, last.y - first.y) for first, last in zip(a, b)])
    normals = deltas[:, [1, 0]] * [-1, 1]
    norms = np.linalg.norm(normals, axis=1)
    valid = norms > 0
    normals[valid] *= (MAX_SIDE_DISTANCE_M / norms[valid])[:, None]
    if not np.any(valid):
        return [None] * len(rows)
    cross_sections = linestrings(np.stack((centers[valid] - normals[valid], centers[valid] + normals[valid]), axis=1))
    pairs = [None] * len(indices)
    for i, pair in zip(np.flatnonzero(valid), opposite_edges(cross_sections, tree, edge_ids)):
        pairs[i] = pair

    matches, start = [], 0
    for count in counts:
        stations = pairs[start:start + count]
        start += count
        first = stations[0]
        if first and all(pair and first[:2] == pair[:2] for pair in stations):
            widths = [pair[2] for pair in stations]
            matches.append({"edges": first[:2], "width_range_m": [min(widths), max(widths)]})
        else:
            matches.append(None)
    return matches


def probe(directory, database):
    tree, edge_ids = load_edges(directory)
    districts, candidates = defaultdict(Counter), []
    with closing(sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        rows = db.execute("""SELECT s.marking_id, s.start_m, s.end_m, m.district, m.management_id, m.geometry
            FROM span s JOIN marking m ON m.id=s.marking_id
            WHERE s.status='outside_road' AND s.end_m-s.start_m>=? AND m.style!='stop'
            ORDER BY s.marking_id,s.start_m""", (MIN_SPAN_M,))
        while batch := list(islice(rows, 512)):
            for row, match in zip(batch, probe_batch(batch, tree, edge_ids)):
                id_, start, end, district, management, _ = row
                districts[district]["tested_spans"] += 1
                districts[district]["tested_m"] += end - start
                if match is not None:
                    districts[district]["candidate_spans"] += 1
                    districts[district]["candidate_m"] += end - start
                    candidates.append({"marking_id": id_, "management_id": management, "district": district,
                                       "start_m": start, "end_m": end, **match})
    total = Counter()
    for stats in districts.values():
        total.update(stats)
    return {"source": layer_metadata(directory, "internal-road-edges"), "min_span_m": MIN_SPAN_M,
            "station_spacing_m": STATION_SPACING_M, "max_side_distance_m": MAX_SIDE_DISTANCE_M,
            "districts": dict(sorted(districts.items())), "total": dict(total), "candidates": candidates}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path, help="Directory with the official source bundle")
    parser.add_argument("database", type=Path, help="Seoul marking SQLite spatial index")
    parser.add_argument("output", type=Path, help="JSON candidate report")
    args = parser.parse_args()
    if args.output.suffix.lower() != ".json":
        parser.error("output must have a .json suffix")
    report = probe(args.directory, args.database)
    args.output.write_text(json.dumps(report, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps(report["total"], ensure_ascii=False))


if __name__ == "__main__":
    main()
