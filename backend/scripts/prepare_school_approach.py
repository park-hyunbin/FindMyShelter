"""Extend a mapped walk to the sidewalk by a surveyed school gatepost."""
import argparse
import heapq
from io import BytesIO
import json
from pathlib import Path
from zipfile import ZipFile

from pyproj import CRS
import shapefile
from shapely import make_valid, transform, union_all
from shapely.geometry import LineString, Point, Polygon, shape
from shapely.ops import nearest_points
from shapely.prepared import prep

from prepare_neighborhood_pavement import DATA, SOURCE, TO_GPS, TO_METRES, parts

WALL_LAYER = "N1L_B0020000"


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def gps(points):
    return [[round(x, 8), round(y, 8)] for x, y in (TO_GPS(*point) for point in points)]


def read_gate(path, post_id, fence_ids):
    required = {post_id, *fence_ids}
    records = {}
    with ZipFile(path) as archive:
        stem = WALL_LAYER + "."
        if CRS.from_wkt(archive.read(stem + "prj").decode("ascii")).to_epsg() != 5186:
            raise ValueError("Expected a Seoul wall archive in EPSG:5186")
        year, month, day, *_ = archive.getinfo(stem + "shp").date_time
        fields = {name: BytesIO(archive.read(stem + name)) for name in ("shp", "shx", "dbf")}
        with shapefile.Reader(**fields, encoding="cp949") as reader:
            for record in reader.iterShapeRecords(fields=["UFID", "구분"]):
                identity = record.record["UFID"]
                if identity in required:
                    records[identity] = (record.record["구분"], shape(record.shape.__geo_interface__))
                if len(records) == len(required):
                    break
    if records.keys() != required or records[post_id][0] != "문주" or any(records[key][0] != "철책" for key in fence_ids):
        raise ValueError("The configured gatepost and fence records are missing or changed")
    post_line = records[post_id][1]
    if post_line.geom_type != "LineString" or not post_line.is_ring:
        raise ValueError("Expected a closed gatepost outline")
    post = Polygon(post_line)
    return post, [line for key in fence_ids for line in parts(records[key][1], "LineString")], f"{year:04}-{month:02}-{day:02}"


def sidewalk_line(surface, start, end):
    """Shortest line on the sidewalk polygon through visible corners."""
    visible = prep(surface)
    if visible.covers(LineString([start, end])):
        return LineString([start, end])
    nodes = [start.coords[0], end.coords[0]]
    for ring in (surface.exterior, *surface.interiors):
        nodes.extend(ring.coords[:-1])
    queue = [(0, 0)]
    costs = {0: 0}
    parents = {}
    while queue:
        distance, node = heapq.heappop(queue)
        if node == 1:
            path = [nodes[node]]
            while node != 0:
                node = parents[node]
                path.append(nodes[node])
            return LineString(path[::-1])
        if distance != costs[node]:
            continue
        for candidate, point in enumerate(nodes):
            if node == candidate or point == nodes[node]:
                continue
            line = LineString([nodes[node], point])
            cost = distance + line.length
            if cost < costs.get(candidate, float("inf")) and visible.covers(line):
                costs[candidate] = cost
                parents[candidate] = node
                heapq.heappush(queue, (cost, candidate))
    raise ValueError("The existing route and school approach lack a connected surveyed sidewalk")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path)
    parser.add_argument("walls", type=Path)
    args = parser.parse_args()
    config = read(args.config)
    tour = DATA / config["region"]
    access = next(route for route in read(tour / "access.json")["routes"] if route["id"] == config["routeId"])
    pavement = read(tour / "pavement.json")
    post, fences, archive_date = read_gate(args.walls, config["gatepostId"], config["fenceIds"])
    origin = Point(TO_METRES(*access["end"]))
    post_center = post.centroid
    corridor = LineString([origin, post_center]).buffer(16)
    sidewalks = union_all([make_valid(transform(Polygon(outer, holes), TO_METRES, interleaved=False)).intersection(corridor)
                           for outer, *holes in pavement["sidewalks"]])
    connected = [part for part in parts(sidewalks, "Polygon") if part.covers(origin)]
    if len(connected) != 1:
        raise ValueError("Expected the mapped crossing end on one measured sidewalk")
    sidewalk = connected[0]
    arrival = nearest_points(sidewalk, post_center)[0]
    # Keep the camera and guide inside the sidewalk, a few centimetres away from its digitized edge.
    inner = sidewalk.buffer(-0.18)
    approach = min(parts(inner, "Polygon"), key=lambda polygon: polygon.distance(arrival))
    standing = nearest_points(approach, post_center)[0]
    path = sidewalk_line(sidewalk, origin, standing)
    if any(path.crosses(fence) for fence in fences):
        raise ValueError("The public sidewalk trace intersects a surveyed school fence")
    if standing.distance(post_center) > 12 or path.length < 10:
        raise ValueError("Verify the approach and the gatepost assignment")
    opposing_fence = nearest_points(fences[-1], post_center)[0]
    opening = LineString([post_center, opposing_fence]).interpolate(0.5, normalized=True)
    camera = path.interpolate(path.length - 3)
    output = {
        "routeId": config["routeId"],
        "location": config["location"],
        "wallsSource": f"{SOURCE}/{WALL_LAYER}.zip",
        "wallsArchiveDate": archive_date,
        "wallIds": [config["gatepostId"], *config["fenceIds"]],
        "sidewalkSource": pavement["sidewalkSource"]["source"],
        "sidewalkArchiveDate": pavement["sidewalkSource"]["archiveFileDate"],
        "crossingInventoryId": config["crossingInventoryId"],
        "roadview": config["roadview"],
        "roadviewDate": config["roadviewDate"],
        "path": gps(path.coords),
        "walkM": round(path.length, 1),
        "postOutline": gps(post.exterior.coords[:-1]),
        "fences": [gps(fence.coords) for fence in fences],
        "post": gps([post_center.coords[0]])[0],
        "view": {"position": gps([camera.coords[0]])[0], "toward": gps([opening.coords[0]])[0]},
        "unmappedM": round(arrival.distance(post_center), 1),
    }
    (tour / "school-approach.json").write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{output['walkM']} m of modeled sidewalk, {output['unmappedM']} m from the sidewalk edge to the recorded gatepost")


if __name__ == "__main__":
    main()
