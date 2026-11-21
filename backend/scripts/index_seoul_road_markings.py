"""Index Seoul lane geometry and its exact overlaps with mapped road surfaces."""

import argparse
from collections import Counter, defaultdict
from contextlib import closing
from datetime import date, datetime, timedelta, timezone
import hashlib
from itertools import groupby, islice
import json
import logging
from pathlib import Path
import sqlite3
from tempfile import NamedTemporaryFile

import numpy as np
from shapely import (
    STRtree, from_geojson, get_coordinates, get_parts, get_point, get_type_id,
    intersection, is_valid, line_locate_point, linestrings, make_valid,
    to_wkb,
)
from shapely.geometry import MultiPolygon, shape

from audit_seoul_road_sources import LANE_FIELDS, layer_metadata, open_layer
from collect_seoul_tgis_wfs import MAP as TGIS_MAP
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


def surface_records(directory, layer):
    with open_layer(directory, layer, attributes=True) as reader:
        for row in reader.iterShapeRecords(fields=["UFID"]):
            if row.shape.points:
                yield row.record.oid + 1, row.record["UFID"], shape(row.shape.__geo_interface__)


def surface_index(records, db, layer):
    polygons, owners = [], []
    for id_, reference, geometry in records:
        if not is_valid(geometry):
            geometry = make_valid(geometry)
        faces = list(parts(geometry, "Polygon"))
        if not faces:
            continue
        geometry = faces[0] if len(faces) == 1 else MultiPolygon(faces)
        db.execute(f"INSERT INTO {layer} VALUES (?,?,?)", (id_, reference, to_wkb(geometry)))
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


def mark_totals(counts):
    total = Counter()
    for district in counts.values():
        total.update(district)
    measured = sum(value for key, value in total.items() if key.endswith("_m") and key != "source_length_m")
    if not total["parts"] or abs(measured - total["source_length_m"]) > 0.01:
        raise ValueError("Road spans do not account for the original marking length")
    return dict(total)


def snapshot_features(source, layer, condition):
    records = source.execute(f"""SELECT id, properties, geometry FROM feature
        WHERE layer=? AND geometry<>'null' AND {condition} ORDER BY id""", (layer,))
    for ordinal, (identifier, properties, geometry) in enumerate(records):
        yield ordinal, identifier, json.loads(properties), from_geojson(geometry)


def tgis_surfaces(source, layer):
    for ordinal, identifier, attributes, geometry in snapshot_features(
        source, layer, "json_extract(properties,'$.VIEW_CDE')='002'"
    ):
        yield ordinal + 1, attributes.get("UFID") or identifier, geometry


def future_installation(value, snapshot_day):
    if not isinstance(value, str) or len(value) != 8 or not value.isascii() or not value.isdecimal():
        return False
    try:
        return date.fromisoformat(value) > snapshot_day
    except ValueError:
        return False


def tgis_markings(source, index, snapshot_day, excluded):
    visible = " AND ".join(f"json_extract(properties,'$.{key}')='{value}'"
                           for key, value in (("VIEW_CDE", "002"), ("STAT_CDE", "001"), ("EVE_CDE", "001")))
    for ordinal, identifier, tags, geometry in snapshot_features(source, "A058_L", visible):
        kind = tags["A058_KND_CDE"]
        style = lane_style(kind, tags["A058_KND2_CDE"])
        if style is None:
            excluded["unsupported_style"] += 1
            continue
        if future_installation(tags.get("ESB_YMD"), snapshot_day):
            excluded["future_installation"] += 1
            continue
        index.execute("INSERT INTO tgis_marking_source VALUES (?,?,?,?,?)",
                      (ordinal, identifier, kind, tags.get("ESB_YMD"), tags.get("CAE_YMD")))
        for part, line in enumerate(parts(geometry, "LineString")):
            if line.length > 0.25 and np.isfinite(line.length):
                yield ("tgis-lanes", ordinal, part, tags["MGRNU"] or "", tags["GU_CDE"] or "", style, line)


def build_tgis(snapshot, output):
    with snapshot.open("rb") as stream:
        sha = hashlib.file_digest(stream, "sha256").hexdigest()
    with NamedTemporaryFile(dir=output.parent, prefix=output.name + ".", suffix=".part", delete=False) as stream:
        temporary = Path(stream.name)
    try:
        with closing(sqlite3.connect(snapshot.resolve().as_uri() + "?mode=ro", uri=True)) as source, \
             closing(sqlite3.connect(temporary)) as db:
            metadata = json.loads(source.execute("SELECT value FROM metadata WHERE key='report'").fetchone()[0])
            if metadata["epsg"] != 5186 or not {"A058_L", "A001_A", "A003_A"} <= metadata["layers"].keys():
                raise ValueError("T-GIS snapshot requires road, walk and lane layers in EPSG:5186")
            db.execute("PRAGMA foreign_keys = ON")
            db.executescript(SCHEMA + """CREATE TABLE tgis_marking_source (
              source_row INTEGER PRIMARY KEY, feature_id TEXT NOT NULL, kind TEXT NOT NULL,
              installed TEXT, exchanged TEXT);""")
            roads, owners = surface_index(tgis_surfaces(source, "A001_A"), db, "road")
            walks, _ = surface_index(tgis_surfaces(source, "A003_A"), db, "walk")
            counts = defaultdict(Counter)
            excluded = Counter()
            next_id = 1
            snapshot_day = datetime.fromisoformat(metadata["requested_at"]).astimezone(timezone(timedelta(hours=9))).date()
            markings = tgis_markings(source, db, snapshot_day, excluded)
            while batch := list(islice(markings, 2048)):
                next_id = insert_markings(db, batch, roads, owners, walks, counts, next_id)
            report = {
                "epsg": 5186, "tgis": metadata, "districts": dict(sorted(counts.items())), "total": mark_totals(counts),
                "excluded_records": dict(excluded),
                "sources": {"tgis-lanes": {"url": TGIS_MAP, "retrieved_at": metadata["requested_at"], "sha256": sha}},
            }
            db.execute("INSERT INTO metadata VALUES (?,?)", ("report", json.dumps(report, ensure_ascii=False)))
            db.commit()
        temporary.replace(output)
        return report
    finally:
        temporary.unlink(missing_ok=True)


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
            roads, road_owners = surface_index(surface_records(directory, "road"), db, "road")
            walks, _ = surface_index(surface_records(directory, "walk"), db, "walk")
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
            report = {"epsg": 5186, "sources": archives, "latest_bus": latest_bus,
                      "bus_source_ids": len(bus_ids), "bus_replacement_ids": len(replaced),
                      "districts": dict(sorted(counts.items())),
                      "total": mark_totals(counts)}
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
    parser.add_argument("source", type=Path, help="Directory of official ZIPs or the collected T-GIS SQLite snapshot")
    parser.add_argument("output", type=Path, help="New SQLite spatial index")
    parser.add_argument("--latest-bus", action="store_true",
                        help="Use valid 2026 bus linework in place of matching 2021 management IDs")
    args = parser.parse_args()
    if args.output.suffix.lower() != ".sqlite":
        parser.error("output must have a .sqlite suffix")
    logging.getLogger("shapefile").setLevel(logging.ERROR)
    if args.source.suffix.lower() == ".sqlite":
        if args.latest_bus or args.output.resolve() == args.source.resolve():
            parser.error("the T-GIS snapshot already includes bus lanes and requires a separate output file")
        report = build_tgis(args.source, args.output)
    else:
        report = build(args.source, args.output, args.latest_bus)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
