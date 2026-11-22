"""Build paired Seoul tour pavement and paint datasets from one verified city index."""

import argparse
from collections import Counter
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3

from shapely import from_wkb, set_precision, union_all
from shapely.geometry import box
from shapely.ops import substring

from extract_seoul_road_window import TO_METRES, bounds_parameters, surface_shapes
from prepare_neighborhood_pavement import GRID_M, covered_segments, export_polygons, parts
from prepare_seoul_lane_windows import lane_item, region_bounds
from prepare_songpa_road_markings import REGIONS


def pavement(db, window, table):
    records = list(surface_shapes(db, window, table))
    if not records:
        raise ValueError(f"No {table} coverage in {window.bounds}")
    outline = union_all([polygon for _, _, polygon in records], grid_size=GRID_M)
    return set_precision(outline, GRID_M)


def verified_lanes(db, window, excluded):
    query = """SELECT m.id,m.style,m.management_id,m.geometry,source.kind,
        s.start_m,s.end_m,s.status,e.structure_near_m
        FROM marking_bounds b JOIN marking m ON m.id=b.id
        JOIN tgis_marking_source source ON source.source_row=m.source_row
        JOIN span s ON s.marking_id=m.id
        LEFT JOIN checks.evidence e ON e.marking_id=m.id AND e.start_m=s.start_m
        WHERE b.min_x<=? AND b.max_x>=? AND b.min_y<=? AND b.max_y>=?
        ORDER BY m.id,s.start_m"""
    last, original = None, None
    for key, style, management, geometry, kind, start, end, status, structure in db.execute(query, bounds_parameters(window)):
        if structure is None:
            raise ValueError(f"Missing structural evidence for {key} at {start}")
        if last != key:
            last, original = key, from_wkb(geometry)
        for line in parts(substring(original, start, end).intersection(window), "LineString"):
            if line.length <= 0.25:
                continue
            if status != "single_road" or structure > 0.001:
                excluded[status if status != "single_road" else "near_structure"] += line.length
                continue
            yield {**lane_item(line, original, style, kind), "managementId": management}


def scene_files(db, folder, source):
    region = folder.name
    markings = json.loads((folder / "road-markings.json").read_text(encoding="utf-8"))
    previous_pavement = json.loads((folder / "pavement.json").read_text(encoding="utf-8"))
    site = json.loads((folder / "site.geojson").read_text(encoding="utf-8"))
    neighborhood = site.get("metadata", {}).get("neighborhood")
    streets = folder.parent.parent / "neighborhoods" / neighborhood if neighborhood else folder
    graph = json.loads((streets / "streets.json").read_text(encoding="utf-8"))
    bounds = region_bounds(region, markings, folder.parent.parent)
    window = box(*TO_METRES.transform_bounds(*bounds))
    roads, walks = (pavement(db, window, layer) for layer in ("road", "walk"))
    driveway = roads.difference(walks, grid_size=GRID_M)
    excluded = Counter()
    lanes = list(verified_lanes(db, window, excluded))
    if not lanes or driveway.is_empty:
        raise ValueError(f"No publishable lane/road pair in {region}")
    metadata = {**source, "bounds": bounds}
    markings.update(lanesSource=source["url"], roadDataset=metadata, laneBounds=bounds, lanes=lanes)
    # The existing crossings and humps have separate sources and survey dates.
    markings.pop("markingsArchiveDate", None)
    markings.pop("laneSources", None)
    surface_source = {"source": source["url"], "retrievedAt": source["retrievedAt"]}
    surface_file = {
        "roadDataset": metadata, "roadSource": surface_source, "sidewalkSource": surface_source,
        "radiusM": previous_pavement["radiusM"],  # Scope for the existing street-tree inventory.
        "roads": export_polygons(driveway), "sidewalks": export_polygons(walks),
        "coveredSegments": covered_segments(graph, driveway),
    }
    return markings, surface_file, {"lanes": len(lanes), "roads": len(surface_file["roads"]),
                                   "walks": len(surface_file["sidewalks"]),
                                   "withheld_m": {key: round(value, 1) for key, value in sorted(excluded.items())}}


def build(index, evidence, regions, output):
    with closing(sqlite3.connect(index.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        db.execute("ATTACH DATABASE ? AS checks", (evidence.resolve().as_uri() + "?mode=ro",))
        report = db.execute("SELECT value FROM main.metadata WHERE key='report'").fetchone()[0]
        checks = json.loads(db.execute("SELECT value FROM checks.metadata WHERE key='report'").fetchone()[0])
        if checks["index_report_sha256"] != hashlib.sha256(report.encode()).hexdigest():
            raise ValueError("Structural evidence did not use this marking index")
        source = json.loads(report)["sources"]["tgis-lanes"]
        metadata = {"url": source["url"], "retrievedAt": source["retrieved_at"], "sha256": source["sha256"]}
        folders = [file.parent for file in sorted(regions.glob("*/road-markings.json"))]
        if not folders:
            raise ValueError(f"No Seoul scene regions in {regions}")
        prepared = {folder.name: scene_files(db, folder, metadata) for folder in folders}
    for region, (markings, pavement_file, _) in prepared.items():
        folder = output / region
        folder.mkdir(parents=True, exist_ok=True)
        for name, data in (("road-markings.json", markings), ("pavement.json", pavement_file)):
            (folder / name).write_text(json.dumps(data, separators=(",", ":")) + "\n", encoding="utf-8")
    return {region: summary for region, (_, _, summary) in prepared.items()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("index", type=Path)
    parser.add_argument("evidence", type=Path, help="Structural reconciliation for the same index")
    parser.add_argument("--regions", type=Path, default=REGIONS)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.index, args.evidence, args.regions, args.output), indent=2))


if __name__ == "__main__":
    main()
