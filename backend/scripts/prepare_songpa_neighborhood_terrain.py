"""Build the Songpa neighborhood terrain from Seoul contours and spot heights."""

import argparse
import json
from pathlib import Path

import numpy as np
from pyproj import Transformer

from prepare_songpa_route_elevation import REGION, SOURCE, interpolator, read_topography


def smoothstep(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="서울시 등고선.zip (2025-03-20)")
    args = parser.parse_args()
    dem = json.loads((REGION / "terrain.json").read_text(encoding="utf-8"))
    west, north = dem["originEPSG5186"]
    convert = Transformer.from_crs(4326, 5186, always_xy=True)
    center_x, center_y = convert.transform(127.11665, 37.49780)
    extent, step = 480, 10
    offsets = np.arange(-extent, extent + step, step)
    dx, dy = np.meshgrid(offsets, offsets)
    x, y = center_x + dx, center_y - dy
    bounds = (x.min() - 130, y.min() - 130, x.max() + 130, y.max() + 130)
    contours, spots = read_topography(args.archive, bounds)
    estimate, support = interpolator([(*point, height) for height, line in contours for point in line.coords] + spots)
    measured = estimate(x, y)
    distance = support.query(np.stack((x, y), axis=-1))[0]

    # Feather the seam and sparse areas into the surrounding model.
    feather = 150
    boundary = smoothstep((extent - np.maximum(abs(dx), abs(dy))) / feather)
    density = smoothstep((105 - distance) / 50)
    weight = boundary * density * np.isfinite(measured)
    grid = np.asarray(dem["elevation"]).reshape(dem["size"], dem["size"])
    col = (x - west + dem["extentM"]) / dem["spacingM"]
    row = (north - y + dem["extentM"]) / dem["spacingM"]
    i, j = np.floor(col).astype(int), np.floor(row).astype(int)
    a, b = col - i, row - j
    fallback = (grid[j, i] * (1 - a) + grid[j, i + 1] * a) * (1 - b) + (
        grid[j + 1, i] * (1 - a) + grid[j + 1, i + 1] * a) * b
    elevation = fallback + np.where(weight > 0, measured - fallback, 0) * weight
    result = {
        "source": SOURCE, "archivePublished": "2025-03-20", "scale": 5000,
        "originEPSG5186": dem["originEPSG5186"], "center": [center_x - west, north - center_y],
        "extentM": extent, "spacingM": step, "size": len(offsets), "edgeFeatherM": feather,
        "elevation": np.round(elevation.ravel(), 2).tolist(),
    }
    (REGION / "neighborhood-terrain.json").write_text(json.dumps(result, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{np.count_nonzero(weight)} blended cells, {len(spots)} spot heights, {len(contours)} contour runs")


if __name__ == "__main__":
    main()
