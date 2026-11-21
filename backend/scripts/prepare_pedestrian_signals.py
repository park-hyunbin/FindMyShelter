"""Match public signal inventory and pole coordinates to reviewed crossings."""

import argparse
import csv
import json
from collections import Counter
from contextlib import closing
from io import BytesIO, StringIO
from math import dist
from pathlib import Path
from zipfile import ZipFile

from openpyxl import load_workbook
from pyproj import CRS, Transformer
import shapefile
from shapely import STRtree, make_valid
from shapely.geometry import LineString, Point, Polygon, box, shape
from shapely.ops import unary_union

from prepare_neighborhood_pavement import parts
from prepare_songpa_road_markings import city_features

LOCAL = Transformer.from_crs(4326, 5186, always_xy=True).transform
GPS = Transformer.from_crs(5186, 4326, always_xy=True).transform
INVENTORY_SOURCE = "https://data.seoul.go.kr/dataList/OA-23081/F/1/datasetView.do"
POLE_SOURCE = "https://data.seoul.go.kr/dataList/OA-22356/F/1/datasetView.do"
CROSSWALK_SOURCE = "https://data.seoul.go.kr/dataList/OA-15554/F/1/datasetView.do"
ISLAND_LAYER = "N1A_A0053326"
ISLAND_SOURCE = f"https://openlab.eseoul.go.kr/qgisplugin/SHP/{ISLAND_LAYER}.zip"


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def polygon(rings):
    outer, *holes = [[LOCAL(*point) for point in ring] for ring in rings]
    return Polygon(outer, holes)


def position(xy):
    return [round(value, 9) for value in GPS(*xy)]


def archive_crossings(archive_path, window):
    with ZipFile(archive_path) as archive:
        name = next(name for name in archive.namelist() if name.startswith("A004_A_") and name.endswith(".zip"))
        with ZipFile(BytesIO(archive.read(name))) as surfaces:
            for tags, geometry in city_features(surfaces, "A004_A", window):
                if tags["MGRNU"]:
                    yield tags["MGRNU"], geometry


def regional_islands(path, roads):
    with ZipFile(path) as archive:
        stem = ISLAND_LAYER + "."
        if CRS.from_wkt(archive.read(stem + "prj").decode("ascii")).to_epsg() != 5186:
            raise ValueError(f"Expected EPSG:5186 for {ISLAND_LAYER}")
        fields = {key: BytesIO(archive.read(stem + key)) for key in ("shp", "shx", "dbf")}
        with shapefile.Reader(**fields, encoding="cp949") as source:
            for feature in source.iterShapeRecords(fields=["UFID", "구조"], bbox=roads.bounds):
                if feature.record["구조"] != "교통섬":
                    continue
                outline = make_valid(shape(feature.shape.__geo_interface__))
                if outline.geom_type == "Polygon" and outline.area > 2 and roads.intersection(outline).area >= outline.area * 0.99:
                    yield {"ufid": feature.record["UFID"],
                           "shape": [[position(point) for point in ring.coords]
                                     for ring in (outline.exterior, *outline.interiors)]}


def axis_ends(outline):
    rectangle = outline.minimum_rotated_rectangle
    if rectangle.geom_type != "Polygon":
        return None
    vertices = list(rectangle.exterior.coords)
    edges = sorted((dist(a, b), a, b) for a, b in zip(vertices, vertices[1:]))
    length, a, b = edges[-1]
    if length < max(3, edges[0][0] * 1.2):
        return None
    x, y = outline.centroid.coords[0]
    dx, dy = b[0] - a[0], b[1] - a[1]
    axis = LineString([(x - dx, y - dy), (x + dx, y + dy)])
    spans = list(parts(outline.intersection(axis), "LineString"))
    if len(spans) == 1 and spans[0].length >= 3:
        return sorted([spans[0].coords[0], spans[0].coords[-1]])


def prepare(crossings, pavement, inventory_path, poles_path, district, archive_path=None):
    with closing(load_workbook(inventory_path, read_only=True, data_only=True)) as workbook:
        rows = workbook.active.iter_rows(values_only=True)
        header = list(next(rows))
        fields = ("자치구", "횡단보도관리번호", "교차로관리번호", "보행등유무", "교차로명", "X좌표", "Y좌표")
        if not set(fields).issubset(header):
            raise ValueError("The Seoul crossing inventory columns changed")
        district_col, id_col, junction_col, flag_col, name_col, x_col, y_col = (header.index(field) for field in fields)
        inventory = [
            (row[id_col], row[junction_col], row[flag_col], row[name_col], (row[x_col], row[y_col]))
            for row in rows
            if row[district_col] == district and isinstance(row[x_col], (int, float)) and isinstance(row[y_col], (int, float))
        ]
    raw = poles_path.read_bytes()
    try:
        csv_text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        csv_text = raw.decode("cp949")
    rows = csv.DictReader(StringIO(csv_text, newline=""))
    if not {"X좌표", "Y좌표", "자치구", "종류"}.issubset(rows.fieldnames or []):
        raise ValueError("The Seoul pedestrian signal coordinate columns changed")
    poles = {
        (float(row["X좌표"]), float(row["Y좌표"]))
        for row in rows
        if row["자치구"] == district and row["종류"] == "보행등" and row["X좌표"] and row["Y좌표"]
    }
    landings = unary_union(
        [polygon(rings) for rings in pavement["sidewalks"]]
        + [polygon(island["shape"]) for island in crossings.get("islands", [])]
    )
    poles = [Point(pole) for pole in sorted(poles) if landings.covers(Point(pole))]
    pole_index = STRtree(poles)
    records = []

    def add_record(identity, row=None, ends=None):
        record = {**identity, "installed": None, "heads": []}
        records.append(record)
        if row is None:
            return record
        inventory_id, junction_id, flag, junction, _ = row
        record.update({"inventoryId": inventory_id, "junctionId": junction_id, "junction": junction,
                       "installed": {"유": True, "무": False}.get(flag)})
        if not record["installed"] or ends is None:
            return record
        span = dist(*ends)
        if span < 0.05:
            return record
        for index, end in enumerate(ends):
            opposite = ends[1 - index]
            direction = (opposite[0] - end[0], opposite[1] - end[1])
            candidates = []
            for match in pole_index.query(Point(end), predicate="dwithin", distance=6):
                pole = poles[match].coords[0]
                along = sum((p - e) * d for p, e, d in zip(pole, end, direction)) / span
                if along <= 1 and dist(end, pole) < dist(opposite, pole):
                    candidates.append((dist(end, pole), pole))
            candidates.sort()
            if not candidates or (len(candidates) > 1 and candidates[1][0] - candidates[0][0] < 2):
                continue
            distance, pole = candidates[0]
            record["heads"].append({"coordinate": position(pole), "toward": position(opposite),
                                    "distanceFromCrossingEndM": round(distance, 2)})
        return record

    reviewed_outlines = []
    for crossing in crossings.get("crossings", []):
        outline = polygon([crossing["outline"]])
        reviewed_outlines.append(outline)
        footprint = outline.buffer(2)
        matches = [row for row in inventory if footprint.covers(Point(row[4]))]
        ends = [LOCAL(*crossing[key]) for key in ("start", "end")]
        record = add_record({"ufid": crossing["ufid"]}, matches[0] if len(matches) == 1 else None, ends)
        # Place the return-walk view inside the mapped island path, looking back across the crosswalk.
        legs = [
            LineString([LOCAL(*point) for point in leg["coordinates"]])
            for leg in crossings.get("legs", [])
            if leg["surface"] != "unverified" and dist(LOCAL(*leg["coordinates"][0]), ends[-1]) < 3
        ]
        if len(record["heads"]) == 2 and len(legs) == 1 and legs[0].length >= 7:
            observer = legs[0].interpolate(7)
            if landings.covers(observer):
                record["returnView"] = {"position": position(observer.coords[0]), "toward": crossing["start"]}

    if archive_path is not None:
        roads = unary_union([polygon(rings) for rings in pavement["roads"]])
        in_scene = unary_union([roads, landings])
        if in_scene.is_empty:
            raise ValueError("The regional pavement data contains no mapped roads or landings")
        used = {r["inventoryId"] for r in records if "inventoryId" in r}
        by_id = {}
        for row in inventory:
            by_id.setdefault(row[0], []).append(row)
        by_shape = {}
        for inventory_id, geometry in archive_crossings(archive_path, box(*in_scene.bounds).buffer(6)):
            by_shape.setdefault(inventory_id, []).extend(parts(geometry, "Polygon"))
        for inventory_id, outlines in sorted(by_shape.items()):
            if inventory_id in used or len(outlines) != 1:
                continue
            outline = outlines[0]
            if outline.area < 2 or in_scene.intersection(outline).area < outline.area * 0.85:
                continue
            if any(outline.intersection(reviewed).area > outline.area * 0.35 for reviewed in reviewed_outlines):
                continue
            matches = by_id.get(inventory_id, [])
            row = matches[0] if len(matches) == 1 and outline.buffer(2).covers(Point(matches[0][4])) else None
            add_record({"inventoryId": inventory_id}, row, axis_ends(outline))

    # A shared coordinate alone does not establish which direction a signal head serves.
    claims = Counter(tuple(head["coordinate"]) for record in records for head in record["heads"])
    for record in records:
        record["heads"] = [head for head in record["heads"] if claims[tuple(head["coordinate"])] == 1]
        if len(record["heads"]) < 2:
            record.pop("returnView", None)
    return records


def make_dataset(crossings, pavement, inventory, poles, district, inventory_date, pole_date, archive=None, island_archive=None):
    reviewed = {island["ufid"] for island in crossings.get("islands", [])}
    islands = []
    if island_archive is not None:
        roads = unary_union([polygon(rings) for rings in pavement["roads"]])
        if not roads.is_empty:
            islands = sorted((island for island in regional_islands(island_archive, roads)
                              if island["ufid"] not in reviewed), key=lambda island: island["ufid"])
    context = {**crossings, "islands": [*crossings.get("islands", []), *islands]}
    records = prepare(context, pavement, inventory, poles, district, archive)
    head_points = [Point(LOCAL(*head["coordinate"])) for record in records for head in record["heads"]]
    used_islands = []
    for island in islands:
        outline = polygon(island["shape"])
        if any(outline.covers(point) for point in head_points):
            used_islands.append(island)
    return {
        "inventorySource": INVENTORY_SOURCE,
        "inventoryRecorded": inventory_date,
        "poleSource": POLE_SOURCE,
        "poleFileUpdated": pole_date,
        "crossings": records,
        "islands": used_islands,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("crossings", type=Path, help="Reviewed crossing outlines, ends and pedestrian islands")
    parser.add_argument("pavement", type=Path, help="Modeled sidewalk polygons")
    parser.add_argument("inventory", type=Path, help="Seoul OA-23081 XLSX")
    parser.add_argument("poles", type=Path, help="Seoul OA-22356 CSV")
    parser.add_argument("district")
    parser.add_argument("output", type=Path)
    parser.add_argument("--inventory-date", required=True)
    parser.add_argument("--pole-file-date", required=True)
    parser.add_argument("--crosswalk-archive", type=Path, help="Seoul OA-15554 ZIP for automatic regional coverage")
    parser.add_argument("--island-archive", type=Path, help="Seoul OpenLab traffic island ZIP")
    args = parser.parse_args()
    result = make_dataset(read(args.crossings), read(args.pavement), args.inventory, args.poles, args.district,
                          args.inventory_date, args.pole_file_date, args.crosswalk_archive, args.island_archive)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
