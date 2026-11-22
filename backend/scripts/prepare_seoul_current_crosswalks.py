"""Recover ordinary zebra crossings missing from the archived scene outlines."""

import argparse
from collections import Counter, defaultdict
from contextlib import closing
import csv
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import sqlite3

from shapely import STRtree, make_valid, union_all
from shapely.geometry import Point, Polygon, box

from collect_seoul_tgis_wfs import MAP
from extract_seoul_road_window import TO_METRES, TO_GPS
from index_seoul_road_markings import future_installation, snapshot_features
from prepare_neighborhood_pavement import export_polygons
from prepare_songpa_road_markings import REGIONS


LAYER = "A004_A"
INVENTORY = "https://data.seoul.go.kr/dataList/OA-22906/F/1/datasetView.do"
MIN_AXIS_COSINE = math.cos(math.radians(20))
ZEBRA_TYPES = {
    "001": "일단(화살표있음)", "002": "이단(화살표있음)", "003": "일단(화살표없음)",
    "004": "이단(화살표없음)", "005": "삼단(화살표있음)",
}


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def inventory_points(path):
    points = defaultdict(list)
    with path.open(encoding="cp949", newline="") as source:
        for row in csv.DictReader(source):
            kind = row["횡단보도종류"]
            if kind not in ZEBRA_TYPES.values():
                continue
            lon, lat = row["경도"], row["위도"]
            if lon and lat:
                number = row["횡단보도관리번호"]
                points[number].append((kind, Point(TO_METRES.transform(float(lon), float(lat)))))
    if not points:
        raise ValueError("No ordinary zebra crossings in the inventory")
    return points


def confirmed_outlines(snapshot, inventory, snapshot_day):
    condition = " AND ".join(f"json_extract(properties,'$.{key}')='{value}'" for key, value in (
        ("VIEW_CDE", "002"), ("STAT_CDE", "001"), ("EVE_CDE", "001"),
    ))
    shapes_by_id = defaultdict(list)
    for _, _, tags, geometry in snapshot_features(snapshot, LAYER, condition):
        identifier = tags.get("MGRNU")
        kind = tags.get("A004_KND_CDE")
        if not identifier or kind not in ZEBRA_TYPES or future_installation(tags.get("ESB_YMD"), snapshot_day):
            continue
        shapes_by_id[identifier].append((kind, make_valid(geometry)))
    for identifier, geometries in sorted(shapes_by_id.items()):
        if len(geometries) != 1:
            continue
        kind, geometry = geometries[0]
        if geometry.geom_type != "Polygon" or geometry.interiors or geometry.area < 2:
            continue
        if any(name == ZEBRA_TYPES[kind] and point.distance(geometry) <= 3
               for name, point in inventory.get(identifier, [])):
            yield identifier, kind, geometry


def local_polygon(rings):
    return make_valid(Polygon(
        [TO_METRES.transform(*position) for position in rings[0]],
        [[TO_METRES.transform(*position) for position in ring] for ring in rings[1:]],
    ))


def rectangle_axes(geometry):
    corners = list(geometry.minimum_rotated_rectangle.exterior.coords)
    vectors = [(b[0] - a[0], b[1] - a[1]) for a, b in zip(corners[:2], corners[1:3])]
    return sorted(((math.hypot(x, y), x, y) for x, y in vectors), reverse=True)


def companion_axis(geometry, references):
    (width, x, y), (depth, _, _) = rectangle_axes(geometry)
    if width >= depth * 1.5:
        return None
    center = geometry.centroid
    matches = []
    for i in references.query(geometry, predicate="dwithin", distance=4):
        other = references.geometries[i]
        gap = other.distance(geometry)
        if gap < 0.15:
            continue
        (length, dx, dy), (other_depth, _, _) = rectangle_axes(other)
        if length < other_depth * 1.5:
            continue
        nx, ny = dx / length, dy / length
        along = abs((x * nx + y * ny) / width)
        if max(along, math.sqrt(max(0, 1 - along ** 2))) < MIN_AXIS_COSINE:
            continue
        peer = other.centroid
        shift = abs((peer.x - center.x) * ny - (peer.y - center.y) * nx)
        if shift > min(depth, other_depth) * 0.32:
            continue
        matches.append((gap, nx, ny))
    if not matches:
        return None
    _, x, y = min(matches)
    if any(abs(x * nx + y * ny) < MIN_AXIS_COSINE for _, nx, ny in matches):
        return None
    return [[round(value, 9) for value in TO_GPS.transform(center.x + t * x, center.y + t * y)] for t in (-2, 2)]


def export_window(markings, pavement, source, index, identifiers, references=None):
    dataset = markings["roadDataset"]
    if dataset != pavement.get("roadDataset") or dataset["sha256"] != source["sha256"]:
        raise ValueError("Crosswalk and pavement windows must come from the same T-GIS snapshot")
    window = box(*TO_METRES.transform_bounds(*dataset["bounds"]))
    roads = union_all([local_polygon(rings) for rings in pavement["roads"]])
    elevated = union_all([local_polygon(rings) for deck in pavement.get("elevatedRoads", [])
                          for rings in deck["polygons"]])
    archive = STRtree([local_polygon([ring]) for record in markings["crosswalks"] for ring in record["surfaces"]])
    records, counts = [], Counter()
    for i in sorted(index.query(window, predicate="contains")):
        geometry = index.geometries[i]
        if any(geometry.intersection(archive.geometries[j]).area >= 0.3 * min(geometry.area, archive.geometries[j].area)
               for j in archive.query(geometry, predicate="intersects")):
            counts["already_in_archive"] += 1
            continue
        if elevated.intersects(geometry):
            counts["near_another_deck"] += 1
            continue
        footprint = geometry.intersection(roads)
        if footprint.area < geometry.area * 0.65:
            counts["insufficient_carriageway"] += 1
            continue
        current = {
            "id": identifiers[i],
            "outline": [[round(value, 9) for value in TO_GPS.transform(*position)]
                        for position in geometry.exterior.coords[:-1]],
            "paintAreas": export_polygons(footprint),
        }
        if references is not None and (axis := companion_axis(geometry, references)):
            current["across"] = axis
            counts["direction_from_aligned_crossings"] += 1
        records.append(current)
    return {**markings, "currentCrosswalks": {**source, "records": records}}, ({
        "published_candidates": len(records), **counts,
    })


def build(snapshot_path, inventory_path, regions, output):
    inventory = inventory_points(inventory_path)
    with closing(sqlite3.connect(snapshot_path.resolve().as_uri() + "?mode=ro", uri=True)) as snapshot:
        raw, = snapshot.execute("SELECT value FROM metadata WHERE key='report'").fetchone()
        report = json.loads(raw)
        if report["epsg"] != 5186 or not report["layers"].get(LAYER):
            raise ValueError("The T-GIS snapshot does not contain the crossing polygon layer in EPSG:5186")
        snapshot_day = datetime.fromisoformat(report["requested_at"]).astimezone(timezone(timedelta(hours=9))).date()
        matches = list(confirmed_outlines(snapshot, inventory, snapshot_day))
    zebras = [(identifier, geometry) for identifier, kind, geometry in matches if kind == "003"]
    if not zebras:
        raise ValueError("No ordinary zebra crossings matched the public inventory")
    source = {"url": MAP, "layer": LAYER, "retrievedAt": report["requested_at"],
              "sha256": digest(snapshot_path), "inventory": INVENTORY, "inventorySha256": digest(inventory_path)}
    references = STRtree([geometry for _, _, geometry in matches])
    identifiers, geometries = zip(*zebras)
    index = STRtree(geometries)
    results = {}
    for file in sorted(regions.glob("*/road-markings.json")):
        region = file.parent.name
        markings = json.loads(file.read_text(encoding="utf-8"))
        pavement = json.loads(file.with_name("pavement.json").read_text(encoding="utf-8"))
        data, counts = export_window(markings, pavement, source, index, identifiers, references)
        results[region] = file.name, data, counts
    for region, (filename, data, _) in results.items():
        target = output / region / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return {region: counts for region, (_, _, counts) in results.items()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("inventory", type=Path)
    parser.add_argument("--regions", type=Path, default=REGIONS)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.snapshot, args.inventory, args.regions, args.output), indent=2))


if __name__ == "__main__":
    main()
