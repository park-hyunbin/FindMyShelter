"""Assemble reviewed internal road boundaries into visual paving surfaces."""

import argparse
from datetime import date
from io import BytesIO
import json
from pathlib import Path
from zipfile import ZipFile

from pyproj import CRS
import shapefile
from shapely import set_precision
from shapely.geometry import Polygon, shape
from shapely.ops import unary_union

from prepare_neighborhood_pavement import DATA, SOURCE, export_polygons, parts
from prepare_neighborhood_planting import building_footprints, local_shape, read_json

LAYER = "N1L_A0010000"
GRID_M = 0.05
CONFIG = Path(__file__).resolve().parents[2] / "data/config/surfaces"


def read_edges(path, window, ids, archive_date):
    with ZipFile(path) as archive:
        crs = CRS.from_wkt(archive.read(f"{LAYER}.prj").decode("ascii"))
        if crs.to_epsg() != 5186:
            raise ValueError(f"Expected EPSG:5186 for {LAYER}")
        archive_day = date(*archive.getinfo(f"{LAYER}.shp").date_time[:3]).isoformat()
        if archive_day != archive_date:
            raise ValueError("Review the selected vertices against the updated source")
        with shapefile.Reader(
            shp=BytesIO(archive.read(f"{LAYER}.shp")), shx=BytesIO(archive.read(f"{LAYER}.shx")),
            dbf=BytesIO(archive.read(f"{LAYER}.dbf")), encoding="cp949",
        ) as reader:
            lines = {feature.record["UFID"]: set_precision(shape(feature.shape.__geo_interface__), GRID_M)
                     for feature in reader.iterShapeRecords(fields=["UFID"], bbox=window.bounds)
                     if feature.record["UFID"] in ids}
    if set(lines) != ids or any(line.geom_type != "LineString" for line in lines.values()):
        raise ValueError("One or more reviewed road edges are missing or have changed type")
    return lines


def build(folder, archive, config):
    boundary = unary_union([local_shape(f["geometry"]) for f in read_json(folder / "site.geojson")["features"]
                            if f["properties"]["kind"] == "boundary"])
    window = boundary.buffer(350)
    ids = {ufid for area in config["areas"] for ufid, *_ in area["edges"]}
    edges = read_edges(archive, window, ids, config["archiveDate"])
    pavement = read_json(folder / "pavement.json")
    planting_path = folder / "neighborhood-planting.json"
    planting = read_json(planting_path)["patches"] if planting_path.exists() else []
    known_polygons = [local_shape({"type": "Polygon", "coordinates": p})
                      for p in [*pavement["roads"], *pavement["sidewalks"], *planting]]
    landscape = [local_shape(f["geometry"]) for f in read_json(folder / "environment.geojson")["features"]
                 if f["properties"]["kind"] in {"green", "water"} and "Polygon" in f["geometry"]["type"]]
    occupied = set_precision(unary_union([boundary, *known_polygons, *landscape, *building_footprints(folder)]), GRID_M)
    outlines = []
    for area in config["areas"]:
        points = []
        for ufid, first, last in area["edges"]:
            step = 1 if last >= first else -1
            points.extend(edges[ufid].coords[i] for i in range(first, last + step, step))
        polygon = Polygon(points)
        if not polygon.is_valid or not window.covers(polygon):
            raise ValueError(f"Invalid reviewed outline: {area['name']}")
        outlines.append(polygon)
    exposed = set_precision(unary_union(outlines), GRID_M).difference(occupied)
    polygons = [p for p in parts(exposed, "Polygon") if p.area >= 2]
    if not polygons:
        raise ValueError("The reviewed surfaces do not have any exposed paving")
    return {
        "source": f"{SOURCE}/{LAYER}.zip",
        "archiveDate": config["archiveDate"],
        "sourceIds": sorted(ids),
        "reviewedAreas": [area["name"] for area in config["areas"]],
        "areaM2": round(sum(p.area for p in polygons)),
        "surfaces": export_polygons(unary_union(polygons)),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("region")
    parser.add_argument("archive", type=Path)
    args = parser.parse_args()
    folder = DATA / args.region
    result = build(folder, args.archive, read_json(CONFIG / f"{args.region}.json"))
    (folder / "service-paving.json").write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{len(result['reviewedAreas'])} reviewed areas, {result['areaM2']} square metres")


if __name__ == "__main__":
    main()
