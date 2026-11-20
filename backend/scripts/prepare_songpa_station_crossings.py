"""Align the Songpa Station walk with surveyed crossings and traffic islands."""

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
CROSSING_LAYER = "N1A_A0043325"
ISLAND_LAYER = "N1A_A0053326"
SOURCE = "https://openlab.eseoul.go.kr/qgisplugin/SHP"
PREFIX = "1000377090303A00410000000000000"
WAYS = {
    544143905: PREFIX + "016",
    544143903: PREFIX + "009",
    544143902: PREFIX + "011",
}
LOCAL = Transformer.from_crs(4326, 5186, always_xy=True).transform
GPS = Transformer.from_crs(5186, 4326, always_xy=True).transform

ROUTE_START = (127.1149546, 37.4976965)
ROUTE_END = (127.1142907, 37.4983851)
IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer"
IMAGERY_DATE = "2025-10-28"

# In route order from the complex. The internal paths and planting came from the orthophoto.
ISLAND_REVIEWS = {
    "1000377090304A00510000000000000007": {
        "path": [
            (127.1148071, 37.4977312), (127.1147776, 37.4977823), (127.1147266, 37.4978142),
            (127.1146703, 37.4978483), (127.1146193, 37.4978355), (127.1145469, 37.4977993),
        ],
        "planting": [
            [(127.1147615, 37.4979249), (127.1148285, 37.4979653), (127.1149090, 37.4979951),
             (127.1149465, 37.4979951), (127.1149063, 37.4979334), (127.1148714, 37.4978781),
             (127.1148419, 37.4978142), (127.1148098, 37.4978121), (127.1147668, 37.4978398),
             (127.1147373, 37.4978845)],
            [(127.1145040, 37.4976610), (127.1145710, 37.4976780), (127.1146354, 37.4976844),
             (127.1147239, 37.4976738), (127.1147695, 37.4976610), (127.1148017, 37.4976291),
             (127.1147776, 37.4975738), (127.1147668, 37.4975014), (127.1147695, 37.4974206),
             (127.1147695, 37.4973801), (127.1147132, 37.4974397), (127.1146542, 37.4975014),
             (127.1145952, 37.4975716), (127.1145362, 37.4976291)],
        ],
        "trees": [(127.1148205, 37.4978930), (127.1148849, 37.4979334),
                  (127.1146005, 37.4976355), (127.1146756, 37.4976334),
                  (127.1146998, 37.4975482), (127.1147373, 37.4974950)],
    },
    "1000377090303A00510000000000000012": {
        "path": [
            (127.1142626, 37.4980802), (127.1142679, 37.4981207), (127.1142438, 37.4981696),
            (127.1142223, 37.4982164), (127.1142250, 37.4982505), (127.1142492, 37.4982690),
        ],
        "planting": [
            [(127.1142626, 37.4982611), (127.1143350, 37.4982696), (127.1144262, 37.4982675),
             (127.1145067, 37.4982739), (127.1146005, 37.4982888), (127.1145576, 37.4982484),
             (127.1144772, 37.4982143), (127.1144074, 37.4981654), (127.1143430, 37.4981228),
             (127.1142921, 37.4981632), (127.1142706, 37.4982164)],
            [(127.1140024, 37.4982930), (127.1140641, 37.4982994), (127.1141285, 37.4982952),
             (127.1141768, 37.4982845), (127.1141768, 37.4982313), (127.1141928, 37.4981760),
             (127.1141633, 37.4981249), (127.1141231, 37.4981292), (127.1140829, 37.4981590),
             (127.1140453, 37.4981909), (127.1140051, 37.4982398)],
        ],
        "trees": [(127.1140882, 37.4982526), (127.1141285, 37.4982015), (127.1143162, 37.4982356),
                  (127.1143779, 37.4981930), (127.1144584, 37.4982335)],
    },
}


def read(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def line_parts(geometry):
    if not geometry.is_empty and geometry.geom_type == "LineString":
        yield geometry
    elif hasattr(geometry, "geoms"):
        for part in geometry.geoms:
            yield from line_parts(part)


def outline_archive(path, layer, ids, window, structure=None):
    with ZipFile(path) as archive:
        crs = CRS.from_wkt(archive.read(f"{layer}.prj").decode("ascii"))
        if crs.to_epsg() != 5186:
            raise ValueError(f"Expected EPSG:5186 for {layer}")
        year, month, day, *_ = archive.getinfo(f"{layer}.shp").date_time
        fields = ["UFID", "구조"] if structure else ["UFID"]
        with shapefile.Reader(shp=BytesIO(archive.read(f"{layer}.shp")),
                              shx=BytesIO(archive.read(f"{layer}.shx")),
                              dbf=BytesIO(archive.read(f"{layer}.dbf")), encoding="cp949") as reader:
            records = {
                entry.record["UFID"]: shape(entry.shape.__geo_interface__)
                for entry in reader.iterShapeRecords(fields=fields, bbox=window.bounds)
                if entry.record["UFID"] in ids and (not structure or entry.record["구조"] == structure)
            }
    if set(records) != set(ids) or any(not g.is_valid or g.geom_type != "Polygon" for g in records.values()):
        raise ValueError(f"A reviewed polygon in {layer} is missing or invalid")
    return records, f"{year:04}-{month:02}-{day:02}"


def crossing_axis(outline, route):
    vertices = list(outline.minimum_rotated_rectangle.exterior.coords)
    a, b = max(zip(vertices, vertices[1:]), key=lambda edge: dist(*edge))
    dx, dy = b[0] - a[0], b[1] - a[1]
    x, y = outline.centroid.coords[0]
    axis = LineString([(x - dx, y - dy), (x + dx, y + dy)])
    piece = max(line_parts(outline.intersection(axis)), key=lambda part: part.length)
    return sorted([piece.coords[0], piece.coords[-1]], key=lambda point: route.project(Point(point)))


def export(point):
    return [round(value, 9) for value in GPS(*point)]


def faces(geometry):
    if geometry.is_empty:
        return
    if geometry.geom_type == "Polygon":
        yield [[export(p) for p in ring.coords] for ring in (geometry.exterior, *geometry.interiors)]
    elif hasattr(geometry, "geoms"):
        for part in geometry.geoms:
            yield from faces(part)


def split_connector(points, sidewalks, island):
    line = LineString(points)
    cuts = {0.0, line.length}
    surfaces = [("survey", sidewalks), ("aerial", island)]
    for _, area in surfaces:
        if area is None:
            continue
        for piece in line_parts(line.intersection(area)):
            cuts.update(line.project(Point(point)) for point in (piece.coords[0], piece.coords[-1]))
    stations = sorted(cuts)
    for left, right in zip(stations, stations[1:]):
        if right - left < 1e-5:
            continue
        part = substring(line, left, right)
        mid = line.interpolate((left + right) / 2)
        source = next((kind for kind, area in surfaces if area is not None and area.covers(mid)), "unverified")
        yield {"coordinates": [export(point) for point in part.coords], "surface": source}


def reviewed_island(ufid, island, review, points, roads, crosswalks):
    if roads.buffer(0.025).intersection(island).area < island.area * 0.99:
        raise ValueError(f"Island {ufid} is outside the modeled pavement coverage")
    if island.intersection(crosswalks).area > 0.01 or any(not island.covers(Point(point)) for point in points[1:-1]):
        raise ValueError(f"Review where the walk meets island {ufid}")
    paving = LineString(points).buffer(1.4, cap_style="flat", join_style="round").intersection(island)
    planting = unary_union([Polygon([LOCAL(*p) for p in patch]) for patch in review["planting"]])
    planting = planting.intersection(island.buffer(-0.35)).difference(paving)
    trees = [coordinate for coordinate in review["trees"] if planting.covers(Point(*LOCAL(*coordinate)))]
    return {"ufid": ufid, "shape": next(faces(island)), "paving": list(faces(paving)),
            "planting": list(faces(planting)), "trees": trees}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("crosswalks", type=Path)
    parser.add_argument("islands", type=Path)
    args = parser.parse_args()
    record = next(item for item in read("access.json")["routes"] if item["id"] == "songpa-station")
    route = LineString([LOCAL(*point) for segment in record["segments"] for point in segment["coordinates"]])
    if [row["wayId"] for row in record["crossings"]] != list(WAYS):
        raise ValueError("Review the crossing matches after the route changed")
    if any(route.distance(Point(*LOCAL(*point))) > 0.05 for point in (ROUTE_START, ROUTE_END)):
        raise ValueError("Review the surveyed crossing connections after the route changed")

    window = route.buffer(35)
    raw, archive_date = outline_archive(args.crosswalks, CROSSING_LAYER, WAYS.values(), window)
    raw_islands, island_date = outline_archive(args.islands, ISLAND_LAYER, ISLAND_REVIEWS, window, "교통섬")
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

    legs, islands = [], []
    links = [[ROUTE_START], *(entry["path"] for entry in ISLAND_REVIEWS.values()), [ROUTE_END]]
    crosswalks = unary_union(list(raw.values()))
    island_ids = list(ISLAND_REVIEWS)
    for number, link in enumerate(links):
        points = [LOCAL(*point) for point in link]
        if number:
            points.insert(0, endpoints[number - 1][1])
        if number < len(crosses):
            points.append(endpoints[number][0])
        island = None
        if 0 < number < len(links) - 1:
            ufid = island_ids[number - 1]
            island = raw_islands[ufid]
            islands.append(reviewed_island(ufid, island, ISLAND_REVIEWS[ufid], points, roads, crosswalks))
        legs.extend(split_connector(points, sidewalks, island))
        if number < len(crosses):
            item = crosses[number]
            legs.append({"coordinates": [item["start"], item["end"]], "surface": "survey"})
    middle = endpoints[1]
    target = tuple((a + b) / 2 for a, b in zip(*middle))
    # Start the return view on the surveyed sidewalk on the station side.
    view_walk = LineString([LOCAL(*point) for point in legs[-1]["coordinates"]])
    view_position = view_walk.interpolate(0.5, normalized=True)
    if legs[-1]["surface"] != "survey" or not sidewalks.covers(view_position):
        raise ValueError("The station-side viewpoint is no longer on the surveyed sidewalk")
    result = {
        "source": f"{SOURCE}/{CROSSING_LAYER}.zip", "archiveFileDate": archive_date,
        "sidewalkSource": pavement["sidewalkSource"]["source"],
        "islandSource": f"{SOURCE}/{ISLAND_LAYER}.zip", "islandArchiveFileDate": island_date,
        "orthophoto": {"source": IMAGERY, "date": IMAGERY_DATE},
        "from": ROUTE_START, "to": ROUTE_END,
        "crossings": crosses, "legs": legs, "islands": islands,
        "view": {"position": export(view_position.coords[0]), "toward": export(target),
                 "distance": round(route.project(view_position), 2)},
    }
    (DATA / "station-crossings.json").write_text(json.dumps(result, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Matched {len(crosses)} crossings and {len(legs)} trace legs")


if __name__ == "__main__":
    main()
