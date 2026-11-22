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

import numpy as np
from pyproj import CRS
import shapefile
from shapely import STRtree, from_wkb, make_valid, prepare, set_precision, union_all
from shapely.geometry import LineString, Point, box, shape
from shapely.ops import substring

from extract_seoul_road_window import TO_METRES, bounds_parameters, surface_shapes
from prepare_neighborhood_pavement import GRID_M, SOURCE, covered_segments, export_polygons, parts
from prepare_seoul_current_crosswalks import local_polygon
from prepare_seoul_lane_windows import lane_item, region_bounds
from prepare_seoul_ramp_lanes import MIN_ALIGNMENT, RADIUS_M, inventory, tangent
from prepare_songpa_road_markings import REGIONS, gps, lane_style
from reconcile_seoul_marking_links import load_national_links, sample_spans, select_axes


RAMP_EVIDENCE = REGIONS.parents[2] / "components" / "data" / "seoul-ramp-lanes.generated.json"


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


def ground_link_support(line, driveway, links, is_stop):
    lengths = np.array([line.length])
    _, _, _, coordinates, tangents = sample_spans(np.array([line]), np.zeros(1), lengths)
    linked = select_axes(links, coordinates, tangents, np.full(len(coordinates), driveway, dtype=object),
                         np.full(len(coordinates), is_stop), require_projection=True, require_connected=True)
    supported = linked >= 0
    if is_stop and not supported.all():
        return []
    edges = np.linspace(0, line.length, len(coordinates) + 1)
    transitions = np.flatnonzero(np.diff(np.r_[False, supported, False]))
    return [(edges[begin], edges[end]) for begin, end in transitions.reshape(-1, 2)]


def align_ground_ramps(graph, driveway, evidence, link_shapes):
    node_uses = Counter(node for road in graph["roads"] for node in set(road["nodeIds"]))
    aligned = {}
    for road in graph["roads"]:
        match = evidence.get(str(road["id"]))
        if not match or road["bridge"] or road["oneWay"] != match["oneWay"] or not road["oneWay"]:
            continue
        coordinates = road["coordinates"]
        if [[node, *position] for node, position in zip(road["nodeIds"], coordinates, strict=True)] != match["vertices"]:
            continue
        source_axes = [link_shapes[identifier] for identifier in match["links"] if identifier in link_shapes]
        if len(source_axes) != len(match["links"]):
            continue
        points = [TO_METRES.transform(*position) for position in coordinates]
        proposal = coordinates.copy()
        for i, (node, point) in enumerate(zip(road["nodeIds"][1:-1], points[1:-1]), 1):
            position = Point(point)
            if node_uses[node] > 1 or driveway.covers(position):
                continue
            heading = np.subtract(points[i + 1], points[i - 1]) * road["oneWay"]
            length = np.linalg.norm(heading)
            if length <= 0.05:
                continue
            candidates = []
            for axis in source_axes:
                station = axis.project(position)
                foot = axis.interpolate(station)
                if (position.distance(foot) <= RADIUS_M and driveway.covers(foot)
                    and np.dot(heading / length, tangent(axis, station)) >= MIN_ALIGNMENT):
                    candidates.append(foot)
            if candidates:
                proposal[i] = gps([min(candidates, key=position.distance).coords[0]])[0]
        if proposal == coordinates:
            continue
        corrected = [TO_METRES.transform(*position) for position in proposal]
        old_edges = [LineString(pair) for pair in zip(points, points[1:])]
        new_edges = [LineString(pair) for pair in zip(corrected, corrected[1:])]
        if any(edge.length < 0.05 for edge in new_edges):
            continue
        saved = [a.difference(driveway).length - b.difference(driveway).length
                 for a, b in zip(old_edges, new_edges, strict=True)]
        if min(saved) >= -0.1 and sum(saved) >= 2:
            aligned[road["id"]] = proposal
    return aligned


def supported_runs(original, rows, driveway, window, excluded, recovered, confirm_ground, *, is_stop=False):
    # Evidence can split one painted line at administrative pavement seams.
    # Keep the original line through an overlap only when it stays on the same
    # joined ground deck and has supported approaches on both sides.
    supported = [[(start, end)] if status == "single_road" and clearance <= 0.001 else []
                 for start, end, status, clearance in rows]
    for i, (start, end, status, clearance) in enumerate(rows):
        if status != "single_road" or clearance <= 0.001:
            continue
        segment = substring(original, start, end)
        in_window = segment.intersection(window)
        # Clipping first keeps sampled evidence from bridging an actual road gap.
        verified = []
        for piece in parts(in_window.intersection(driveway), "LineString"):
            first = segment.project(Point(piece.coords[0]))
            last = segment.project(Point(piece.coords[-1]))
            if last < first:
                piece = piece.reverse()
                first, last = last, first
            # At a self intersection a projected endpoint can refer to another pass.
            if abs(last - first - piece.length) > 1e-5:
                continue
            if is_stop and piece.length < in_window.length - 1e-5:
                continue
            for begin, finish in confirm_ground(piece):
                finish = min(finish, last - first)
                if finish - begin > 0.001:
                    verified.append((start + first + begin, min(end, start + first + finish)))
        supported[i] = sorted(verified)
        length = sum(finish - begin for begin, finish in verified)
        recovered["ground_near_structure"] += length
        excluded["near_structure"] += max(0, in_window.length - length)
    for i in range(1, len(rows) - 1):
        start, end, status, structure = rows[i]
        if status != "overlapping_roads" or structure > 0.001 or not supported[i - 1] or not supported[i + 1]:
            continue
        if abs(supported[i - 1][-1][1] - start) > GRID_M or abs(supported[i + 1][0][0] - end) > GRID_M:
            continue
        seam = substring(original, max(0, start - 0.15), min(original.length, end + 0.15)).intersection(window)
        if not seam.is_empty and driveway.covers(seam):
            supported[i] = [(start, end)]
            recovered["same_ground_overlap"] += substring(original, start, end).intersection(window).length
    joined = []
    for (start, end, status, _), runs in zip(rows, supported, strict=True):
        if not runs and status != "single_road":
            excluded[status] += substring(original, start, end).intersection(window).length
        for begin, finish in runs:
            if joined and begin <= joined[-1][1] + 1e-6:
                joined[-1][1] = max(joined[-1][1], finish)
            else:
                joined.append([begin, finish])
    for start, end in joined:
        yield from parts(substring(original, start, end).intersection(window), "LineString")


def verified_lanes(db, window, driveway, excluded, recovered, ground_links):
    query = """SELECT m.id,m.management_id,m.geometry,source.kind,raw.id,
        json_extract(raw.properties,'$.A058_KND_CDE'),json_extract(raw.properties,'$.A058_KND2_CDE'),
        s.start_m,s.end_m,s.status,e.structure_near_m
        FROM marking_bounds b JOIN marking m ON m.id=b.id
        JOIN tgis_marking_source source ON source.source_row=m.source_row
        LEFT JOIN snapshot.feature raw ON raw.layer='A058_L' AND raw.id=source.feature_id
        JOIN span s ON s.marking_id=m.id
        LEFT JOIN checks.evidence e ON e.marking_id=m.id AND e.start_m=s.start_m
        WHERE b.min_x<=? AND b.max_x>=? AND b.min_y<=? AND b.max_y>=?
        ORDER BY m.id,s.start_m"""
    for key, group in groupby(db.execute(query, bounds_parameters(window)), key=lambda row: row[0]):
        records = list(group)
        _, management, geometry, kind, feature_id, raw_kind, subtype, *_ = records[0]
        if feature_id is None or raw_kind != kind:
            raise ValueError(f"T-GIS marking {key} does not match its source record")
        style = lane_style(kind, subtype)
        original = from_wkb(geometry)
        if style is None:
            excluded["unsupported_style"] += original.intersection(window).length
            continue
        rows = [record[7:] for record in records]
        for start, _, _, structure in rows:
            if structure is None:
                raise ValueError(f"Missing structural evidence for {key} at {start}")
        def confirm_ground(line):
            return ground_link_support(line, driveway, ground_links, style == "stop")

        for line in supported_runs(original, rows, driveway, window, excluded, recovered, confirm_ground,
                                   is_stop=style == "stop"):
            if line.length > 0.25:
                yield {**lane_item(line, original, style, kind), "managementId": management}


def scene_files(db, folder, source, structures, structure_sources, ground_links, ramp_evidence, ramp_axes):
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
    prepare(driveway)
    aligned = align_ground_ramps(graph, driveway, ramp_evidence["ramps"], ramp_axes)
    ground_graph = {"roads": [{**road, "coordinates": aligned[road["id"]]} if road["id"] in aligned else road
                              for road in graph["roads"]]}
    excluded = Counter()
    recovered = Counter()
    lanes = list(verified_lanes(db, window, driveway, excluded, recovered, ground_links))
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
        "coveredSegments": [*covered_segments(ground_graph, driveway), *elevated_segments],
    }
    if aligned:
        surface_file["rampAlignment"] = {"sha256": ramp_evidence["sha256"], "source": ramp_evidence["source"],
                                         "roads": [{"id": key, "coordinates": points} for key, points in sorted(aligned.items())]}
    return markings, surface_file, {"lanes": len(lanes), "roads": len(surface_file["roads"]), "structures": len(elevated),
                                   "walks": len(surface_file["sidewalks"]),
                                   "withheld_m": {key: round(value, 1) for key, value in sorted(excluded.items())},
                                   "restored_m": {key: round(value, 1) for key, value in sorted(recovered.items())}}


def refresh_lanes(db, folder, source, ground_links):
    markings = json.loads((folder / "road-markings.json").read_text(encoding="utf-8"))
    pavement = json.loads((folder / "pavement.json").read_text(encoding="utf-8"))
    bounds = markings["laneBounds"]
    if markings.get("roadDataset") != {**source, "bounds": bounds} or pavement.get("roadDataset") != markings["roadDataset"]:
        raise ValueError(f"Lane refresh needs paired pavement and marking files for the same snapshot: {folder.name}")
    window = box(*TO_METRES.transform_bounds(*bounds))
    driveway = union_all([local_polygon(rings) for rings in pavement["roads"]], grid_size=GRID_M)
    prepare(driveway)
    excluded, recovered = Counter(), Counter()
    lanes = list(verified_lanes(db, window, driveway, excluded, recovered, ground_links))
    if not lanes or driveway.is_empty:
        raise ValueError(f"No publishable lane/road pair in {folder.name}")
    markings["lanes"] = lanes
    return markings, None, {"lanes": len(lanes),
                            "withheld_m": {key: round(value, 1) for key, value in sorted(excluded.items())},
                            "restored_m": {key: round(value, 1) for key, value in sorted(recovered.items())}}


def build(index, evidence, regions, output, bridge_archive, grade_separation_archive, national_archive, snapshot,
          *, lanes_only=False):
    with closing(sqlite3.connect(index.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        db.execute("ATTACH DATABASE ? AS checks", (evidence.resolve().as_uri() + "?mode=ro",))
        report = db.execute("SELECT value FROM main.metadata WHERE key='report'").fetchone()[0]
        checks = json.loads(db.execute("SELECT value FROM checks.metadata WHERE key='report'").fetchone()[0])
        if checks["index_report_sha256"] != hashlib.sha256(report.encode()).hexdigest():
            raise ValueError("Structural evidence did not use this marking index")
        source = json.loads(report)["sources"]["tgis-lanes"]
        with snapshot.open("rb") as raw:
            if source["sha256"] != hashlib.file_digest(raw, "sha256").hexdigest():
                raise ValueError("Marking styles must come from the T-GIS snapshot used to index the coordinates")
        db.execute("ATTACH DATABASE ? AS snapshot", (snapshot.resolve().as_uri() + "?mode=ro",))
        with national_archive.open("rb") as archive:
            if checks["national_sha256"] != hashlib.file_digest(archive, "sha256").hexdigest():
                raise ValueError("Ground road links must come from the same archive as the structural evidence")
        bounds = db.execute("SELECT min(min_x),min(min_y),max(max_x),max(max_y) FROM road_bounds").fetchone()
        ground_links = load_national_links(national_archive, bounds, ground_only=True)
        metadata = {"url": source["url"], "retrievedAt": source["retrieved_at"], "sha256": source["sha256"]}
        folders = [file.parent for file in sorted(regions.glob("*/road-markings.json"))]
        if not folders:
            raise ValueError(f"No Seoul scene regions in {regions}")
        if lanes_only:
            prepared = {folder.name: refresh_lanes(db, folder, metadata, ground_links) for folder in folders}
        else:
            structures, structure_sources = structure_inventory([
                (bridge_archive, "N1A_A0070000", "종류", "도로교"),
                (grade_separation_archive, "N1A_A0090000", "구분", "고가차도"),
            ])
            ramp_evidence = json.loads(RAMP_EVIDENCE.read_text(encoding="utf-8"))
            if ramp_evidence["sha256"] != checks["national_sha256"]:
                raise ValueError("Ramp centerline evidence must use the same national archive")
            ramp_links, ramp_index, _ = inventory(national_archive, bounds)
            ramp_ids = {identifier for match in ramp_evidence["ramps"].values() for identifier in match["links"]}
            ramp_axes = {link["LINK_ID"]: geometry for link, geometry in zip(ramp_links, ramp_index.geometries, strict=True)
                         if link["LINK_ID"] in ramp_ids and link["ROAD_TYPE"] == "000"}
            prepared = {folder.name: scene_files(db, folder, metadata, structures, structure_sources, ground_links,
                                                 ramp_evidence, ramp_axes)
                        for folder in folders}
    for region, (markings, pavement_file, _) in prepared.items():
        folder = output / region
        folder.mkdir(parents=True, exist_ok=True)
        for name, data in (("road-markings.json", markings), ("pavement.json", pavement_file)):
            if data is not None:
                (folder / name).write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n",
                                           encoding="utf-8")
    return {region: summary for region, (_, _, summary) in prepared.items()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("index", type=Path)
    parser.add_argument("evidence", type=Path, help="Structural reconciliation for the same index")
    parser.add_argument("--regions", type=Path, default=REGIONS)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--bridges", type=Path, help="S-Map N1A_A0070000.zip")
    parser.add_argument("--grade-separation", type=Path, help="S-Map N1A_A0090000.zip")
    parser.add_argument("--national-links", type=Path, required=True, help="National MOCT_LINK archive used for the evidence")
    parser.add_argument("--snapshot", type=Path, required=True, help="Original T-GIS snapshot used to build the marking index")
    parser.add_argument("--lanes-only", action="store_true", help="Refresh lanes using existing paired pavement")
    args = parser.parse_args()
    if not args.lanes_only and not (args.bridges and args.grade_separation):
        parser.error("a paired pavement rebuild requires --bridges and --grade-separation")
    print(json.dumps(build(args.index, args.evidence, args.regions, args.output, args.bridges,
                           args.grade_separation, args.national_links, args.snapshot, lanes_only=args.lanes_only), indent=2))


if __name__ == "__main__":
    main()
