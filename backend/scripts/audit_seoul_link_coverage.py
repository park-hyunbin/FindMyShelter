"""Measure available lane-line evidence starting from Seoul's official road links."""

import argparse
from collections import Counter, defaultdict
from contextlib import closing
import hashlib
from io import BytesIO
from itertools import islice
import json
from pathlib import Path
import sqlite3
from tempfile import NamedTemporaryFile
from zipfile import ZipFile

import numpy as np
from pyproj import CRS, Transformer
import shapefile
from shapely import STRtree, from_wkb, length, points, transform
from shapely.geometry import shape

from prepare_neighborhood_pavement import parts
from reconcile_seoul_marking_links import (
    AMBIGUOUS, ANGLE, AXIS_RADIUS_M, SPACING_M, Network, sample_spans, select_axes,
)


# The first three digits of a standard link ID are the official region code.
SEOUL_REGIONS = set(map(str, range(100, 125)))
SCHEMA = """
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE link_coverage (
    link_id TEXT NOT NULL, part INTEGER NOT NULL, region TEXT NOT NULL,
    road_name TEXT NOT NULL, lanes INTEGER NOT NULL, road_type TEXT NOT NULL, updated TEXT NOT NULL,
    link_m REAL NOT NULL, candidate_m REAL NOT NULL, no_candidate_m REAL NOT NULL,
    surface_unresolved_m REAL NOT NULL, PRIMARY KEY(link_id,part)
);
"""
LENGTHS = ("link_m", "candidate_m", "no_candidate_m", "surface_unresolved_m")


def seoul_links(archive_path):
    with ZipFile(archive_path) as archive:
        crs = CRS.from_wkt(archive.read("MOCT_LINK.prj").decode("ascii"))
        project = Transformer.from_crs(crs, 5186, always_xy=True)
        with archive.open("MOCT_LINK.dbf") as attributes, shapefile.Reader(
            shp=BytesIO(archive.read("MOCT_LINK.shp")), shx=BytesIO(archive.read("MOCT_LINK.shx")),
            dbf=attributes, encoding="cp949",
        ) as reader:
            fields = ["LINK_ID", "ROAD_USE", "ROAD_NAME", "LANES", "ROAD_TYPE", "UPDATEDATE"]
            for row in reader.iterShapeRecords(fields=fields):
                record = row.record
                link_id = record["LINK_ID"]
                region = link_id[:3]
                if region not in SEOUL_REGIONS or record["ROAD_USE"] != "0":
                    continue
                geometry = transform(shape(row.shape.__geo_interface__), project.transform, interleaved=False)
                road_parts = list(parts(geometry, "LineString"))
                if not road_parts or any(not np.isfinite(line.length) or line.length == 0 for line in road_parts):
                    raise ValueError(f"Invalid geometry for active link {link_id}")
                for part, line in enumerate(road_parts):
                    yield (link_id, part, region, record["ROAD_NAME"], record["LANES"] or 0,
                           record["ROAD_TYPE"], record["UPDATEDATE"], line)


def indexed_geometry(source, table):
    return from_wkb([row[0] for row in source.execute(f"SELECT geometry FROM {table} ORDER BY id")])


def classify(roads, walks, markings, coordinates, tangents):
    stations = points(coordinates)
    sample_ids, face_ids = roads.query(stations, predicate="covered_by")
    unique = np.bincount(sample_ids, minlength=len(stations)) == 1
    unique[walks.query(stations, predicate="covered_by")[0]] = False
    sample_ids, face_ids = sample_ids[unique[sample_ids]], face_ids[unique[sample_ids]]
    candidate = np.zeros(len(stations), dtype=bool)
    states = select_axes(markings, coordinates[sample_ids], tangents[sample_ids],
                         roads.geometries[face_ids], np.zeros(len(sample_ids), dtype=bool),
                         require_projection=True)
    candidate[sample_ids] = (states >= 0) | (states == AMBIGUOUS)
    return candidate, unique & ~candidate, ~unique


def check_batch(records, roads, walks, markings):
    # Reuse the same stations, search distance and tangent test as the lane-to-road audit.
    lines = np.asarray([record[-1] for record in records], dtype=object)
    distances = length(lines)
    _, indices, weights, coordinates, tangents = sample_spans(lines, np.zeros(len(lines)), distances)
    masks = classify(roads, walks, markings, coordinates, tangents)
    lengths = [np.bincount(indices, weights=weights * mask, minlength=len(records)) for mask in masks]
    for record, distance, values in zip(records, distances, zip(*lengths)):
        if abs(sum(values) - distance) > 0.001:
            raise ValueError(f"Lost length for link {record[:2]}")
        yield (*record[:-1], float(distance), *(float(value) for value in values))


def audit(index_path, archive_path, output):
    with archive_path.open("rb") as stream:
        archive_digest = hashlib.file_digest(stream, "sha256").hexdigest()
    with closing(sqlite3.connect(index_path.resolve().as_uri() + "?mode=ro", uri=True)) as source:
        snapshot = source.execute("SELECT value FROM metadata WHERE key='report'").fetchone()[0]
        if json.loads(snapshot)["epsg"] != 5186:
            raise ValueError("Unexpected city index coordinate system")
        roads, walks = (STRtree(indexed_geometry(source, table)) for table in ("road", "walk"))
        lines = from_wkb([row[0] for row in source.execute(
            "SELECT geometry FROM marking WHERE style <> 'stop' ORDER BY id"
        )])
        markings = Network(lines, range(len(lines)))
    report = {
        "national_archive": archive_path.name, "national_sha256": archive_digest,
        "index_report_sha256": hashlib.sha256(snapshot.encode()).hexdigest(),
        "sample_spacing_m": SPACING_M, "radius_m": AXIS_RADIUS_M, "angle_deg": float(np.rad2deg(ANGLE)),
        "regions": defaultdict(Counter), "lane_counts": defaultdict(Counter), "road_types": defaultdict(Counter),
        "total": Counter(),
    }
    with NamedTemporaryFile(dir=output.parent, prefix=output.name + ".", suffix=".part", delete=False) as stream:
        temporary = Path(stream.name)
    try:
        with closing(sqlite3.connect(temporary)) as result:
            result.executescript(SCHEMA)
            with closing(seoul_links(archive_path)) as links:
                while batch := list(islice(links, 512)):
                    result.executemany("INSERT INTO link_coverage VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                                       check_batch(batch, roads, walks, markings))
            counts = ", ".join(f"sum({name})" for name in LENGTHS)
            for region, lanes, road_type, links, *lengths in result.execute(
                f"SELECT region, lanes, road_type, count(DISTINCT link_id), {counts} "
                "FROM link_coverage GROUP BY region, lanes, road_type ORDER BY region, lanes, road_type"
            ):
                stats = {"links": links, **dict(zip(LENGTHS, lengths))}
                report["regions"][region].update(stats)
                report["lane_counts"][lanes].update(stats)
                report["road_types"][road_type].update(stats)
                report["total"].update(stats)
            if set(report["regions"]) != SEOUL_REGIONS:
                raise ValueError("The loaded national archive does not contain active links in every Seoul region")
            result.execute("INSERT INTO metadata VALUES ('report',?)", (json.dumps(report),))
            result.commit()
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("index", type=Path, help="Citywide Seoul marking and surface SQLite index")
    parser.add_argument("archive", type=Path, help="National standard node-link ZIP")
    parser.add_argument("output", type=Path, help="Separate SQLite evidence file")
    args = parser.parse_args()
    if args.output.suffix.lower() != ".sqlite" or args.output.resolve() == args.index.resolve():
        parser.error("output must be a different .sqlite file")
    print(json.dumps(audit(args.index, args.archive, args.output), indent=2))


if __name__ == "__main__":
    main()
