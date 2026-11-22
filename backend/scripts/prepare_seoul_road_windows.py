"""Build paired Seoul tour pavement and paint datasets from one verified city index."""

import argparse
from collections import Counter
from contextlib import closing
import hashlib
from io import BytesIO
from itertools import groupby
import json
from pathlib import Path
import sqlite3
from zipfile import ZipFile

from pyproj import CRS
import shapefile
from shapely import STRtree, from_wkb, make_valid, set_precision, union_all
from shapely.geometry import LineString, box, shape
from shapely.ops import substring

from extract_seoul_road_window import TO_METRES, bounds_parameters, surface_shapes
from prepare_neighborhood_pavement import GRID_M, SOURCE, covered_segments, export_polygons, parts
from prepare_seoul_lane_windows import lane_item, region_bounds
from prepare_songpa_road_markings import REGIONS


def structure_inventory(archives):
    records, sources = [], []
    for path, layer, kind_field, kind_value in archives:
        with ZipFile(path) as archive:
            if CRS.from_wkt(archive.read(f"{layer}.prj").decode("ascii")).to_epsg() != 5186:
                raise ValueError(f"Expected EPSG:5186 for {layer}")
            year, month, day, *_ = archive.getinfo(f"{layer}.shp").date_time
            with shapefile.Reader(shp=BytesIO(archive.read(f"{layer}.shp")),
                                  shx=BytesIO(archive.read(f"{layer}.shx")),
                                  dbf=BytesIO(archive.read(f"{layer}.dbf")), encoding="cp949") as reader:
                for row in reader.iterShapeRecords(fields=["UFID", kind_field]):
                    if row.record[kind_field] == kind_value and row.shape.shapeType:
                        records.append((row.record["UFID"], make_valid(shape(row.shape.__geo_interface__))))
        with path.open("rb") as original:
            digest = hashlib.file_digest(original, "sha256").hexdigest()
        sources.append({"source": f"{SOURCE}/{layer}.zip", "archiveFileDate": f"{year:04}-{month:02}-{day:02}",
                        "sha256": digest})
    return records, sources


def separate_decks(road_records, graph, window, structures):
    axes = [(road, LineString([TO_METRES.transform(*point) for point in road["coordinates"]]))
            for road in graph["roads"] if road["motor"] and len(road["coordinates"]) >= 2]
    bridges = [(road["id"], axis) for road, axis in axes if road["bridge"]]
    decks, outlines = [], []
    owner_ids = set()
    for uid, structure in structures:
        if not structure.intersects(window):
            continue
        outline = structure.intersection(window)
        # Confirm the grade and ownership independently of the flat T-GIS surface.
        owners = [road_id for road_id, axis in bridges if outline.intersection(axis).length >= 5]
        if not owners:
            continue
        polygons = export_polygons(outline)
        if polygons:
            decks.append({"sourceId": uid, "roadIds": owners, "polygons": polygons})
            outlines.extend(parts(outline, "Polygon"))
            owner_ids.update(owners)
    elevated = union_all(outlines, grid_size=GRID_M)
    if elevated.is_empty:
        return [polygon for _, _, polygon in road_records], decks, []
    ground_axes = [axis for road, axis in axes if not road["bridge"]]
    axis_index = STRtree(ground_axes)
    ground = []
    for _, _, polygon in road_records:
        if polygon.intersection(elevated).area > GRID_M:
            # Retain independently mapped through roads under the structure. A
            # route that only approaches its edge may be a ramp at another grade.
            passes_below = False
            for i in axis_index.query(polygon, predicate="intersects"):
                portion = ground_axes[i].intersection(polygon)
                if portion.intersection(elevated).length >= 4 and portion.difference(elevated).length >= 6 \
                        and elevated.crosses(portion):
                    passes_below = True
                    break
            if not passes_below:
                polygon = polygon.difference(elevated, grid_size=GRID_M)
        ground.extend(parts(polygon, "Polygon"))
    return ground, decks, covered_segments(graph, elevated, owner_ids)


def supported_runs(original, rows, driveway, window, excluded, recovered):
    # Evidence can split one painted line at administrative pavement seams.
    # Keep the original line through an overlap only when it stays on the same
    # joined ground deck and has supported approaches on both sides.
    supported = [status == "single_road" and clearance <= 0.001 for start, end, status, clearance in rows]
    for i in range(1, len(rows) - 1):
        start, end, status, structure = rows[i]
        if status != "overlapping_roads" or structure > 0.001 or not supported[i - 1] or not supported[i + 1]:
            continue
        if abs(rows[i - 1][1] - start) > GRID_M or abs(rows[i + 1][0] - end) > GRID_M:
            continue
        seam = substring(original, max(0, start - 0.15), min(original.length, end + 0.15)).intersection(window)
        if not seam.is_empty and driveway.covers(seam):
            supported[i] = True
            recovered["same_ground_overlap"] += substring(original, start, end).intersection(window).length
    joined = []
    for (start, end, status, structure), keep in zip(rows, supported):
        if not keep:
            length = substring(original, start, end).intersection(window).length
            excluded[status if status != "single_road" else "near_structure"] += length
            continue
        if joined and abs(joined[-1][1] - start) <= 1e-6:
            joined[-1][1] = end
        else:
            joined.append([start, end])
    for start, end in joined:
        yield from parts(substring(original, start, end).intersection(window), "LineString")


def verified_lanes(db, window, driveway, excluded, recovered):
    query = """SELECT m.id,m.style,m.management_id,m.geometry,source.kind,
        s.start_m,s.end_m,s.status,e.structure_near_m
        FROM marking_bounds b JOIN marking m ON m.id=b.id
        JOIN tgis_marking_source source ON source.source_row=m.source_row
        JOIN span s ON s.marking_id=m.id
        LEFT JOIN checks.evidence e ON e.marking_id=m.id AND e.start_m=s.start_m
        WHERE b.min_x<=? AND b.max_x>=? AND b.min_y<=? AND b.max_y>=?
        ORDER BY m.id,s.start_m"""
    for key, group in groupby(db.execute(query, bounds_parameters(window)), key=lambda row: row[0]):
        records = list(group)
        _, style, management, geometry, kind, *_ = records[0]
        rows = [record[5:] for record in records]
        for start, _, _, structure in rows:
            if structure is None:
                raise ValueError(f"Missing structural evidence for {key} at {start}")
        original = from_wkb(geometry)
        for line in supported_runs(original, rows, driveway, window, excluded, recovered):
            if line.length > 0.25:
                yield {**lane_item(line, original, style, kind), "managementId": management}


def scene_files(db, folder, source, structures, structure_sources):
    region = folder.name
    markings = json.loads((folder / "road-markings.json").read_text(encoding="utf-8"))
    previous_pavement = json.loads((folder / "pavement.json").read_text(encoding="utf-8"))
    site = json.loads((folder / "site.geojson").read_text(encoding="utf-8"))
    neighborhood = site.get("metadata", {}).get("neighborhood")
    streets = folder.parent.parent / "neighborhoods" / neighborhood if neighborhood else folder
    graph = json.loads((streets / "streets.json").read_text(encoding="utf-8"))
    bounds = region_bounds(region, markings, folder.parent.parent)
    window = box(*TO_METRES.transform_bounds(*bounds))
    road_records = list(surface_shapes(db, window, "road"))
    walk_records = list(surface_shapes(db, window, "walk"))
    if not road_records or not walk_records:
        raise ValueError(f"No paired pavement coverage in {window.bounds}")
    ground, elevated, elevated_segments = separate_decks(road_records, graph, window, structures)
    roads = union_all(ground, grid_size=GRID_M)
    walks = union_all([polygon for _, _, polygon in walk_records], grid_size=GRID_M)
    driveway = roads.difference(walks, grid_size=GRID_M)
    excluded = Counter()
    recovered = Counter()
    lanes = list(verified_lanes(db, window, driveway, excluded, recovered))
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
        "elevatedRoads": elevated, "structureSources": structure_sources,
        "coveredSegments": [*covered_segments(graph, driveway), *elevated_segments],
    }
    return markings, surface_file, {"lanes": len(lanes), "roads": len(surface_file["roads"]), "structures": len(elevated),
                                   "walks": len(surface_file["sidewalks"]),
                                   "withheld_m": {key: round(value, 1) for key, value in sorted(excluded.items())},
                                   "restored_m": {key: round(value, 1) for key, value in sorted(recovered.items())}}


def build(index, evidence, regions, output, bridge_archive, grade_separation_archive):
    structures, structure_sources = structure_inventory([
        (bridge_archive, "N1A_A0070000", "종류", "도로교"),
        (grade_separation_archive, "N1A_A0090000", "구분", "고가차도"),
    ])
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
        prepared = {folder.name: scene_files(db, folder, metadata, structures, structure_sources) for folder in folders}
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
    parser.add_argument("--bridges", type=Path, required=True, help="S-Map N1A_A0070000.zip")
    parser.add_argument("--grade-separation", type=Path, required=True, help="S-Map N1A_A0090000.zip")
    args = parser.parse_args()
    print(json.dumps(build(args.index, args.evidence, args.regions, args.output, args.bridges, args.grade_separation), indent=2))


if __name__ == "__main__":
    main()
