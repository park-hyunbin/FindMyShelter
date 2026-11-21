"""Measure which indexed Seoul marking gaps intersect another road polygon source."""

import argparse
from collections import Counter, defaultdict
from contextlib import closing
import hashlib
from io import BytesIO
import json
from pathlib import Path
import sqlite3
from tempfile import NamedTemporaryFile
from zipfile import ZipFile

import numpy as np
from pyproj import CRS, Transformer
import shapefile
from shapely import STRtree, from_wkb, make_valid, transform
from shapely.geometry import shape
from shapely.ops import substring

from index_seoul_road_markings import overlaps
from prepare_neighborhood_pavement import parts


SCHEMA = """
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE surface_check (
    marking_id INTEGER NOT NULL, start_m REAL NOT NULL, end_m REAL NOT NULL,
    single_polygon_m REAL NOT NULL, multiple_polygons_m REAL NOT NULL,
    outside_m REAL NOT NULL, source_records TEXT NOT NULL,
    PRIMARY KEY(marking_id,start_m)
);
"""
SOURCE_LENGTHS = ("single_polygon_m", "multiple_polygons_m", "outside_m")
GEOMETRIC_LABELS = {
    "single_road": "single_polygon_m",
    "overlapping_roads": "multiple_polygons_m",
    "outside_road": "outside_m",
}


def polygon_index(path, layer):
    polygons, owners, refs, layers = [], [], [], {}
    with ZipFile(path) as archive:
        members = {name.casefold(): name for name in archive.namelist()}
        for name in sorted(members.values()):
            if not name.lower().endswith(".shp") or layer.casefold() not in Path(name).stem.casefold():
                continue
            projection = archive.read(members[name[:-4].casefold() + ".prj"]).decode("utf-8-sig")
            crs = CRS.from_wkt(projection)
            if not crs.is_projected:
                raise ValueError(f"Unexpected non-projected coordinates in {name}")
            layers[name] = crs.to_string()
            project = None if crs.to_epsg() == 5186 else Transformer.from_crs(crs, 5186, always_xy=True)
            with shapefile.Reader(shp=BytesIO(archive.read(name))) as reader:
                for item in reader.iterShapes():
                    if not item.points:
                        continue
                    geometry = shape(item.__geo_interface__)
                    if project is not None:
                        geometry = transform(geometry, project.transform, interleaved=False)
                    faces = list(parts(geometry if geometry.is_valid else make_valid(geometry), "Polygon"))
                    if not faces:
                        continue
                    refs.append([name, item.oid])
                    polygons.extend(faces)
                    owners.extend([len(refs)] * len(faces))
    if not refs:
        raise ValueError(f"No polygons from {layer!r} in {path.name}")
    return STRtree(polygons), np.asarray(owners), refs, layers


def compare_batch(rows, roads, owners, refs, districts):
    original = from_wkb([row[4] for row in rows])
    gaps = [substring(line, row[1], row[2]) for row, line in zip(rows, original)]
    for row, intervals in zip(rows, overlaps(gaps, roads, owners, STRtree([]))):
        lengths = Counter()
        covered_by = set()
        for start, end, (status, _, candidates) in intervals:
            lengths[GEOMETRIC_LABELS[status]] += end - start
            covered_by.update(candidates)
        if abs(lengths.total() - (row[2] - row[1])) > 0.001:
            raise ValueError(f"Lost marking length in span {row[:3]}")
        districts[row[3]].update(lengths)
        districts[row[3]]["spans"] += 1
        yield (*row[:3], *(lengths[key] for key in SOURCE_LENGTHS),
               json.dumps([refs[owner - 1] for owner in sorted(covered_by)], ensure_ascii=False))


def compare(index, archive, output, layer, marking_id):
    roads, owners, refs, layers = polygon_index(archive, layer)
    with archive.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    with closing(sqlite3.connect(index.resolve().as_uri() + "?mode=ro", uri=True)) as source:
        source_report = source.execute("SELECT value FROM metadata WHERE key='report'").fetchone()[0]
        cursor = source.execute("""SELECT s.marking_id,s.start_m,s.end_m,m.district,m.geometry
            FROM span s JOIN marking m ON m.id=s.marking_id
            WHERE s.status='outside_road' ORDER BY s.marking_id,s.start_m""")
        districts = defaultdict(Counter)
        report = {
            "source_archive": archive.name, "sha256": digest, "layers": layers,
            "source_index_report_sha256": hashlib.sha256(source_report.encode()).hexdigest(),
            "polygon_records": len(refs), "districts": districts,
        }
        with NamedTemporaryFile(dir=output.parent, prefix=output.name + ".", suffix=".part", delete=False) as stream:
            temporary = Path(stream.name)
        try:
            with closing(sqlite3.connect(temporary)) as result:
                result.executescript(SCHEMA)
                while batch := cursor.fetchmany(1024):
                    result.executemany("INSERT INTO surface_check VALUES (?,?,?,?,?,?,?)",
                                       compare_batch(batch, roads, owners, refs, districts))
                total = Counter()
                for district in districts.values():
                    total.update(district)
                expected = json.loads(source_report)["total"]["outside_road_m"]
                if abs(sum(total[key] for key in SOURCE_LENGTHS) - expected) > 0.01:
                    raise ValueError("The check did not account for the full length outside the original road and walk")
                report["total"] = dict(total)
                if marking_id:
                    ids = source.execute("SELECT id FROM marking WHERE management_id=?", (marking_id,))
                    check = """SELECT start_m,end_m,single_polygon_m,multiple_polygons_m,outside_m,source_records
                        FROM surface_check WHERE marking_id=? ORDER BY start_m"""
                    report["selected_marking"] = {"id": marking_id, "rows": [
                        {"start_m": a, "end_m": b, "single_polygon_m": single,
                         "multiple_polygons_m": multiple, "outside_m": outside, "source_records": json.loads(records)}
                        for params in ids for a, b, single, multiple, outside, records in result.execute(check, params)
                    ]}
                result.execute("INSERT INTO metadata VALUES ('report',?)", (json.dumps(report, ensure_ascii=False),))
                result.commit()
            temporary.replace(output)
        finally:
            temporary.unlink(missing_ok=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("index", type=Path, help="Seoul marking overlap SQLite")
    parser.add_argument("archive", type=Path, help="ZIP containing the comparison road polygon layer and its PRJ")
    parser.add_argument("output", type=Path, help="New road surface evidence SQLite")
    parser.add_argument("--layer", default="TL_SPRD_RW", help="Comparison SHP layer name or stem substring")
    parser.add_argument("--marking-id", help="Include evidence for this marking management number in the JSON summary")
    args = parser.parse_args()
    if args.output.suffix.lower() != ".sqlite" or args.output.resolve() == args.index.resolve():
        parser.error("output must be a different .sqlite file")
    print(json.dumps(compare(args.index, args.archive, args.output, args.layer, args.marking_id), ensure_ascii=False))


if __name__ == "__main__":
    main()
