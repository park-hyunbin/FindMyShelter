"""Match one-way tour ramps to the national link inventory."""

import argparse
import hashlib
from io import BytesIO
from itertools import pairwise
import json
from pathlib import Path
from zipfile import ZipFile

import numpy as np
import shapefile
from pyproj import CRS, Transformer
from shapely import STRtree, transform
from shapely.geometry import LineString, shape

from prepare_songpa_road_markings import REGIONS


SOURCE = "https://www.its.go.kr/nodelink/nodelinkRef"
RADIUS_M = 5
MIN_ALIGNMENT = np.cos(np.deg2rad(20))
TO_METRES = Transformer.from_crs(4326, 5186, always_xy=True)


def ramps(regions):
    graphs = set()
    for file in regions.glob("*/road-markings.json"):
        folder = file.parent
        site = json.loads((folder / "site.geojson").read_text(encoding="utf-8"))
        neighborhood = site.get("metadata", {}).get("neighborhood")
        root = regions.parent / "neighborhoods" / neighborhood if neighborhood else folder
        graphs.add(root / "streets.json")
    variants = {}
    for path in sorted(graphs):
        for road in json.loads(path.read_text(encoding="utf-8"))["roads"]:
            if not (road["motor"] and road["oneWay"] and not road["unpaved"]
                    and road["category"].endswith("_link") and len(road["coordinates"]) >= 2):
                continue
            coordinates = tuple(map(tuple, road["coordinates"]))
            variants.setdefault(road["id"], {})[coordinates] = road
    for items in variants.values():
        # A reused way ID may still have different shapes in different snapshots.
        if len(items) != 1:
            continue
        coordinates, road = next(iter(items.items()))
        if road["width"] or road["lanes"] or road.get("forwardLanes") or road.get("backwardLanes"):
            continue
        directed = coordinates if road["oneWay"] == 1 else coordinates[::-1]
        axis = LineString([TO_METRES.transform(*point) for point in directed])
        if axis.length >= 20:
            yield road, axis


def inventory(path, bounds):
    stem = "MOCT_LINK"
    links, shapes = [], []
    with ZipFile(path) as archive:
        crs = CRS.from_wkt(archive.read(stem + ".prj").decode("ascii"))
        to_metres = Transformer.from_crs(crs, 5186, always_xy=True)
        source_bounds = Transformer.from_crs(5186, crs, always_xy=True).transform_bounds(*bounds)
        year, month, day, *_ = archive.getinfo(stem + ".shp").date_time
        with archive.open(stem + ".dbf") as attributes, shapefile.Reader(
            shp=BytesIO(archive.read(stem + ".shp")), shx=BytesIO(archive.read(stem + ".shx")),
            dbf=attributes, encoding="cp949",
        ) as reader:
            fields = ["LINK_ID", "F_NODE", "T_NODE", "LANES", "CONNECT", "ROAD_TYPE", "ROAD_USE"]
            for row in reader.iterShapeRecords(fields=fields, bbox=source_bounds):
                link = row.record.as_dict()
                if link["ROAD_USE"] != "0" or (link["LANES"] or 0) <= 0 or not row.shape.points:
                    continue
                geometry = shape(row.shape.__geo_interface__)
                if geometry.geom_type != "LineString":
                    continue
                links.append(link)
                shapes.append(transform(geometry, to_metres.transform, interleaved=False))
    return links, STRtree(shapes), f"{year:04d}-{month:02d}-{day:02d}"


def tangent(line, station):
    a = line.interpolate(station - min(0.35, station))
    b = line.interpolate(station + 0.35)
    return np.array([b.x - a.x, b.y - a.y]) / max(a.distance(b), 1e-6)


def aligned_links(tree, links, point, heading):
    candidates = []
    for index in tree.query(point, predicate="dwithin", distance=RADIUS_M):
        link = links[index]
        geometry = tree.geometries[index]
        station = geometry.project(point)
        if 0.06 < station < geometry.length - 0.06 and np.dot(heading, tangent(geometry, station)) >= MIN_ALIGNMENT:
            candidates.append((point.distance(geometry), link["LINK_ID"], link))
    return sorted(candidates, key=lambda item: item[:2])


def infer_lanes(road, line, links, tree):
    road_types = {"001", "003"} if road["bridge"] else {"000"}
    count = max(3, int(np.ceil(line.length / 6)))
    matches = []
    for station in (np.arange(count) + 0.5) * line.length / count:
        candidates = aligned_links(tree, links, line.interpolate(station), tangent(line, station))
        connections = [candidate for candidate in candidates if candidate[2]["CONNECT"] == "1"
                       and candidate[2]["ROAD_TYPE"] in road_types]
        if not connections:
            continue
        distance, _, best = connections[0]
        if any(link["ROAD_TYPE"] not in road_types and gap <= distance + 1 for gap, _, link in candidates):
            continue
        if candidates[0][2]["CONNECT"] != "1" and candidates[0][0] + 1 < distance:
            continue
        if any(other["LANES"] != best["LANES"] and gap - distance < 1 for gap, _, other in connections[1:]):
            continue
        matches.append(best)
    lanes = {link["LANES"] for link in matches}
    if len(matches) < count * 0.8 or len(lanes) != 1:
        return None
    if any(a["LINK_ID"] != b["LINK_ID"] and a["T_NODE"] != b["F_NODE"] for a, b in pairwise(matches)):
        return None
    return {
        "lanes": lanes.pop(),
        "coverage": round(len(matches) / count, 3),
        "vertices": [[node, *coordinate] for node, coordinate in zip(road["nodeIds"], road["coordinates"], strict=True)],
        "oneWay": road["oneWay"],
        "bridge": road["bridge"],
        "links": list(dict.fromkeys(link["LINK_ID"] for link in matches)),
    }


def build(path, regions):
    tour_ramps = list(ramps(regions))
    if not tour_ramps:
        raise ValueError("No one-way tour ramps to reconcile")
    bounds = np.array([line.bounds for _, line in tour_ramps])
    limits = (*bounds[:, :2].min(axis=0) - RADIUS_M, *bounds[:, 2:].max(axis=0) + RADIUS_M)
    links, index, date = inventory(path, limits)
    if not links:
        raise ValueError("No usable national links in the scene windows")
    matches = {}
    for road, axis in tour_ramps:
        match = infer_lanes(road, axis, links, index)
        if match:
            matches[str(road["id"])] = match
    with path.open("rb") as archive:
        digest = hashlib.file_digest(archive, "sha256").hexdigest()
    return {"source": SOURCE, "file": path.name, "archiveFileDate": date, "sha256": digest, "ramps": matches}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--regions", type=Path, default=REGIONS)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    data = build(args.archive, args.regions)
    args.output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(data['ramps'])} matched ramps")


if __name__ == "__main__":
    main()
