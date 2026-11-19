"""Extract mapped street-tree points for the Songpa apartment approaches."""

import argparse
from io import BytesIO
import json
from pathlib import Path
from zipfile import ZipFile

from pyproj import CRS, Transformer
import shapefile

SOURCE = "https://openlab.eseoul.go.kr/qgisplugin/SHP/N1P_D0030000.zip"
LAYER = "N1P_D0030000"
BOUNDS = (127.11650, 37.49753, 127.11823, 37.49892)
OUTPUT = Path(__file__).resolve().parents[2] / "frontend/public/datasets/regions/songpa/street-trees.json"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    args = parser.parse_args()
    trees = []
    with ZipFile(args.archive) as archive:
        crs = CRS.from_wkt(archive.read(f"{LAYER}.prj").decode("ascii"))
        if crs.to_epsg() != 5186:
            raise ValueError(f"Expected EPSG:5186 for {LAYER}")
        to_gps = Transformer.from_crs(crs, 4326, always_xy=True)
        projected_bounds = Transformer.from_crs(4326, crs, always_xy=True).transform_bounds(*BOUNDS)
        shape_name = f"{LAYER}.shp"
        year, month, day, *_ = archive.getinfo(shape_name).date_time
        with archive.open(f"{LAYER}.dbf") as dbf, shapefile.Reader(
            shp=BytesIO(archive.read(shape_name)), shx=BytesIO(archive.read(f"{LAYER}.shx")),
            dbf=dbf, encoding="cp949",
        ) as source:
            for feature in source.iterShapes(bbox=projected_bounds):
                longitude, latitude = to_gps.transform(*feature.points[0])
                if not (BOUNDS[0] <= longitude <= BOUNDS[2] and BOUNDS[1] <= latitude <= BOUNDS[3]):
                    continue
                record = source.record(feature.oid, fields=["UFID", "구분"])
                if record["구분"] == "가로수":
                    trees.append({"id": record["UFID"], "coordinate": [round(longitude, 7), round(latitude, 7)]})
    result = {"source": SOURCE, "layer": LAYER, "archiveFileDate": f"{year:04}-{month:02}-{day:02}",
              "bounds": BOUNDS, "trees": sorted(trees, key=lambda tree: tree["id"])}
    OUTPUT.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"Extracted {len(trees)} mapped street trees")


if __name__ == "__main__":
    main()
