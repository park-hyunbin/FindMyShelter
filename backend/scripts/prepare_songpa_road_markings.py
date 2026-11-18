"""Extract Seoul T-GIS lane geometry and crosswalk surfaces for the Songpa pilot."""

import argparse
from io import BytesIO
import json
import math
from pathlib import Path
from zipfile import ZipFile

from openpyxl import load_workbook
from pyproj import CRS, Transformer
import shapefile
from shapely import make_valid
from shapely.affinity import rotate
from shapely.geometry import box, shape

REGION = Path(__file__).resolve().parents[2] / "frontend/public/datasets/regions/songpa"
LANES = "https://data.seoul.go.kr/dataList/OA-15537/S/1/datasetView.do"
CROSSWALKS = "https://data.seoul.go.kr/dataList/OA-15554/S/1/datasetView.do"
CURRENT = "https://data.seoul.go.kr/dataList/OA-23081/F/1/datasetView.do"
TO_METERS = Transformer.from_crs(4326, 5186, always_xy=True)
TO_GPS = Transformer.from_crs(5186, 4326, always_xy=True)
BOUNDS = (127.1095, 37.4932, 127.1241, 37.5035)
CLIP = box(*TO_METERS.transform_bounds(*BOUNDS))


def city_features(archive, stem):
    filename = next(name for name in archive.namelist() if name.lower().endswith(f"{stem.lower()}.shp"))
    prefix = filename[:-4]
    if CRS.from_wkt(archive.read(prefix + ".prj").decode("ascii")).to_epsg() != 5186:
        raise ValueError(f"Unexpected coordinate reference system for {stem}")
    fields = {key: BytesIO(archive.read(prefix + "." + key)) for key in ("shp", "shx", "dbf")}
    with shapefile.Reader(**fields, encoding="cp949") as source:
        for feature in source.iterShapeRecords(bbox=CLIP.bounds):
            record = feature.record.as_dict()
            if record["STAT_CDE"] == "001" and record["VIEW_CDE"] == "002":
                yield record, make_valid(shape(feature.shape.__geo_interface__)).intersection(CLIP)


def gps(points):
    return [[round(lon, 7), round(lat, 7)] for lon, lat in (TO_GPS.transform(x, y) for x, y in points)]


def lane_style(kind, subtype):
    # T-GIS lane table specification A058_L, fields A058_KND_CDE and A058_KND_CDE2.
    if kind == "001":
        return {"001": "yellow", "002": "yellow-dash", "003": "yellow-double",
                "004": "yellow-combined", "005": "yellow-combined"}.get(subtype)
    if kind in {"002", "009"}:
        return "yellow-dash" if kind == "009" or subtype == "002" else "yellow"
    if kind == "016":
        return "white" if subtype == "002" else "yellow"
    if kind in {"005", "013", "017", "018"}:
        return "blue-dash" if subtype in {"002", "004"} else "blue"
    if kind in {"003", "011", "012"} or kind == "006" and subtype == "002":
        return "white-dash"
    if kind in {"004", "006", "007", "008", "010", "014", "015"}:
        return "stop" if kind == "004" else "white"
    return None


def paint_crosswalk(polygon):
    ring = list(polygon.minimum_rotated_rectangle.exterior.coords)
    a, b = max(zip(ring, ring[1:]), key=lambda pair: math.dist(*pair))
    angle = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
    origin = (polygon.centroid.x, polygon.centroid.y)
    aligned = rotate(polygon, -angle, origin=origin)
    west, south, east, north = aligned.bounds
    count = max(1, round((east - west) / 0.83))
    spacing = (east - west) / count
    stripes = []
    for i in range(count):
        x = west + (i + 0.5) * spacing
        clipped = aligned.intersection(box(x - 0.22, south - 0.1, x + 0.22, north + 0.1))
        for stripe in getattr(clipped, "geoms", [clipped]):
            if stripe.geom_type == "Polygon" and stripe.area > 0.08:
                stripes.append(gps(rotate(stripe, angle, origin=origin).exterior.coords[:-1]))
    return stripes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("lanes", type=Path)
    parser.add_argument("crosswalk_surfaces", type=Path)
    parser.add_argument("current_crosswalks", type=Path)
    args = parser.parse_args()
    lanes = []
    with ZipFile(args.lanes) as archive:
        for tags, geom in city_features(archive, "A058_L"):
            style = lane_style(tags["A058_KND_C"], tags["A058_KND2_"])
            if style is None:
                continue
            for line in getattr(geom, "geoms", [geom]):
                if line.geom_type == "LineString" and line.length > 0.25:
                    edge = tags["A058_KND_C"] in {"002", "007", "009"}
                    lanes.append({"style": style, "points": gps(line.simplify(0.11).coords), **({"edge": True} if edge else {})})

    workbook = load_workbook(args.current_crosswalks, read_only=True, data_only=True)
    rows = workbook.active.iter_rows(min_row=2, values_only=True)
    current = {str(row[2]) for row in rows if isinstance(row[7], (int, float)) and isinstance(row[8], (int, float))
               and CLIP.covers(shape({"type": "Point", "coordinates": (row[7], row[8])}))}
    workbook.close()
    crosswalks = []
    with ZipFile(args.crosswalk_surfaces) as archive:
        nested = next(name for name in archive.namelist() if name.startswith("A004_A_") and name.endswith(".zip"))
        with ZipFile(BytesIO(archive.read(nested))) as surfaces:
            for tags, geom in city_features(surfaces, "A004_A"):
                polygons = [polygon for polygon in getattr(geom, "geoms", [geom])
                            if polygon.geom_type == "Polygon" and polygon.area > 1]
                if polygons:
                    center = gps([(geom.centroid.x, geom.centroid.y)])[0]
                    crosswalks.append({"center": center,
                                       "inventoryMatch": tags["MGRNU"] in current,
                                       "surfaces": [gps(polygon.exterior.coords[:-1]) for polygon in polygons],
                                       "stripes": [stripe for polygon in polygons for stripe in paint_crosswalk(polygon)]})

    if len(lanes) < 250 or len(crosswalks) < 30:
        raise ValueError("Street marking or crosswalk coverage is incomplete")
    result = {"lanesSource": LANES, "crosswalksSource": CROSSWALKS, "crosswalkInventory": CURRENT,
              "markingsArchiveDate": "2021-08-09", "crosswalkInventoryDate": "2026-08-24", "lanes": lanes, "crosswalks": crosswalks}
    (REGION / "road-markings.json").write_text(json.dumps(result, separators=(",", ":")) + "\n", encoding="utf-8")
    matches = sum(crosswalk["inventoryMatch"] for crosswalk in crosswalks)
    print(f"{len(lanes)} mapped lane lines, {len(crosswalks)} crosswalks ({matches} matched to the 2026 inventory)")


if __name__ == "__main__":
    main()
