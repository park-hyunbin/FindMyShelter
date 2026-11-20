"""Match the 2026 Seoul street tree inventory to the Songpa tour's surveyed surfaces."""

import argparse
import json
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from pyproj import Transformer
from shapely import transform
from shapely.geometry import Point, Polygon, shape
from shapely.ops import unary_union

DATA = Path(__file__).resolve().parents[2] / "frontend/public/datasets/regions/songpa"
SOURCE = "https://data.seoul.go.kr/dataList/OA-23040/S/1/datasetView.do"
MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
RELATIONSHIP = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
PROJECTION = Transformer.from_crs(4326, 5186, always_xy=True).transform
MATCH_M = 4.5


def load(filename):
    return json.loads((DATA / filename).read_text(encoding="utf-8"))


def local(geometry):
    return transform(geometry, PROJECTION, interleaved=False)


def inventory_rows(filename):
    with ZipFile(filename) as workbook:
        book = ET.fromstring(workbook.read("xl/workbook.xml"))
        sheet = next(s for s in book.find(MAIN + "sheets") if s.get("name") == "송파구")
        rels = ET.fromstring(workbook.read("xl/_rels/workbook.xml.rels"))
        target = next(r.get("Target") for r in rels if r.get("Id") == sheet.get(RELATIONSHIP))
        sheet_path = target.lstrip("/") if target.startswith("/") else str(PurePosixPath("xl") / target)
        with workbook.open("xl/sharedStrings.xml") as source:
            strings = ["".join(i.itertext()) for i in ET.parse(source).getroot()]

        with workbook.open(sheet_path) as source:
            for _, row in ET.iterparse(source, events=("end",)):
                if row.tag != MAIN + "row":
                    continue
                number = int(row.get("r"))
                fields = {}
                for cell in row:
                    value = cell.findtext(MAIN + "v")
                    if value is not None:
                        fields[cell.get("r").rstrip("0123456789")] = strings[int(value)] if cell.get("t") == "s" else value
                row.clear()
                if number == 3 and [fields.get(column) for column in "BCFG"] != ["노선", "수종", "좌표(경도)", "좌표(위도)"]:
                    raise ValueError("Review the columns in the Seoul street tree workbook")
                if number < 4 or not fields.get("C") or fields["C"] == "공분":
                    continue
                try:
                    longitude, latitude = float(fields["F"]), float(fields["G"])
                except (KeyError, ValueError):
                    continue
                yield {"row": number, "route": fields["B"], "species": fields["C"], "coordinate": [longitude, latitude]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path)
    args = parser.parse_args()
    masks = load("pavement.json")
    walks = unary_union([local(Polygon(rings[0], rings[1:])) for rings in masks["sidewalks"]])
    road = unary_union([local(Polygon(rings[0], rings[1:])) for rings in masks["roads"]])
    boundary = local(shape(load("site.geojson")["features"][0]["geometry"]))
    scope = boundary.buffer(masks["radiusM"])
    gate = Point(*PROJECTION(127.11690, 37.49778))
    surveyed = [(r, Point(*PROJECTION(*r["coordinate"]))) for r in load("street-trees.json")["trees"]]
    rows = []
    for row in inventory_rows(args.workbook):
        loc = Point(*PROJECTION(*row["coordinate"]))
        if scope.covers(loc):
            rows.append((row, loc))
    if not rows:
        raise ValueError("No trees match the Songpa pavement coverage")

    matches = {}
    for survey, position in surveyed:
        tree, loc = min(rows, key=lambda item: position.distance(item[1]))
        distance = position.distance(loc)
        nearest_survey, _ = min(surveyed, key=lambda item: loc.distance(item[1]))
        if nearest_survey == survey and distance <= MATCH_M:
            matches[survey["id"]] = {"row": tree["row"], "species": tree["species"], "differenceM": round(distance, 2)}

    sidewalks, entrance = [], []
    for tree, loc in rows:
        if tree["route"] == "송파대로32길" and loc.distance(gate) <= 65:
            entrance.append(tree)
        if min(loc.distance(point) for _, point in surveyed) <= MATCH_M:
            continue
        if walks.covers(loc) and loc.distance(walks.boundary) >= 0.23 and loc.distance(road) >= 0.23:
            sidewalks.append(tree)

    data = {"source": SOURCE, "published": "2026-09-30", "sheet": "송파구",
            "surveyMatches": matches, "sidewalkTrees": sidewalks, "entranceContext": entrance}
    (DATA / "street-tree-inventory.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{len(matches)} survey matches, {len(sidewalks)} additional sidewalk points, {len(entrance)} entrance records")


if __name__ == "__main__":
    main()
