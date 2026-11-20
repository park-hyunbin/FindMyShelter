"""Extract surveyed planting areas without covering known hard surfaces."""

import argparse
from io import BytesIO
import json
from pathlib import Path
from zipfile import ZipFile

from pyproj import CRS, Transformer
import shapefile
from shapely import make_valid, set_precision, transform
from shapely.geometry import shape
from shapely.ops import unary_union

from prepare_neighborhood_pavement import DATA, ROAD_LAYER, WALK_LAYER, TO_METRES, export_polygons, extract, parts

SOURCE = "https://data.seoul.go.kr/dataList/OA-21145/S/1/datasetView.do"
SURVEY = "UPIS_BIOTOP_TYP_2025"
# The city's report defines these types as planted areas below and above one hectare.
PLANTED = {"E1", "E2"}
GRID_M = 0.05


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def local_shape(geometry):
    return make_valid(transform(shape(geometry), TO_METRES, interleaved=False))


def read_planting(path, window):
    with ZipFile(path) as archive:
        shp = next(name for name in archive.namelist() if Path(name).name == f"{SURVEY}.shp")
        stem = shp[:-4]
        crs = CRS.from_wkt(archive.read(stem + ".prj").decode("ascii"))
        if crs.to_epsg() != 5174:
            raise ValueError(f"Expected EPSG:5174 for {SURVEY}")
        source_bounds = Transformer.from_crs(5186, crs, always_xy=True).transform_bounds(*window.bounds)
        project = Transformer.from_crs(crs, 5186, always_xy=True).transform
        with shapefile.Reader(
            shp=BytesIO(archive.read(shp)), shx=BytesIO(archive.read(stem + ".shx")),
            dbf=BytesIO(archive.read(stem + ".dbf")), encoding="cp949",
        ) as reader:
            for feature in reader.iterShapeRecords(fields=["비오톱유형"], bbox=source_bounds):
                if feature.record["비오톱유형"] in PLANTED:
                    geometry = make_valid(transform(shape(feature.shape.__geo_interface__), project, interleaved=False))
                    clipped = geometry.intersection(window)
                    if clipped.area >= 3:
                        yield clipped


def build(folder, archive, road_archive, walk_archive, radius):
    site = read_json(folder / "site.geojson")
    boundary = unary_union([local_shape(feature["geometry"]) for feature in site["features"]
                            if feature["properties"]["kind"] == "boundary"])
    if boundary.is_empty:
        raise ValueError("A polygonal complex boundary is required")
    window = boundary.buffer(radius)
    road, road_source = extract(road_archive, ROAD_LAYER, window)
    walk, walk_source = extract(walk_archive, WALK_LAYER, window)
    buildings = DATA.parent / "buildings" / folder.name
    manifest = read_json(buildings / "manifest.json")
    footprints = [local_shape(feature["geometry"]).intersection(window)
                  for item in manifest["chunks"] for feature in read_json(buildings / item["url"])["features"]]
    mapped = [local_shape(feature["geometry"]).intersection(window)
              for feature in read_json(folder / "environment.geojson")["features"]
              if feature["properties"]["kind"] in {"green", "water"} and "Polygon" in feature["geometry"]["type"]]
    occupied = set_precision(unary_union([road, walk, *footprints, *mapped]), GRID_M)
    surveyed = list(read_planting(archive, window))
    planting = set_precision(unary_union(surveyed).simplify(0.15, preserve_topology=True), GRID_M).difference(occupied)
    patches = [p for p in parts(planting, "Polygon") if p.area >= 3]
    if not patches:
        raise ValueError("No supplemental planting areas remain after excluding occupied surfaces")
    return {
        "source": SOURCE,
        "survey": SURVEY,
        "sourceCrs": "EPSG:5174",
        "biotopeTypes": sorted(PLANTED),
        "radiusM": radius,
        "surveyedAreas": len(surveyed),
        "displayedAreaM2": round(sum(p.area for p in patches)),
        "maskSources": [road_source["source"], walk_source["source"]],
        "patches": export_polygons(unary_union(patches)),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("region")
    parser.add_argument("biotope", type=Path)
    parser.add_argument("roads", type=Path)
    parser.add_argument("sidewalks", type=Path)
    parser.add_argument("--radius", type=int, default=450, help="Clipping distance from the complex boundary in metres")
    args = parser.parse_args()
    if args.radius <= 0:
        parser.error("A positive radius is required")
    folder = DATA / args.region
    result = build(folder, args.biotope, args.roads, args.sidewalks, args.radius)
    (folder / "neighborhood-planting.json").write_text(json.dumps(result, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{result['surveyedAreas']} source areas, {len(result['patches'])} visible patches, "
          f"{result['displayedAreaM2']} square metres")


if __name__ == "__main__":
    main()
