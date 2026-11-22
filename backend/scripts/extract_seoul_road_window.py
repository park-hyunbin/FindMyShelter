"""Export one road and marking window from the shared Seoul spatial index."""

import argparse
from contextlib import closing
import json
from pathlib import Path
import sqlite3

from pyproj import Transformer
from shapely import from_wkb, transform
from shapely.geometry import box, mapping
from shapely.ops import substring

from prepare_neighborhood_pavement import parts


TO_METRES = Transformer.from_crs(4326, 5186, always_xy=True)
TO_GPS = Transformer.from_crs(5186, 4326, always_xy=True)


def bounds_parameters(window):
    west, south, east, north = window.bounds
    return east, west, north, south


def feature(geometry, **properties):
    return {"type": "Feature", "geometry": mapping(transform(geometry, TO_GPS.transform, interleaved=False)),
            "properties": properties}


def surface_shapes(db, window, table):
    query = f"""SELECT surface.id, surface.ufid, surface.geometry
        FROM {table}_bounds bounds JOIN {table} surface ON surface.id=bounds.id
        WHERE bounds.min_x<=? AND bounds.max_x>=? AND bounds.min_y<=? AND bounds.max_y>=?
        ORDER BY surface.id"""
    for id_, ufid, geometry in db.execute(query, bounds_parameters(window)):
        for polygon in parts(from_wkb(geometry).intersection(window), "Polygon"):
            yield id_, ufid, polygon


def surfaces(db, window, table):
    for id_, ufid, polygon in surface_shapes(db, window, table):
        yield feature(polygon, layer=table, source_id=id_, ufid=ufid)


def marking_lines(db, window, single_road_only=False):
    query = """SELECT marking.id, marking.management_id, marking.style, marking.source,
            marking.geometry, span.start_m, span.end_m, span.status, road.ufid
        FROM marking_bounds bounds JOIN marking ON marking.id=bounds.id
        JOIN span ON span.marking_id=marking.id LEFT JOIN road ON road.id=span.road_id
        WHERE bounds.min_x<=? AND bounds.max_x>=? AND bounds.min_y<=? AND bounds.max_y>=?
          AND (NOT ? OR span.status='single_road')
        ORDER BY marking.id, span.start_m"""
    previous_id, original = None, None
    for id_, management, style, source, geometry, begin, end, status, road in db.execute(
            query, (*bounds_parameters(window), single_road_only)):
        if previous_id != id_:
            previous_id, original = id_, from_wkb(geometry)
        segment = substring(original, begin, end)
        for line in parts(segment.intersection(window), "LineString"):
            yield line, management, style, source, status, road


def markings(db, window, single_road_only):
    for line, management, style, source, status, road in marking_lines(db, window, single_road_only):
        yield feature(line, layer="marking", management_id=management, style=style,
                      source=source, status=status, road_ufid=road)


def extract(database, bbox, single_road_only):
    window = box(*TO_METRES.transform_bounds(*bbox))
    with closing(sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        features = [*surfaces(db, window, "road"), *surfaces(db, window, "walk"),
                    *markings(db, window, single_road_only)]
    return {"type": "FeatureCollection", "features": features}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--bbox", type=float, nargs=4, required=True,
                        metavar=("WEST", "SOUTH", "EAST", "NORTH"), help="WGS84 bounding box")
    parser.add_argument("--single-road-only", action="store_true", help="Restrict the inspection export to single-road spans")
    args = parser.parse_args()
    west, south, east, north = args.bbox
    if not (-180 <= west < east <= 180 and -90 < south < north < 90):
        parser.error("--bbox requires an ordered WGS84 bounding box")
    if args.output.suffix.lower() != ".geojson":
        parser.error("output must have a .geojson suffix")
    data = extract(args.database, args.bbox, args.single_road_only)
    args.output.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
