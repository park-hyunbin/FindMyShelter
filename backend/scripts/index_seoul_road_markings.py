"""Index Seoul lane geometry and its exact overlaps with mapped road surfaces."""

import argparse
from collections import Counter, defaultdict
from itertools import groupby, islice
import json
import logging
from pathlib import Path
import sqlite3
from tempfile import NamedTemporaryFile

import numpy as np
from shapely import (
    STRtree, get_coordinates, get_parts, get_point, get_type_id,
    intersection, is_valid, line_locate_point, linestrings, make_valid,
    to_wkb,
)
from shapely.geometry import MultiPolygon, shape

from audit_seoul_road_sources import LANE_FIELDS, layer_metadata, open_layer
from prepare_neighborhood_pavement import parts
from prepare_songpa_road_markings import lane_style


EPSILON = 1e-8
SOURCE_LAYERS = ("road", "walk", "lanes", "bus-lanes")

SCHEMA = """
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE road (id INTEGER PRIMARY KEY, ufid TEXT NOT NULL, geometry BLOB NOT NULL);
CREATE VIRTUAL TABLE road_bounds USING rtree(id, min_x, max_x, min_y, max_y);
CREATE TABLE walk (id INTEGER PRIMARY KEY, ufid TEXT NOT NULL, geometry BLOB NOT NULL);
CREATE VIRTUAL TABLE walk_bounds USING rtree(id, min_x, max_x, min_y, max_y);
CREATE TABLE marking (
    id INTEGER PRIMARY KEY, source TEXT NOT NULL, source_row INTEGER NOT NULL,
    part INTEGER NOT NULL, management_id TEXT NOT NULL, district TEXT NOT NULL,
    style TEXT NOT NULL, geometry BLOB NOT NULL, UNIQUE(source, source_row, part)
);
CREATE VIRTUAL TABLE marking_bounds USING rtree(id, min_x, max_x, min_y, max_y);
CREATE TABLE span (
    marking_id INTEGER NOT NULL REFERENCES marking(id),
    start_m REAL NOT NULL, end_m REAL NOT NULL CHECK(end_m > start_m),
    status TEXT NOT NULL, road_id INTEGER REFERENCES road(id),
    candidates TEXT NOT NULL,
    PRIMARY KEY(marking_id, start_m)
);
CREATE INDEX span_road ON span(road_id) WHERE road_id IS NOT NULL;
CREATE INDEX marking_management ON marking(management_id);
"""


def rect(id_, geometry):
    min_x, min_y, max_x, max_y = geometry.bounds
    return id_, min_x, max_x, min_y, max_y


def surface_index(directory, db, layer):
    polygons, owners = [], []
    with open_layer(directory, layer, attributes=True) as reader:
        for row in reader.iterShapeRecords(fields=["UFID"]):
            if not row.shape.points:
                continue
            geometry = shape(row.shape.__geo_interface__)
            if not is_valid(geometry):
                geometry = make_valid(geometry)
            faces = list(parts(geometry, "Polygon"))
            if not faces:
                continue
            geometry = faces[0] if len(faces) == 1 else MultiPolygon(faces)
            id_ = row.record.oid + 1
            db.execute(f"INSERT INTO {layer} VALUES (?,?,?)", (id_, row.record["UFID"], to_wkb(geometry)))
            db.execute(f"INSERT INTO {layer}_bounds VALUES (?,?,?,?,?)", rect(id_, geometry))
            polygons.extend(faces)
            owners.extend([id_] * len(faces))
    if not polygons:
        raise ValueError(f"No usable {layer} polygons")
    return STRtree(polygons), np.asarray(owners)

def marking_parts(directory, layer):
    with open_layer(directory, layer, attributes=True) as reader:
        for row in reader.iterShapeRecords(fields=LANE_FIELDS):
            tags = row.record
            if (tags["STAT_CDE"], tags["VIEW_CDE"]) != ("001", "002"):
                continue
            style = lane_style(tags["A058_KND_C"], tags["A058_KND2_"])
            if style is None or not row.shape.points:
                continue
            for part, line in enumerate(parts(shape(row.shape.__geo_interface__), "LineString")):
                if line.length > 0.25 and np.isfinite(line.length):
                    yield (layer, tags.oid, part, tags["MGRNU"], tags["GU_CDE"], style, line)


def add_intersections(edges, tree, owners, events):
    edge_ids, polygon_ids = tree.query(edges, predicate="intersects")
    clipped = intersection(edges[edge_ids], tree.geometries[polygon_ids])
    fragments, parent = get_parts(clipped, return_index=True)
    linear = get_type_id(fragments) == 1
    parent, lines = parent[linear], fragments[linear]
    edge_ids = edge_ids[parent]
    owner_ids = owners[polygon_ids[parent]]
    first = line_locate_point(edges[edge_ids], get_point(lines, 0), normalized=True)
    last = line_locate_point(edges[edge_ids], get_point(lines, -1), normalized=True)
    for edge, owner, a, b in zip(edge_ids, owner_ids, np.minimum(first, last), np.maximum(first, last)):
        if b - a > EPSILON:
            events[edge].extend(((float(a), int(owner), 1), (float(b), int(owner), -1)))


def span_status(active):
    candidates = tuple(sorted(owner for owner, count in active.items() if owner and count > 0))
    if active[0] > 0:
        return ("road_and_walk" if candidates else "walk_only"), None, candidates
    if len(candidates) == 1:
        return "single_road", candidates[0], candidates
    return ("overlapping_roads" if candidates else "outside_road"), None, candidates


def edge_spans(events):
    active = Counter()
    start = 0.0
    for end, group in groupby(sorted(events), key=lambda event: event[0]):
        if end - start > EPSILON:
            yield start, end, span_status(active)
        for _, owner, change in group:
            active[owner] += change
            if not active[owner]:
                del active[owner]
        start = end
    if 1 - start > EPSILON:
        yield start, 1.0, span_status(active)


def overlaps(lines, roads, road_owners, walks):
    coords, line_ids = get_coordinates(lines, return_index=True)
    start = coords[:-1]
    end = coords[1:]
    keep = (line_ids[:-1] == line_ids[1:]) & np.any(start != end, axis=1)
    edge_lines = line_ids[:-1][keep]
    lengths = np.linalg.norm(end[keep] - start[keep], axis=1)
    edges = linestrings(np.stack((start[keep], end[keep]), axis=1))
    events = [[] for _ in edges]
    add_intersections(edges, roads, road_owners, events)
    add_intersections(edges, walks, np.zeros(len(walks), dtype=int), events)

    by_line = [[] for _ in lines]
    offset = 0.0
    prior_line = -1
    for line_id, length, edge_events in zip(edge_lines, lengths, events):
        if line_id != prior_line:
            offset = 0.0
            prior_line = line_id
        intervals = by_line[line_id]
        for from_, to, match in edge_spans(edge_events):
            start_m, end_m = offset + from_ * length, offset + to * length
            if intervals and intervals[-1][2] == match and abs(intervals[-1][1] - start_m) < 1e-6:
                start_m = intervals.pop()[0]
            intervals.append((start_m, end_m, match))
        offset += length
    return by_line


def insert_markings(db, records, roads, road_owners, walks, counts, next_id):
    rows, bounds, spans = [], [], []
    segments = overlaps([row[-1] for row in records], roads, road_owners, walks)
    for i, (record, intervals) in enumerate(zip(records, segments), next_id):
        source, source_row, part, management_id, district, style, line = record
        rows.append((i, source, source_row, part, management_id, district, style, to_wkb(line)))
        bounds.append(rect(i, line))
        counts[district]["parts"] += 1
        counts[district]["source_length_m"] += line.length
        for begin, end, (status, road_id, candidates) in intervals:
            spans.append((i, begin, end, status, road_id, json.dumps(candidates, separators=(",", ":"))))
            counts[district][status + "_m"] += end - begin
    db.executemany("INSERT INTO marking VALUES (?,?,?,?,?,?,?,?)", rows)
    db.executemany("INSERT INTO marking_bounds VALUES (?,?,?,?,?)", bounds)
    db.executemany("INSERT INTO span VALUES (?,?,?,?,?,?)", spans)
    return next_id + len(rows)


def build(directory, output, latest_bus):
    archives = {name: layer_metadata(directory, name) for name in SOURCE_LAYERS
                if name != "bus-lanes" or latest_bus}
    counts = defaultdict(Counter)
    with NamedTemporaryFile(dir=output.parent, prefix=output.name + ".", suffix=".part", delete=False) as stream:
        temporary = Path(stream.name)
    try:
        db = sqlite3.connect(temporary)
        try:
            db.execute("PRAGMA foreign_keys = ON")
            db.executescript(SCHEMA)
            roads, road_owners = surface_index(directory, db, "road")
            walks, _ = surface_index(directory, db, "walk")
            updated_bus = list(marking_parts(directory, "bus-lanes")) if latest_bus else []
            bus_ids = {row[3] for row in updated_bus if row[3]}
            replaced = set()
            next_id = insert_markings(db, updated_bus, roads, road_owners, walks, counts, 1) if updated_bus else 1
            baseline = marking_parts(directory, "lanes")
            while batch := list(islice(baseline, 2048)):
                remaining = []
                for record in batch:
                    if record[3] in bus_ids:
                        replaced.add(record[3])
                    else:
                        remaining.append(record)
                if remaining:
                    next_id = insert_markings(db, remaining, roads, road_owners, walks, counts, next_id)
            total = Counter()
            for district in counts.values():
                total.update(district)
            if not total["parts"] or abs(sum(value for key, value in total.items()
                                               if key.endswith("_m") and key != "source_length_m")
                                          - total["source_length_m"]) > 0.01:
                raise ValueError("Road spans do not account for the original marking length")
            report = {"epsg": 5186, "sources": archives, "latest_bus": latest_bus,
                      "bus_source_ids": len(bus_ids), "bus_replacement_ids": len(replaced),
                      "districts": dict(sorted(counts.items())),
                      "total": dict(total)}
            db.execute("INSERT INTO metadata VALUES (?,?)", ("report", json.dumps(report, ensure_ascii=False)))
            db.commit()
        finally:
            db.close()
        temporary.replace(output)
        return report
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path, help="Directory with the downloaded Seoul source bundle")
    parser.add_argument("output", type=Path, help="New SQLite spatial index")
    parser.add_argument("--latest-bus", action="store_true",
                        help="Use valid 2026 bus linework in place of matching 2021 management IDs")
    args = parser.parse_args()
    if args.output.suffix.lower() != ".sqlite":
        parser.error("output must have a .sqlite suffix")
    logging.getLogger("shapefile").setLevel(logging.ERROR)
    print(json.dumps(build(args.directory, args.output, args.latest_bus), ensure_ascii=False))


if __name__ == "__main__":
    main()
