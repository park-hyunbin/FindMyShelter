"""Collect Seoul C-ITS lane paths and check them against the city's road surfaces."""

import argparse
from collections import Counter, defaultdict
from contextlib import closing
import csv
import hashlib
from itertools import islice
import json
from pathlib import Path
import re
import shutil
import sqlite3
from tempfile import TemporaryDirectory
from urllib.request import Request, urlopen

import numpy as np
from pyproj import Geod, Transformer
from shapely import STRtree, length, linestrings, points, to_wkb
from shapely.geometry import shape

from audit_seoul_link_coverage import indexed_geometry
from audit_seoul_road_sources import covered
from index_seoul_road_markings import rect
from reconcile_seoul_marking_links import SPACING_M, sample_spans


TDATA = "https://t-data.seoul.go.kr/dataprovide"
GRID_VIEWER = "https://data.seoul.go.kr/opendata/seoulStay/grid_viewer.html"
DATASETS = {
    "junctions": (10144, "v2xCrossroadMapInformation.csv"),
    "lane-map": (10145, "v2xLaneMapInformation.csv"),
    "lane-nodes": (10147, "v2xNodeMapInformation.csv"),
}
SCHEMA = """
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE cits_lane (
    id INTEGER PRIMARY KEY, junction_id TEXT NOT NULL, lane_id INTEGER NOT NULL,
    junction_name TEXT NOT NULL, district TEXT NOT NULL, lane_type TEXT NOT NULL,
    direction TEXT NOT NULL, maneuver TEXT NOT NULL, first_node INTEGER NOT NULL, nodes INTEGER NOT NULL,
    length_m REAL NOT NULL, road_only_m REAL NOT NULL, road_and_walk_m REAL NOT NULL,
    walk_only_m REAL NOT NULL, outside_m REAL NOT NULL, geometry BLOB NOT NULL,
    UNIQUE(junction_id, lane_id)
);
CREATE VIRTUAL TABLE cits_bounds USING rtree(id, min_x, max_x, min_y, max_y);
"""
CLASSES = ("road_only_m", "road_and_walk_m", "walk_only_m", "outside_m")
TO_METERS = Transformer.from_crs(4326, 5186, always_xy=True)
WGS84 = Geod(ellps="WGS84")


def download(directory):
    directory.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=directory) as temporary:
        cache = Path(temporary)
        for name, (dataset, filename) in DATASETS.items():
            page = f"{TDATA}/trafficdataviewfile.do?data_id={dataset}"
            with urlopen(page, timeout=30) as response:
                catalog = response.read().decode("utf-8")
            file_id = re.search(r'<option value="(\d+)">' + re.escape(filename) + r"</option>", catalog)
            if not file_id:
                raise ValueError(f"Expected {filename} in the public dataset {dataset}.")
            request = Request(f"{TDATA}/download.do?id={file_id[1]}", headers={"Referer": page})
            with urlopen(request, timeout=60) as response:
                if "attachment" not in response.headers.get("Content-Disposition", ""):
                    raise ValueError(f"The public download did not return {filename}.")
                with (cache / f"seoul-tdata-{name}.csv").open("wb") as destination:
                    shutil.copyfileobj(response, destination)
        with urlopen(GRID_VIEWER, timeout=30) as response:
            (cache / "public-catalog-seoul-grid.txt").write_bytes(response.read())
        districts(cache)
        for file in cache.iterdir():
            file.replace(directory / file.name)


def districts(directory):
    html = (directory / "public-catalog-seoul-grid.txt").read_text(encoding="utf-8-sig")
    inlined = html.split("const SIGUNGU=", 1)[1]
    features = json.JSONDecoder().raw_decode(inlined)[0]["features"]
    names = [item["properties"]["name"] for item in features]
    if len(features) != 25 or len(set(names)) != 25:
        raise ValueError("Expected all 25 district outlines in the city grid viewer.")
    return STRtree([shape(item["geometry"]) for item in features]), names


def rows(directory, name):
    with (directory / f"seoul-tdata-{name}.csv").open(encoding="utf-8-sig", newline="") as stream:
        yield from csv.DictReader(stream)


def whole_number(value):
    number = float(value)
    if not number.is_integer():
        raise ValueError(f"Expected a whole-number ID or node ordinal, found {value!r}.")
    return int(number)


def lane_key(record):
    return record["ITST_ID"], whole_number(record["LANE_ID"])


def read_junctions(directory, invalid):
    boundaries, names = districts(directory)
    junctions = {}
    for row in rows(directory, "junctions"):
        key = row["ITST_ID"]
        if key in junctions:
            raise ValueError(f"Duplicate intersection ID {key}")
        longitude, latitude = float(row["MAP_CTPT_INT_LOT"]), float(row["MAP_CTPT_INT_LAT"])
        area = boundaries.query(points(longitude, latitude), predicate="covered_by")
        if len(area) != 1:
            invalid.append(key)
        junctions[key] = (longitude, latitude, row["ITST_NM"], names[area[0]] if len(area) == 1 else None)
    return junctions


def decode_path(origin, offsets_cm):
    east, north = np.cumsum(offsets_cm, axis=0).T * 0.01
    azimuth = np.degrees(np.arctan2(east, north))
    distances = np.hypot(east, north)
    longitude, latitude, _ = WGS84.fwd(np.full(len(east), origin[0]), np.full(len(east), origin[1]),
                                      azimuth, distances)
    return linestrings(np.column_stack(TO_METERS.transform(longitude, latitude)))


def paths(directory, rejected, invalid, dates):
    junctions = read_junctions(directory, invalid)
    lanes = {}
    for row in rows(directory, "lane-map"):
        key = lane_key(row)
        if key in lanes:
            raise ValueError(f"Duplicate lane key {key}")
        lanes[key] = row
    nodes = defaultdict(list)
    for row in rows(directory, "lane-nodes"):
        key = lane_key(row)
        nodes[key].append((
            whole_number(row["NODE_ORDR"]), float(row["OFST_XAXS_CRDNT"]), float(row["OFST_YAXS_CRDNT"]),
        ))
        dates.add(row["REG_DT"][:10])
    rejected["without_nodes"] = len(lanes.keys() - nodes.keys())
    for key, offsets in nodes.items():
        lane, junction = lanes.get(key), junctions.get(key[0])
        if lane is None or junction is None:
            rejected["missing_join"] += 1
        elif junction[3] is None:
            rejected["junction_outside_or_on_district_edge"] += 1
        else:
            offsets.sort()
            ordinal, *coordinates = zip(*offsets)
            first = ordinal[0]
            if len(ordinal) < 2 or first not in (0, 1) or ordinal != tuple(range(first, first + len(ordinal))):
                rejected["missing_or_invalid_node_order"] += 1
                continue
            if not np.isfinite(coordinates).all():
                rejected["invalid_offset"] += 1
                continue
            line = decode_path(junction, np.asarray(coordinates).T)
            if not np.isfinite(line.length) or line.length < 0.25:
                rejected["invalid_line"] += 1
                continue
            yield (*key, junction[2], junction[3], lane["LANE_TYPE_CD"], lane["PERM_DRC_CD"],
                   lane["LANE_PERM_MUVR_CN"], first, len(offsets), line)


def audit(directory, index_path, output):
    with closing(sqlite3.connect(index_path.resolve().as_uri() + "?mode=ro", uri=True)) as index:
        snapshot = index.execute("SELECT value FROM metadata WHERE key='report'").fetchone()[0]
        if json.loads(snapshot)["epsg"] != 5186:
            raise ValueError("Unexpected city index coordinate system.")
        road, walk = (STRtree(indexed_geometry(index, name)) for name in ("road", "walk"))
    rejected, invalid, dates = Counter(), [], set()
    counts = defaultdict(Counter)
    with TemporaryDirectory(dir=output.parent) as raw:
        temporary = Path(raw) / output.name
        with closing(sqlite3.connect(temporary)) as db:
            db.executescript(SCHEMA)
            candidates = paths(directory, rejected, invalid, dates)
            while batch := list(islice(candidates, 512)):
                geometries = np.asarray([item[-1] for item in batch], dtype=object)
                distances = length(geometries)
                _, sources, weights, coords, _ = sample_spans(geometries, np.zeros(len(batch)), distances)
                stations = points(coords)
                on_road, on_walk = covered(road, stations), covered(walk, stations)
                masks = (on_road & ~on_walk, on_road & on_walk, on_walk & ~on_road, ~(on_road | on_walk))
                totals = [np.bincount(sources, weights=weights * mask, minlength=len(batch)) for mask in masks]
                for item, total, classification in zip(batch, distances, zip(*totals)):
                    if abs(sum(classification) - total) > 0.001:
                        raise ValueError(f"Lost path length for lane {item[:2]}")
                    feature = item[-1]
                    lane = db.execute("INSERT INTO cits_lane VALUES (NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                                      (*item[:-1], total, *classification, to_wkb(feature)))
                    db.execute("INSERT INTO cits_bounds VALUES (?,?,?,?,?)", rect(lane.lastrowid, feature))
                    counts[item[3]].update(dict(zip(CLASSES, classification)))
            for name, junctions, lanes in db.execute(
                "SELECT district, count(DISTINCT junction_id), count(*) FROM cits_lane GROUP BY district"
            ):
                counts[name].update(junctions=junctions, lanes=lanes)
            if not counts:
                raise ValueError("No intersection lane paths can be joined and decoded.")
            paths_totals = Counter()
            for district in counts.values():
                paths_totals.update(district)
            inputs = [directory / f"seoul-tdata-{name}.csv" for name in DATASETS]
            inputs.append(directory / "public-catalog-seoul-grid.txt")
            hashes = {}
            for path in inputs:
                with path.open("rb") as stream:
                    hashes[path.name] = hashlib.file_digest(stream, "sha256").hexdigest()
            report = {
                "epsg": 5186, "spacing_m": SPACING_M, "node_registration_dates": sorted(dates),
                "source_sha256": hashes, "road_index_report_sha256": hashlib.sha256(snapshot.encode()).hexdigest(),
                "rejected_lanes": rejected, "unassigned_junction_ids": sorted(invalid), "total": paths_totals,
                "districts": counts,
            }
            db.execute("INSERT INTO metadata VALUES ('report',?)", (json.dumps(report, ensure_ascii=False),))
            db.commit()
        temporary.replace(output)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path, help="Cache for Seoul C-ITS source CSVs and boundary file")
    parser.add_argument("index", type=Path, help="Citywide marking index containing road and walk surfaces")
    parser.add_argument("output", type=Path, help="Separate SQLite evidence file")
    parser.add_argument("--download", action="store_true", help="Fetch the latest public files into the cache")
    args = parser.parse_args()
    if args.output.suffix.lower() != ".sqlite" or args.output.resolve() == args.index.resolve():
        parser.error("output must be a different .sqlite file")
    if args.download:
        download(args.directory)
    print(json.dumps(audit(args.directory, args.index, args.output), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
