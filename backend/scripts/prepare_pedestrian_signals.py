"""Match public signal inventory and pole coordinates to reviewed crossings."""

import argparse
import csv
import json
from math import dist
from pathlib import Path

from openpyxl import load_workbook
from pyproj import Transformer
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

LOCAL = Transformer.from_crs(4326, 5186, always_xy=True).transform
GPS = Transformer.from_crs(5186, 4326, always_xy=True).transform


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def polygon(rings):
    outer, *holes = [[LOCAL(*point) for point in ring] for ring in rings]
    return Polygon(outer, holes)


def position(xy):
    return [round(value, 9) for value in GPS(*xy)]


def prepare(crossings, pavement, inventory_path, poles_path, district):
    workbook = load_workbook(inventory_path, read_only=True, data_only=True)
    inventory = [
        (row[2], row[3], row[5], row[6], (row[7], row[8]))
        for row in workbook.active.iter_rows(min_row=2, values_only=True)
        if row[1] == district and isinstance(row[7], (int, float)) and isinstance(row[8], (int, float))
    ]
    workbook.close()
    with poles_path.open(encoding="cp949", newline="") as source:
        poles = {
            (float(row["X좌표"]), float(row["Y좌표"]))
            for row in csv.DictReader(source)
            if row["자치구"] == district and row["종류"] == "보행등" and row["X좌표"] and row["Y좌표"]
        }
    landings = unary_union(
        [polygon(rings) for rings in pavement["sidewalks"]]
        + [polygon(island["shape"]) for island in crossings.get("islands", [])]
    )
    records = []
    for crossing in crossings["crossings"]:
        # Assign only an unambiguous inventory point on the same painted footprint.
        footprint = polygon([crossing["outline"]]).buffer(2)
        matches = [row for row in inventory if footprint.covers(Point(row[4]))]
        if len(matches) != 1:
            records.append({"ufid": crossing["ufid"], "installed": None, "heads": []})
            continue
        inventory_id, junction_id, flag, junction, _ = matches[0]
        installed = {"유": True, "무": False}.get(flag)
        record = {"ufid": crossing["ufid"], "inventoryId": inventory_id, "junctionId": junction_id,
                  "junction": junction, "installed": installed, "heads": []}
        records.append(record)
        if not installed:
            continue
        ends = [LOCAL(*crossing[key]) for key in ("start", "end")]
        for index, end in enumerate(ends):
            opposite = ends[1 - index]
            candidates = sorted((dist(end, pole), pole) for pole in poles
                                if dist(end, pole) <= 6 and dist(end, pole) < dist(opposite, pole)
                                and landings.covers(Point(pole)))
            if not candidates or (len(candidates) > 1 and candidates[1][0] - candidates[0][0] < 2):
                continue
            distance, pole = candidates[0]
            record["heads"].append({"coordinate": position(pole), "toward": position(opposite),
                                    "distanceFromCrossingEndM": round(distance, 2)})
        # Place the return-walk view inside the mapped island path, looking back across the crosswalk.
        legs = [
            LineString([LOCAL(*point) for point in leg["coordinates"]])
            for leg in crossings.get("legs", [])
            if leg["surface"] != "unverified" and dist(LOCAL(*leg["coordinates"][0]), ends[-1]) < 3
        ]
        if len(record["heads"]) == 2 and len(legs) == 1 and legs[0].length >= 7:
            observer = legs[0].interpolate(7)
            if landings.covers(observer):
                record["returnView"] = {"position": position(observer.coords[0]), "toward": crossing["start"]}
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("crossings", type=Path, help="Reviewed crossing outlines, ends and pedestrian islands")
    parser.add_argument("pavement", type=Path, help="Modeled sidewalk polygons")
    parser.add_argument("inventory", type=Path, help="Seoul OA-23081 XLSX")
    parser.add_argument("poles", type=Path, help="Seoul OA-22356 CSV")
    parser.add_argument("district")
    parser.add_argument("output", type=Path)
    parser.add_argument("--inventory-date", required=True)
    parser.add_argument("--pole-file-date", required=True)
    args = parser.parse_args()
    result = {
        "inventorySource": "https://data.seoul.go.kr/dataList/OA-23081/F/1/datasetView.do",
        "inventoryRecorded": args.inventory_date,
        "poleSource": "https://data.seoul.go.kr/dataList/OA-22356/F/1/datasetView.do",
        "poleFileUpdated": args.pole_file_date,
        "crossings": prepare(read(args.crossings), read(args.pavement), args.inventory, args.poles, args.district),
    }
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
