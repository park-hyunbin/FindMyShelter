"""Align the Songpa Station walk with three surveyed crossings on Yangjae-daero."""

import argparse
from io import BytesIO
import json
from math import dist
from pathlib import Path
from zipfile import ZipFile

from pyproj import CRS, Transformer
import shapefile
from shapely import transform
from shapely.geometry import LineString, Point, Polygon, shape
from shapely.ops import substring, unary_union

DATA = Path(__file__).resolve().parents[2] / "frontend/public/datasets/regions/songpa"
LAYER = "N1A_A0043325"
SOURCE = f"https://openlab.eseoul.go.kr/qgisplugin/SHP/{LAYER}.zip"
PREFIX = "1000377090303A00410000000000000"
WAYS = {
    544143905: PREFIX + "016",
    544143903: PREFIX + "009",
    544143902: PREFIX + "011",
}
LOCAL = Transformer.from_crs(4326, 5186, always_xy=True).transform
GPS = Transformer.from_crs(5186, 4326, always_xy=True).transform

# Reviewed route points at the approaches and on the two islands between crossings.
LINK_POINTS = [
    [(127.1149546, 37.4976965)],
    [(127.1146724, 37.497677), (127.1145856, 37.4976797), (127.1145818, 37.4977376)],
    [(127.1142568, 37.4981242), (127.1142638, 37.4981745), (127.1142765, 37.4982655)],
    [(127.1142907, 37.4983851)],
]


def read(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def line_parts(geometry):
    if not geometry.is_empty and geometry.geom_type == "LineString":
        yield geometry
    elif hasattr(geometry, "geoms"):
        for part in geometry.geoms:
            yield from line_parts(part)


def outline_archive(path, window):
    with ZipFile(path) as archive:
        crs = CRS.from_wkt(archive.read(f"{LAYER}.prj").decode("ascii"))
        if crs.to_epsg() != 5186:
            raise ValueError(f"Expected EPSG:5186 for {LAYER}")
        year, month, day, *_ = archive.getinfo(f"{LAYER}.shp").date_time
        with shapefile.Reader(shp=BytesIO(archive.read(f"{LAYER}.shp")),
                              shx=BytesIO(archive.read(f"{LAYER}.shx")),
                              dbf=BytesIO(archive.read(f"{LAYER}.dbf")), encoding="cp949") as reader:
            records = {
                entry.record["UFID"]: shape(entry.shape.__geo_interface__)
                for entry in reader.iterShapeRecords(fields=["UFID"], bbox=window.bounds)
                if entry.record["UFID"] in WAYS.values()
            }
    if set(records) != set(WAYS.values()):
        raise ValueError("A reviewed station crossing is missing from the supplied archive")
    return records, f"{year:04}-{month:02}-{day:02}"


def crossing_axis(outline, route):
    if outline.geom_type != "Polygon" or not outline.is_valid:
        raise ValueError("Expected a single valid crossing polygon")
    vertices = list(outline.minimum_rotated_rectangle.exterior.coords)
    a, b = max(zip(vertices, vertices[1:]), key=lambda edge: dist(*edge))
    dx, dy = b[0] - a[0], b[1] - a[1]
    x, y = outline.centroid.coords[0]
    axis = LineString([(x - dx, y - dy), (x + dx, y + dy)])
    piece = max(line_parts(outline.intersection(axis)), key=lambda part: part.length)
    return sorted([piece.coords[0], piece.coords[-1]], key=lambda point: route.project(Point(point)))


def export(point):
    return [round(value, 9) for value in GPS(*point)]


def split_connector(points, sidewalks):
    line = LineString(points)
    cuts = {0.0, line.length}
    for piece in line_parts(line.intersection(sidewalks)):
        cuts.update(line.project(Point(point)) for point in (piece.coords[0], piece.coords[-1]))
    stations = sorted(cuts)
    for left, right in zip(stations, stations[1:]):
        if right - left < 1e-5:
            continue
        part = substring(line, left, right)
        yield {"coordinates": [export(point) for point in part.coords],
               "confirmed": sidewalks.covers(line.interpolate((left + right) / 2))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("crosswalks", type=Path)
    args = parser.parse_args()
    record = next(item for item in read("access.json")["routes"] if item["id"] == "songpa-station")
    route = LineString([LOCAL(*point) for segment in record["segments"] for point in segment["coordinates"]])
    if [row["wayId"] for row in record["crossings"]] != list(WAYS):
        raise ValueError("Review the crossing matches after the route changed")
    if any(route.distance(Point(*LOCAL(*point))) > 0.05 for link in LINK_POINTS for point in link):
        raise ValueError("Review the surveyed crossing connections after the route changed")

    raw, archive_date = outline_archive(args.crosswalks, route.buffer(35))
    pavement = read("pavement.json")
    def local_faces(records):
        return unary_union([transform(Polygon(rings[0], rings[1:]), LOCAL, interleaved=False) for rings in records])

    roads = local_faces(pavement["roads"])
    sidewalks = local_faces(pavement["sidewalks"])
    crosses, endpoints = [], []
    for way, ufid in WAYS.items():
        outline = raw[ufid]
        if roads.buffer(0.025).intersection(outline).area < outline.area * 0.99:
            raise ValueError(f"Crossing {ufid} is outside the modeled pavement coverage")
        start, end = crossing_axis(outline, route)
        endpoints.append((start, end))
        crosses.append({"wayId": way, "ufid": ufid, "start": export(start), "end": export(end),
                        "outline": [export(point) for point in list(outline.exterior.coords)[:-1]]})

    legs = []
    for number, link in enumerate(LINK_POINTS):
        points = [LOCAL(*point) for point in link]
        if number:
            points.insert(0, endpoints[number - 1][1])
        if number < len(crosses):
            points.append(endpoints[number][0])
        legs.extend(split_connector(points, sidewalks))
        if number < len(crosses):
            item = crosses[number]
            legs.append({"coordinates": [item["start"], item["end"]], "confirmed": True})
    middle = endpoints[1]
    target = tuple((a + b) / 2 for a, b in zip(*middle))
    # Start the return view on the surveyed sidewalk on the station side.
    view_walk = LineString([LOCAL(*point) for point in legs[-1]["coordinates"]])
    view_position = view_walk.interpolate(0.5, normalized=True)
    if not legs[-1]["confirmed"] or not sidewalks.covers(view_position):
        raise ValueError("The station-side viewpoint is no longer on the surveyed sidewalk")
    result = {
        "source": SOURCE, "archiveFileDate": archive_date, "sidewalkSource": pavement["sidewalkSource"]["source"],
        "from": LINK_POINTS[0][0], "to": LINK_POINTS[-1][-1],
        "crossings": crosses, "legs": legs,
        "view": {"position": export(view_position.coords[0]), "toward": export(target),
                 "distance": round(route.project(view_position), 2)},
    }
    (DATA / "station-crossings.json").write_text(json.dumps(result, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Matched {len(crosses)} crossings and {len(legs)} trace legs")


if __name__ == "__main__":
    main()
