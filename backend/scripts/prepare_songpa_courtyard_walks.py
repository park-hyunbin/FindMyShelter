"""Build two reviewed courtyard paths from Seoul S-Map's inside-road edges."""

import argparse
from io import BytesIO
import json
from math import hypot
from pathlib import Path
from zipfile import ZipFile

from pyproj import CRS, Transformer
import shapefile
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import substring, unary_union

from prepare_neighborhood_pavement import export_polygons, parts
from prepare_neighborhood_planting import building_footprints

LAYER = "N1L_A0010000"
SOURCE = f"https://openlab.eseoul.go.kr/qgisplugin/SHP/{LAYER}.zip"
PREFIX = "1000377090304A00110000000000000"
OUTPUT = Path(__file__).resolve().parents[2] / "frontend/public/datasets/regions/songpa/courtyard-walks.json"
NORTH_JOIN = (127.1160007, 37.4977164)
SOUTH_JOIN = (127.1160731, 37.4975248)


def read_edges(path):
    stems = {PREFIX + str(number): number for number in (150, 156, 165)}
    edges = {}
    with ZipFile(path) as archive:
        crs = CRS.from_wkt(archive.read(f"{LAYER}.prj").decode("ascii"))
        if crs.to_epsg() != 5186:
            raise ValueError(f"Expected EPSG:5186 for {LAYER}")
        year, month, day, *_ = archive.getinfo(f"{LAYER}.shp").date_time
        with shapefile.Reader(
            shp=BytesIO(archive.read(f"{LAYER}.shp")), shx=BytesIO(archive.read(f"{LAYER}.shx")),
            dbf=BytesIO(archive.read(f"{LAYER}.dbf")), encoding="cp949",
        ) as reader:
            # The reviewed site lies within this compact search window in the published CRS.
            for item in reader.iterShapeRecords(fields=["UFID"], bbox=(210216, 544220, 210395, 544382)):
                number = stems.get(item.record["UFID"])
                if number:
                    if len(item.shape.parts) != 1:
                        raise ValueError(f"Review the changed edge {number}")
                    edges[number] = item.shape.points
    if {number: len(line) for number, line in edges.items()} != {150: 39, 156: 72, 165: 33}:
        raise ValueError("Source edge geometry changed; review the two path outlines against the imagery")
    return edges, stems.keys(), f"{year:04}-{month:02}-{day:02}"


def between(edge, start, end):
    return list(substring(edge, edge.project(Point(start)), edge.project(Point(end))).coords)


def join_edges(left, right, start_tangent, end, next_point):
    """Follow both path directions through the inferred transition."""
    start = tuple((a + b) / 2 for a, b in zip(left, right))
    span = hypot(end[0] - start[0], end[1] - start[1])
    incoming = tuple(value * span / hypot(*start_tangent) for value in start_tangent)
    delta = tuple(b - a for a, b in zip(end, next_point))
    outgoing = tuple(value * span / hypot(*delta) for value in delta)
    width = hypot(right[0] - left[0], right[1] - left[1])
    order = 1 if -incoming[1] * (right[0] - left[0]) + incoming[0] * (right[1] - left[1]) > 0 else -1
    sides = ([], [])
    for sample in range(1, 6):
        t = sample / 5
        blend = t * t * (3 - 2 * t)
        center = [a * (1 - blend) + b * blend + da * t * (1 - t) ** 2 - db * t * t * (1 - t)
                  for a, b, da, db in zip(start, end, incoming, outgoing)]
        dx, dy = [(b - a) * 6 * t * (1 - t) + da * (1 - t) * (1 - 3 * t) + db * t * (3 * t - 2)
                  for a, b, da, db in zip(start, end, incoming, outgoing)]
        half_width = (width * (1 - blend) + 2.8 * blend) / 2
        scale = order * half_width / hypot(dx, dy)
        for side, sign in zip(sides, (-1, 1)):
            side.append((center[0] - sign * dy * scale, center[1] + sign * dx * scale))
    return sides


def planting_margins(edges, east_start, walks):
    # The public courtyard photo shows planted ground beside the 103–104 path.
    # Use the surveyed path sides as inner limits; planting depth is visually estimated.
    west_edge = LineString(edges[165][6:13])
    east_edge = LineString(edges[150][4:13])
    east_run = LineString(between(east_edge, east_start, edges[150][4]))
    verge = unary_union([west_edge.buffer(-4.4, single_sided=True), east_run.buffer(3.1, single_sided=True)])
    obstacles = [*walks, *(building for building in building_footprints(OUTPUT.parent) if building.intersects(verge))]
    exposed = verge.difference(unary_union(obstacles))
    return [patch for patch in parts(exposed, "Polygon") if patch.area >= 1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    args = parser.parse_args()
    edges, ids, date = read_edges(args.archive)

    # Close across the ends at the playground and the 102 courtyard. The sides follow the source vertices.
    north = edges[156][10:54] + edges[150][12:19]
    # Use paired ends on the two edges of the narrow 103–104 connector.
    west_side = edges[165][6:10]
    east_edge = LineString(edges[150][8:13])
    east_side = between(east_edge, west_side[-1], west_side[0])
    metres = Transformer.from_crs(4326, 5186, always_xy=True)
    north_vector = tuple(a - b for a, b in zip(west_side[0], west_side[-1]))
    south_vector = tuple(-value for value in north_vector)
    left_north, right_north = join_edges(west_side[0], east_side[-1], north_vector,
                                       metres.transform(*NORTH_JOIN), metres.transform(127.1159631, 37.4977653))
    left_south, right_south = join_edges(west_side[-1], east_side[0], south_vector,
                                       metres.transform(*SOUTH_JOIN), metres.transform(127.1161267, 37.4974823))
    south = [*reversed(left_north), *west_side, *left_south, *reversed(right_south), *east_side, *right_north]

    convert = Transformer.from_crs(5186, 4326, always_xy=True)
    walks = []
    walk_polygons = []
    for key, outline in [("101-102-garden", north), ("103-104-connector", south)]:
        polygon = Polygon(outline)
        if not polygon.is_valid or polygon.area < 10:
            raise ValueError(f"Review geometry for {key}")
        coordinates = [[round(value, 9) for value in convert.transform(x, y)] for x, y in outline]
        walks.append({"id": key, "outline": coordinates})
        walk_polygons.append(polygon)
        print(f"{key}: {polygon.area:.1f} m2")
    margins = planting_margins(edges, east_side[-1], walk_polygons)
    if not margins:
        raise ValueError("No reviewed courtyard planting margins remain")
    result = {"source": SOURCE, "archiveFileDate": date, "sourceIds": sorted(ids),
              "connectorJoins": [NORTH_JOIN, SOUTH_JOIN], "walks": walks,
              "plantingMargins": export_polygons(unary_union(margins))}
    print(f"103–104 planting margins: {sum(patch.area for patch in margins):.1f} m2")
    OUTPUT.write_text(json.dumps(result, separators=(",", ":")) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
