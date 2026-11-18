"""Sample the Seoul contour and spot-height archive along the Songpa walking routes."""

import argparse
from collections import defaultdict
from io import BytesIO
import json
import math
from pathlib import Path
from zipfile import ZipFile

import numpy as np
from pyproj import CRS, Transformer
import shapefile
from scipy.interpolate import LinearNDInterpolator
from scipy.spatial import cKDTree
from shapely.geometry import LineString, Point, box, shape


REGION = Path(__file__).resolve().parents[2] / "frontend/public/datasets/regions/songpa"
SOURCE = "https://data.seoul.go.kr/dataList/OA-22241/F/1/datasetView.do"
ROUTES = {"songpa-station", "songpa-station-detour", "songi-park", "songi-park-distance", "singa-school"}
STEP = 10
GRADE_WINDOW = 30


def read_topography(archive_path, bounds):
    contours, spots = [], []
    with ZipFile(archive_path) as archive:
        for layer, value in [("N3L_F001", "CONT"), ("N3P_F002", "NUME")]:
            (filename,) = [name for name in archive.namelist() if name.endswith(f"/{layer}.shp")]
            stem = filename[:-4]
            crs = CRS.from_wkt(archive.read(stem + ".prj").decode("ascii"))
            if crs.to_epsg() != 5174:
                raise ValueError(f"Expected EPSG:5174 for {layer}")
            crop = Transformer.from_crs(5186, crs, always_xy=True).transform_bounds(*bounds)
            project = Transformer.from_crs(crs, 5186, always_xy=True).transform
            with shapefile.Reader(
                shp=BytesIO(archive.read(filename)), shx=BytesIO(archive.read(stem + ".shx")),
                dbf=BytesIO(archive.read(stem + ".dbf")), encoding="cp949",
            ) as reader:
                for record in reader.iterShapeRecords(bbox=crop):
                    height = record.record[value]
                    if height != record.record["HEIGHT"] or not math.isfinite(height):
                        raise ValueError(f"Ambiguous height in {layer}")
                    if layer == "N3P_F002":
                        spots.append((*project(*record.shape.points[0]), height))
                        continue
                    clipped = shape(record.shape.__geo_interface__).intersection(box(*crop))
                    lines = clipped.geoms if hasattr(clipped, "geoms") else [clipped]
                    for line in lines:
                        if not isinstance(line, LineString) or line.length < 0.1:
                            continue
                        count = math.ceil(line.length / 5)
                        vertices = [project(*line.interpolate(i / count, normalized=True).coords[0])
                                    for i in range(count + 1)]
                        contours.append((height, LineString(vertices)))
    return contours, spots


def interpolator(rows):
    by_position = defaultdict(list)
    for x, y, height in rows:
        by_position[(round(x, 3), round(y, 3))].append(height)
    points = np.asarray(list(by_position))
    values = np.asarray([np.mean(heights) for heights in by_position.values()])
    return LinearNDInterpolator(points, values), cKDTree(points)


def sample_route(route, line, contours, spots, contour_points, estimate, support):
    crossings = {}
    for height, contour in contours:
        intersection = line.intersection(contour)
        for point in getattr(intersection, "geoms", [intersection]):
            if isinstance(point, Point) and not point.is_empty:
                crossings[round(line.project(point), 3)] = height
    entrance = route.get("parkEntrance")
    entry_distance = line.length - LineString(line.coords[-2:]).length if entrance else None
    if entrance and round(entry_distance) != entrance["routeM"]:
        raise ValueError("Park entrance must be the penultimate path vertex")
    distances = sorted({*range(0, math.ceil(line.length), STEP), line.length, *crossings,
                        *([entry_distance] if entrance else [])})
    samples = []
    for distance in distances:
        position = line.interpolate(distance).coords[0]
        height = float(estimate(*position))
        if not math.isfinite(height):
            raise ValueError(f"Unsupported terrain sample for {route['id']} at {distance:.1f}m")
        sample = {"distanceM": round(distance, 3), "elevationM": round(height, 2),
                  "nearestInputM": round(float(support.query(position)[0]), 1)}
        if distance in crossings:
            sample["contourM"] = crossings[distance]
        samples.append(sample)

    checks = []
    for index, (x, y, height) in enumerate(spots):
        if Point(x, y).distance(line) > 75:
            continue
        held_out, _ = interpolator(contour_points + spots[:index] + spots[index + 1:])
        predicted = float(held_out(x, y))
        if math.isfinite(predicted):
            checks.append(abs(predicted - height))
    if not checks:
        raise ValueError(f"No independent held-out spot heights near {route['id']}")

    return {
        "samples": samples,
        "checkedSpots": len(checks),
        "meanErrorM": round(float(np.mean(checks)), 2),
        "maxErrorM": round(max(checks), 2),
        **({"entranceSample": distances.index(entry_distance)} if entrance else {}),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="서울시 등고선.zip, published 2025-03-20")
    args = parser.parse_args()
    route_set = json.loads((REGION / "access.json").read_text(encoding="utf-8"))
    project = Transformer.from_crs(4326, 5186, always_xy=True).transform
    paths = []
    for route in route_set["routes"]:
        if route["id"] not in ROUTES:
            continue
        if route["id"] != "songi-park-distance" and not all(segment["mappedWalkway"] for segment in route["segments"]):
            raise ValueError(f"Expected a route tagged as footway/sidewalk for {route['id']}")
        coordinates = [coordinate for segment in route["segments"] for coordinate in segment["coordinates"]]
        paths.append((route, coordinates, LineString([project(*coordinate) for coordinate in coordinates])))
    if {route["id"] for route, _, _ in paths} != ROUTES:
        raise ValueError("Expected station, park and school routes")
    boxes = np.asarray([line.bounds for _, _, line in paths])
    bounds = (*np.min(boxes[:, :2], axis=0) - 240, *np.max(boxes[:, 2:], axis=0) + 240)
    contours, spots = read_topography(args.archive, bounds)
    contour_points = [(*point, height) for height, line in contours for point in line.coords]
    estimate, support = interpolator(contour_points + spots)
    results = {}
    for route, coordinates, line in paths:
        result = sample_route(route, line, contours, spots, contour_points, estimate, support)
        results[route["id"]] = {
            "path": ";".join(f"{lon:.7f},{lat:.7f}" for lon, lat in coordinates),
            **result,
        }
        print(route["id"], len(result["samples"]), "samples, held-out MAE", result["meanErrorM"], "m")
    result = {
        "source": SOURCE, "archivePublished": "2025-03-20", "scale": 5000, "routeStepM": STEP,
        "gradeWindowM": GRADE_WINDOW, "routes": results,
    }
    (REGION / "route-elevation.json").write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8",
    )


if __name__ == "__main__":
    main()
