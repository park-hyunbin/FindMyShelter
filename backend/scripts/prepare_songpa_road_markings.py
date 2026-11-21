"""Extract Seoul T-GIS lane geometry and crosswalk surfaces for the Songpa pilot."""

import argparse
from io import BytesIO
import json
from math import dist
from pathlib import Path
from zipfile import ZipFile

from openpyxl import load_workbook
from pyproj import CRS, Transformer
import shapefile
from shapely import make_valid
from shapely.geometry import box, shape

REGION = Path(__file__).resolve().parents[2] / "frontend/public/datasets/regions/songpa"
LANES = "https://data.seoul.go.kr/dataList/OA-15537/S/1/datasetView.do"
CROSSWALKS = "https://data.seoul.go.kr/dataList/OA-15554/S/1/datasetView.do"
CURRENT = "https://data.seoul.go.kr/dataList/OA-23081/F/1/datasetView.do"
HUMPS = "https://data.seoul.go.kr/dataList/OA-15541/S/1/datasetView.do"
TO_METERS = Transformer.from_crs(4326, 5186, always_xy=True)
TO_GPS = Transformer.from_crs(5186, 4326, always_xy=True)
BOUNDS = (127.1095, 37.4932, 127.1241, 37.5035)
CLIP = box(*TO_METERS.transform_bounds(*BOUNDS))


def city_features(archive, stem, clip=CLIP):
    filename = next(name for name in archive.namelist() if name.lower().endswith(f"{stem.lower()}.shp"))
    prefix = filename[:-4]
    if CRS.from_wkt(archive.read(prefix + ".prj").decode("ascii")).to_epsg() != 5186:
        raise ValueError(f"Unexpected coordinate reference system for {stem}")
    fields = {key: BytesIO(archive.read(prefix + "." + key)) for key in ("shp", "shx", "dbf")}
    with shapefile.Reader(**fields, encoding="cp949") as source:
        for feature in source.iterShapeRecords(bbox=clip.bounds):
            record = feature.record.as_dict()
            if record["STAT_CDE"] == "001" and record["VIEW_CDE"] == "002":
                yield record, make_valid(shape(feature.shape.__geo_interface__)).intersection(clip)


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


def painted_humps(path, selected):
    records = []
    with ZipFile(path) as archive:
        for tags, geometry in city_features(archive, "A067_A"):
            number = tags["HUMP_MGRNU"]
            # A067_A: 001 is a raised hump; 002 is an image painted on the road.
            if number not in selected or tags["A067_KND_C"] != "002":
                continue
            for polygon in getattr(geometry, "geoms", [geometry]):
                if polygon.geom_type != "Polygon" or polygon.area < 1:
                    continue
                corners = list(polygon.minimum_rotated_rectangle.exterior.coords)[:-1]
                side = min(range(2), key=lambda i: dist(corners[i], corners[i + 1]))
                centers = [tuple((a[axis] + b[axis]) / 2 for axis in range(2))
                           for a, b in ((corners[side], corners[side + 1]),
                                        (corners[side + 2], corners[(side + 3) % 4]))]
                start, end = gps(centers)
                records.append({"id": number, "start": start, "end": end,
                                "outline": gps(polygon.exterior.coords[:-1])})
    missing = selected - {record["id"] for record in records}
    if missing:
        raise ValueError(f"Selected painted humps not found: {', '.join(sorted(missing))}")
    return {"source": HUMPS, "archiveDate": "2025-04-17", "records": sorted(records, key=lambda item: item["id"])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("lanes", type=Path)
    parser.add_argument("crosswalk_surfaces", type=Path)
    parser.add_argument("current_crosswalks", type=Path)
    parser.add_argument("--humps", type=Path, help="Seoul A067_A archive")
    parser.add_argument("--hump-id", action="append", default=[], help="Reviewed HUMP_MGRNU, repeat for each location")
    args = parser.parse_args()
    if bool(args.humps) != bool(args.hump_id):
        parser.error("--humps and at least one --hump-id must be supplied together")
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
                                       "surfaces": [gps(polygon.exterior.coords[:-1]) for polygon in polygons]})

    if len(lanes) < 250 or len(crosswalks) < 30:
        raise ValueError("Street marking or crosswalk coverage is incomplete")
    result = {"lanesSource": LANES, "crosswalksSource": CROSSWALKS, "crosswalkInventory": CURRENT,
              "markingsArchiveDate": "2021-08-09", "crosswalkInventoryDate": "2026-08-24", "lanes": lanes, "crosswalks": crosswalks}
    destination = REGION / "road-markings.json"
    humps = painted_humps(args.humps, set(args.hump_id)) if args.humps else (
        json.loads(destination.read_text(encoding="utf-8")).get("paintedHumps") if destination.exists() else None)
    if humps:
        result["paintedHumps"] = humps
    destination.write_text(json.dumps(result, separators=(",", ":")) + "\n", encoding="utf-8")
    matches = sum(crosswalk["inventoryMatch"] for crosswalk in crosswalks)
    print(f"{len(lanes)} mapped lane lines, {len(crosswalks)} crosswalks ({matches} matched to the 2026 inventory)")


if __name__ == "__main__":
    main()
