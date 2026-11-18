"""Compare Seoul's archived flood-trace polygons with the mapped Songpa pilot site."""

import argparse
from datetime import date
import json
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

import shapefile
from pyproj import CRS, Transformer
from shapely import make_valid, transform, union_all
from shapely.geometry import mapping, shape
from shapely.ops import nearest_points


YEARS = tuple(year for year in range(2010, 2026) if year not in (2015, 2021))
RANGE_M = 700
REGION = Path(__file__).resolve().parents[2] / "frontend/public/datasets/regions/songpa"
LOCAL_CRS = CRS.from_epsg(5186)


def project(geometry, source, target):
    converter = Transformer.from_crs(source, target, always_xy=True)
    return transform(geometry, converter.transform, interleaved=False)


def polygon_parts(geometry):
    if geometry.is_empty:
        return
    if geometry.geom_type == "Polygon":
        yield geometry
    elif hasattr(geometry, "geoms"):
        for part in geometry.geoms:
            yield from polygon_parts(part)


def inspect_year(path, boundary, window):
    with ZipFile(path) as archive:
        (filename,) = [name for name in archive.namelist() if name.lower().endswith(".shp")]
        stem = filename[:-4]
        source = CRS.from_wkt(archive.read(stem + ".prj").decode("ascii"))
        extent = project(window, LOCAL_CRS, source).bounds
        to_local = Transformer.from_crs(source, LOCAL_CRS, always_xy=True)
        records = []
        with shapefile.Reader(shp=BytesIO(archive.read(filename)), dbf=BytesIO(archive.read(stem + ".dbf")),
                              encoding="cp949", encodingErrors="replace") as reader:
            for item in reader.iterShapes(bbox=extent):
                geometry = transform(shape(item.__geo_interface__), to_local.transform, interleaved=False)
                if not geometry.is_valid:
                    geometry = make_valid(geometry)
                for polygon in polygon_parts(geometry):
                    if polygon.intersects(window):
                        records.append((polygon, item.oid))
            if not records:
                return {"polygons": [], "nearest": None, "nearestM": None, "nearestMonth": None, "overlap": False}
            nearest, row_index = min(records, key=lambda record: boundary.distance(record[0]))
            month = None
            if any(field[0] == "F_SAT_YMD" for field in reader.fields):
                entry = str(reader.record(row_index, fields=["F_SAT_YMD"])[0]).strip()
                if entry[:6].isdigit() and 1 <= int(entry[4:6]) <= 12:
                    month = int(entry[4:6])

    polygons = [polygon for polygon, _ in records]
    overlap = any(polygon.intersects(boundary) for polygon in polygons)
    # Merge coincident records for display. Keep the distance and overlap from source geometry.
    display = union_all(polygons).intersection(window).simplify(0.35, preserve_topology=True)
    return {
        "polygons": [mapping(project(polygon, LOCAL_CRS, 4326))["coordinates"] for polygon in polygon_parts(display)],
        "nearest": list(project(nearest.representative_point(), LOCAL_CRS, 4326).coords[0]),
        "nearestM": round(boundary.distance(nearest), 1),
        "nearestMonth": month,
        "overlap": overlap,
    }


def nearby_water(boundary):
    environment = json.loads((REGION / "environment.geojson").read_text(encoding="utf-8"))
    waters = {}
    for key, name, matches in [
        ("pond", "주변 연못", lambda tags: tags.get("kind") == "water" and tags.get("category") == "pond"),
        ("river", "탄천 중심선", lambda tags: tags.get("kind") == "stream" and tags.get("name") == "탄천"),
    ]:
        features = [project(shape(f["geometry"]), 4326, LOCAL_CRS) for f in environment["features"] if matches(f["properties"])]
        nearest = min(features, key=boundary.distance)
        _, on_water = nearest_points(boundary, nearest)
        waters[key] = {
            "name": name,
            "point": list(project(on_water, LOCAL_CRS, 4326).coords[0]),
            "distanceM": round(boundary.distance(nearest), 1),
        }
    return waters


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("archives", type=Path, help="Directory with the original Seoul archive files named YYYY.zip")
    args.add_argument("--checked-on", type=date.fromisoformat, required=True, help="Date the city's published archive list was checked")
    args = args.parse_args()
    boundary_file = json.loads((REGION / "site.geojson").read_text(encoding="utf-8"))
    boundary = project(shape(boundary_file["features"][0]["geometry"]), 4326, LOCAL_CRS)
    search_area = boundary.buffer(RANGE_M)
    years = {str(year): inspect_year(args.archives / f"{year}.zip", boundary, search_area) for year in YEARS}
    data = {
        "checkedOn": args.checked_on.isoformat(),
        "radiusM": RANGE_M,
        "years": years,
        "water": nearby_water(boundary),
    }
    (REGION / "flood.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
