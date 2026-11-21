"""Georeference supplemental landscaping from plan anchors and protect mapped footprints."""
import argparse
import json
from pathlib import Path

import numpy as np
from pyproj import Transformer
from shapely import transform, union_all
from shapely.geometry import LineString, Polygon, shape

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "frontend/public/datasets"
TO_METRES = Transformer.from_crs(4326, 5186, always_xy=True).transform
TO_WGS84 = Transformer.from_crs(5186, 4326, always_xy=True).transform


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def polygons(geometry):
    if geometry.is_empty:
        return
    if geometry.geom_type == "Polygon":
        yield geometry
    elif hasattr(geometry, "geoms"):
        for component in geometry.geoms:
            yield from polygons(component)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path)
    config = read(parser.parse_args().config)
    region = config["region"]
    building_dir = PUBLIC / "buildings" / region
    tour = PUBLIC / "regions" / region
    buildings = [feature for chunk in read(building_dir / "manifest.json")["chunks"]
                 for feature in read(building_dir / chunk["url"])["features"]]
    tower_shapes = {
        feature["properties"]["dong"]: transform(shape(feature["geometry"]), TO_METRES, interleaved=False)
        for feature in buildings if feature["properties"]["dong"]
    }
    site = next(feature for feature in read(tour / "site.geojson")["features"]
                if feature["properties"]["kind"] == "boundary")
    boundary = transform(shape(site["geometry"]), TO_METRES, interleaved=False)
    design = np.array([[x, y, 1] for x, y in config["anchors"].values()])
    measured = np.array([list(tower_shapes[dong].centroid.coords[0]) for dong in config["anchors"]])
    coefficients, _, rank, _ = np.linalg.lstsq(design, measured, rcond=None)
    errors = np.linalg.norm(design @ coefficients - measured, axis=1)
    if rank != 3 or max(errors) > config["maxAnchorErrorM"]:
        parser.error(f"Plan anchors do not align with the building map: {errors.round(1).tolist()} m")

    def from_pixels(points):
        return np.column_stack((points, np.ones(len(points)))) @ coefficients

    # Preserve surveyed road and walkway surfaces. The plan supplements the interior only.
    pavement = read(tour / "pavement.json")
    mapped = [transform(Polygon(outer, holes), TO_METRES, interleaved=False)
              for outer, *holes in [*pavement["roads"], *pavement["sidewalks"]]]
    overlaps = [transform(shape(feature["geometry"]), TO_METRES, interleaved=False)
                for feature in buildings]
    obstructions = union_all([footprint.buffer(1.2) for footprint in overlaps if footprint.intersects(boundary)])
    mapped_surfaces = union_all([surface for surface in mapped if surface.intersects(boundary)])
    clear = boundary.difference(obstructions).difference(mapped_surfaces)
    paths = [LineString(from_pixels(path["pixels"])).buffer(path["widthM"] / 2, quad_segs=3)
             for path in config["paths"]]
    walks = union_all([path.intersection(clear) for path in paths])
    driveway = union_all([
        transform(LineString(road["coordinates"]), TO_METRES, interleaved=False).buffer(3.5)
        for road in read(tour / "streets.json")["roads"] if road["motor"] and road["category"] == "service"
    ]).intersection(boundary)
    plantable = clear.difference(walks.buffer(0.45)).difference(driveway)

    def rings(polygon):
        gps = transform(polygon.simplify(0.07, preserve_topology=True), TO_WGS84, interleaved=False)
        return [[[round(x, 7), round(y, 7)] for x, y in ring.coords[:-1]] for ring in (gps.exterior, *gps.interiors)]

    output = {
        "source": config["source"],
        "anchorCount": len(errors),
        "anchorRmsM": round(float(np.sqrt(np.mean(errors ** 2))), 1),
        "walkSurfaces": [rings(area) for area in polygons(walks) if area.area >= 3],
        "greenery": [{"category": category, "rings": rings(area)} for category, rows in config["greenery"].items()
                     for row in rows for area in polygons(Polygon(from_pixels(row)).intersection(plantable)) if area.area >= 3],
    }
    if not output["walkSurfaces"] or not output["greenery"]:
        parser.error("Plan does not yield walkable or plantable surfaces in the complex")
    (tour / "landscape.json").write_text(json.dumps(output, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f'{len(output["walkSurfaces"])} walk surfaces, {len(output["greenery"])} planted surfaces, '
          f'{output["anchorRmsM"]} m anchor RMS error')


if __name__ == "__main__":
    main()
