"""Extract Seoul road and sidewalk surfaces around a mapped complex."""

import argparse
from io import BytesIO
import json
from pathlib import Path
from zipfile import ZipFile

from pyproj import CRS, Transformer
import shapefile
from shapely import intersection, make_valid, set_precision, transform
from shapely.geometry import LineString, Point, mapping, shape
from shapely.ops import unary_union
from shapely.prepared import prep

DATA = Path(__file__).resolve().parents[2] / "frontend/public/datasets/regions"
SOURCE = "https://openlab.eseoul.go.kr/qgisplugin/SHP"
ROAD_LAYER = "N1A_A0010000"
WALK_LAYER = "N1A_A0033320"
GRID_M = 0.01
TO_METRES = Transformer.from_crs(4326, 5186, always_xy=True).transform
TO_GPS = Transformer.from_crs(5186, 4326, always_xy=True).transform


def parts(geometry, kind):
    if geometry.is_empty:
        return
    if geometry.geom_type == kind:
        yield geometry
    elif hasattr(geometry, "geoms"):
        for member in geometry.geoms:
            yield from parts(member, kind)


def extract(archive_path, layer, window):
    fields = ["UFID"]
    outlines, ids = [], []
    with ZipFile(archive_path) as archive:
        stem = layer + "."
        crs = CRS.from_wkt(archive.read(stem + "prj").decode("ascii"))
        if crs.to_epsg() != 5186:
            raise ValueError(f"Expected EPSG:5186 for {layer}")
        year, month, day, *_ = archive.getinfo(stem + "shp").date_time
        with shapefile.Reader(shp=BytesIO(archive.read(stem + "shp")),
                              shx=BytesIO(archive.read(stem + "shx")),
                              dbf=BytesIO(archive.read(stem + "dbf")), encoding="cp949") as reader:
            for record in reader.iterShapeRecords(fields=fields, bbox=window.bounds):
                geometry = make_valid(shape(record.shape.__geo_interface__)).intersection(window)
                polygons = list(parts(geometry, "Polygon"))
                if not polygons:
                    continue
                outlines.extend(polygons)
                ids.append(record.record["UFID"])
    if not outlines:
        raise ValueError(f"No {layer} features intersect the given complex")
    # Snap both layers to the same centimetre grid before cutting shared edges.
    return set_precision(unary_union(outlines), GRID_M), {
        "source": f"{SOURCE}/{layer}.zip", "archiveFileDate": f"{year:04}-{month:02}-{day:02}",
        "sourceIds": sorted(set(ids)),
    }


def export_polygons(geometry):
    def rounded(point):
        return [round(point[0], 9), round(point[1], 9)]

    return [
        [[rounded(point) for point in ring]
         for ring in mapping(transform(polygon, TO_GPS, interleaved=False))["coordinates"]]
        for polygon in parts(geometry, "Polygon") if polygon.area >= 0.05
    ]


def covered_segments(graph, paved):
    # Allow for sub-metre rounding in the OSM tiles used as the graph source.
    # Repair slivers at touching corners and retain only surfaces for overlay.
    matched = unary_union(list(parts(make_valid(paved.buffer(0.35)), "Polygon")))
    footprint = prep(matched)
    spans = []
    for road in graph["roads"]:
        if not road["motor"] or road["bridge"] or road["unpaved"]:
            continue
        points = [TO_METRES(*point) for point in road["coordinates"]]
        for node, a, b in zip(road["nodeIds"], points, points[1:]):
            if a == b:
                continue
            axis = LineString([a, b])
            if not footprint.intersects(axis):
                continue
            cut = []
            for piece in parts(intersection(matched, axis, grid_size=GRID_M), "LineString"):
                if piece.length <= 0.25:
                    continue
                ends = [axis.project(Point(point), normalized=True) for point in (piece.coords[0], piece.coords[-1])]
                cut.append([round(t, 6) for t in sorted(ends)])
            if cut:
                spans.append([road["id"], node, sorted(cut)])
    return spans


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("region")
    parser.add_argument("roads", type=Path)
    parser.add_argument("sidewalks", type=Path)
    parser.add_argument("--radius", type=float, default=250, help="Clipping distance from the complex boundary in metres")
    parser.add_argument("--anchor", type=float, nargs=3, action="append", default=[],
                        metavar=("LON", "LAT", "METRES"), help="Include surveyed pavement near a route destination")
    args = parser.parse_args()
    folder = DATA / args.region
    site = json.loads((folder / "site.geojson").read_text(encoding="utf-8"))
    boundary = unary_union([
        transform(shape(feature["geometry"]), TO_METRES, interleaved=False) for feature in site["features"]
        if feature["properties"]["kind"] == "boundary"
    ])
    if boundary.is_empty or args.radius <= 0:
        parser.error("A polygonal complex boundary and a positive radius are required")
    neighborhood = site.get("metadata", {}).get("neighborhood")
    street_directory = DATA.parent / "neighborhoods" / neighborhood if neighborhood else folder
    graph = json.loads((street_directory / "streets.json").read_text(encoding="utf-8"))
    if any(not (-180 <= lon <= 180 and -90 < lat < 90 and radius > 0) for lon, lat, radius in args.anchor):
        parser.error("Each anchor requires longitude, latitude and a positive radius")
    window = unary_union([boundary.buffer(args.radius), *(
        Point(*TO_METRES(lon, lat)).buffer(radius) for lon, lat, radius in args.anchor
    )])
    roads, road_source = extract(args.roads, ROAD_LAYER, window)
    sidewalks, walk_source = extract(args.sidewalks, WALK_LAYER, window)
    # The city's broad road surface includes mapped pedestrian surfaces.
    driveway = roads.difference(sidewalks)
    result = {
        "radiusM": args.radius, "roadSource": road_source, "sidewalkSource": walk_source,
        "roads": export_polygons(driveway), "sidewalks": export_polygons(sidewalks),
        "coveredSegments": covered_segments(graph, driveway),
    }
    if args.anchor:
        result["additionalCoverage"] = [{"coordinate": [lon, lat], "radiusM": radius} for lon, lat, radius in args.anchor]
    (folder / "pavement.json").write_text(json.dumps(result, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{len(road_source['sourceIds'])} road / {len(walk_source['sourceIds'])} sidewalk sources, "
          f"{len(result['coveredSegments'])} graph segments with measured pavement")


if __name__ == "__main__":
    main()
