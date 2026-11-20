"""Build the tree cover and visible paved surfaces east of Garak Intersection."""

import argparse
import json
from pathlib import Path
from xml.etree import ElementTree
from zipfile import ZipFile

from pyproj import CRS, Transformer
import shapefile
from shapely import make_valid, set_precision, transform
from shapely.geometry import LineString, Point, Polygon, shape
from shapely.ops import unary_union

from prepare_neighborhood_pavement import DATA, TO_METRES, export_polygons, parts

PARK_WAY = "1459206578"
PARK_PATHS = ("374903872", "374903885")
PLANNING_IDS = ("11000UQ153PS201912150105", "11710UQ153PS202409030002")
PLANNING_SOURCE = "https://data.seoul.go.kr/dataList/OA-21129/F/1/datasetView.do"
IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer"
ANCHOR = (127.1154600, 37.4977700)
GRID_M = 0.005

# Boundaries of visible cover and paving traced from the 2025-10-28 orthophoto.
# The park and pavement sources below limit the footprint of every traced patch.
CANOPY = [
    [
        (127.1152121, 37.4979994), (127.1152711, 37.4980632), (127.1153703, 37.4981271),
        (127.1154615, 37.4981207), (127.1155152, 37.4980675), (127.1155339, 37.4980185),
        (127.1155125, 37.4979526), (127.1154320, 37.4979164), (127.1153542, 37.4979568),
        (127.1152952, 37.4980100), (127.1152255, 37.4979568),
    ],
    [
        (127.1156198, 37.4982164), (127.1156842, 37.4982739), (127.1157458, 37.4983313),
        (127.1158263, 37.4983718), (127.1158880, 37.4983569), (127.1159175, 37.4982973),
        (127.1158987, 37.4982356), (127.1158370, 37.4981568), (127.1157700, 37.4981036),
        (127.1156949, 37.4980483), (127.1156251, 37.4980994),
    ],
    [
        (127.1152309, 37.4978781), (127.1152791, 37.4979270), (127.1153516, 37.4978972),
        (127.1153972, 37.4978802), (127.1154428, 37.4978930), (127.1155232, 37.4978738),
        (127.1155930, 37.4978228), (127.1156225, 37.4977398), (127.1156064, 37.4976695),
        (127.1155795, 37.4976100), (127.1155393, 37.4975738), (127.1155125, 37.4975014),
        (127.1154240, 37.4974780), (127.1153435, 37.4975291), (127.1152899, 37.4975951),
        (127.1152309, 37.4976440), (127.1152067, 37.4977121),
    ],
    [
        (127.1148929, 37.4974759), (127.1149439, 37.4975333), (127.1150163, 37.4975270),
        (127.1151182, 37.4975036), (127.1151987, 37.4975312), (127.1152845, 37.4975121),
        (127.1153381, 37.4974567), (127.1153703, 37.4973801), (127.1153274, 37.4973056),
        (127.1152577, 37.4972822), (127.1152711, 37.4972163), (127.1152523, 37.4971248),
        (127.1151960, 37.4970843), (127.1151316, 37.4970737), (127.1150672, 37.4970184),
        (127.1149868, 37.4970035), (127.1149975, 37.4971354), (127.1149305, 37.4972461),
    ],
    [
        (127.1156171, 37.4979781), (127.1156842, 37.4980270), (127.1157888, 37.4980781),
        (127.1158719, 37.4980845), (127.1159282, 37.4980270), (127.1159336, 37.4979462),
        (127.1158987, 37.4978717), (127.1158773, 37.4977781), (127.1158209, 37.4977270),
        (127.1157271, 37.4976355), (127.1156761, 37.4975419), (127.1156144, 37.4974759),
        (127.1155474, 37.4974184), (127.1154857, 37.4974440), (127.1155125, 37.4975419),
        (127.1155581, 37.4976248), (127.1156064, 37.4976887), (127.1156251, 37.4977525),
        (127.1156064, 37.4978291),
    ],
    [
        (127.1152791, 37.4970226), (127.1153516, 37.4971014), (127.1154079, 37.4971375),
        (127.1154132, 37.4972354), (127.1154508, 37.4973163), (127.1155071, 37.4973908),
        (127.1155903, 37.4974312), (127.1156520, 37.4974716), (127.1157163, 37.4974738),
        (127.1157593, 37.4974099), (127.1157271, 37.4973099), (127.1156815, 37.4972269),
        (127.1156064, 37.4971184), (127.1155420, 37.4970247), (127.1154428, 37.4969034),
        (127.1153542, 37.4968439), (127.1152818, 37.4968141), (127.1152443, 37.4968737),
    ],
]
CLEARINGS = [
    [
        (127.1150056, 37.4978760), (127.1150726, 37.4978951), (127.1151263, 37.4978972),
        (127.1151853, 37.4978781), (127.1152201, 37.4978334), (127.1152148, 37.4977908),
        (127.1151906, 37.4977483), (127.1151960, 37.4976929), (127.1152067, 37.4976589),
        (127.1151799, 37.4976291), (127.1151423, 37.4975844), (127.1151048, 37.4975376),
        (127.1150512, 37.4975121), (127.1149948, 37.4974950), (127.1149546, 37.4975121),
        (127.1149385, 37.4975504), (127.1149546, 37.4975844), (127.1149680, 37.4976270),
        (127.1149573, 37.4976568), (127.1149224, 37.4976610), (127.1149090, 37.4976802),
        (127.1149465, 37.4977057), (127.1149760, 37.4977547), (127.1149787, 37.4978100),
    ],
    [
        (127.1151799, 37.4978972), (127.1151718, 37.4979270), (127.1151960, 37.4979504),
        (127.1152443, 37.4979526), (127.1152872, 37.4979292), (127.1152684, 37.4979100),
        (127.1152282, 37.4979270), (127.1152067, 37.4979164), (127.1152121, 37.4978781),
    ],
]
CROWNS = [
    (127.1153247, 37.4980419), (127.1154669, 37.4980356), (127.1154884, 37.4979568),
    (127.1157458, 37.4982292), (127.1157968, 37.4981781), (127.1154884, 37.4978228),
    (127.1153623, 37.4977887), (127.1153274, 37.4977057), (127.1154803, 37.4977121),
    (127.1153247, 37.4976036), (127.1153998, 37.4975333), (127.1150565, 37.4974248),
    (127.1150807, 37.4973503), (127.1151584, 37.4972886), (127.1151236, 37.4971843),
    (127.1151316, 37.4971035), (127.1153167, 37.4974504), (127.1152684, 37.4974610),
    (127.1155447, 37.4972141), (127.1155339, 37.4971524), (127.1154803, 37.4970865),
    (127.1154320, 37.4970545), (127.1156868, 37.4978334), (127.1157324, 37.4979568),
]


def local_ring(coordinates):
    return Polygon([TO_METRES(*p) for p in coordinates])


def planning_shapes(path):
    with ZipFile(path) as archive:
        files = {Path(name).suffix: name for name in archive.namelist() if Path(name).name.startswith("UPIS_C_UQ153.")}
        crs = CRS.from_wkt(archive.read(files[".prj"]).decode("ascii"))
        if crs.to_epsg() != 5174:
            raise ValueError("Expected EPSG:5174 for Seoul's planning polygons")
        local = Transformer.from_crs(crs, 5186, always_xy=True).transform
        with shapefile.Reader(shp=archive.open(files[".shp"]), shx=archive.open(files[".shx"]),
                              dbf=archive.open(files[".dbf"]), encoding="cp949") as reader:
            records = {
                item.record["PRESENT_SN"]: (item.record["DGM_NM"],
                                            transform(make_valid(shape(item.shape.__geo_interface__)), local, interleaved=False))
                for item in reader.iterShapeRecords(fields=["PRESENT_SN", "DGM_NM"])
                if item.record["PRESENT_SN"] in PLANNING_IDS
            }
    if set(records) != set(PLANNING_IDS):
        raise ValueError("Expected matching planning records for Garak Plaza and the adjacent green buffer")
    return records


def read_osm(path):
    root = ElementTree.parse(path).getroot()
    nodes = {node.get("id"): (float(node.get("lon")), float(node.get("lat"))) for node in root.iter("node")}
    ways = {
        way.get("id"): [nodes[ref.get("ref")] for ref in way.iter("nd")]
        for way in root.iter("way") if way.get("id") in (PARK_WAY, *PARK_PATHS)
    }
    if set(ways) != {PARK_WAY, *PARK_PATHS}:
        raise ValueError("Expected the park outline and both mapped footways")
    return ways


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("osm", type=Path)
    parser.add_argument("planning", type=Path)
    args = parser.parse_args()
    folder = DATA / "songpa"
    ways = read_osm(args.osm)
    park = set_precision(local_ring(ways[PARK_WAY]), GRID_M)
    plans = planning_shapes(args.planning)
    planned = set_precision(unary_union([area for _, area in plans.values()]), GRID_M)
    boundary = park.intersection(planned)
    if boundary.area < 0.99 * park.area:
        raise ValueError("The mapped park no longer matches the planning boundaries")

    pavement = json.loads((folder / "pavement.json").read_text(encoding="utf-8"))
    city_paving = set_precision(unary_union([
        Polygon([TO_METRES(*p) for p in polygon[0]],
                [[TO_METRES(*p) for p in ring] for ring in polygon[1:]])
        for polygon in pavement["roads"] + pavement["sidewalks"]
    ]), GRID_M)
    usable = boundary.difference(city_paving)
    footways = unary_union([LineString([TO_METRES(*p) for p in ways[key]]) for key in PARK_PATHS])
    clearings = set_precision(unary_union([make_valid(local_ring(ring)) for ring in CLEARINGS]), GRID_M).intersection(usable)
    if any(polygon.interiors for polygon in parts(clearings, "Polygon")):
        raise ValueError("The reviewed paving must have simple outer boundaries")
    green = usable.difference(clearings)
    canopy = set_precision(unary_union([make_valid(local_ring(ring)) for ring in CANOPY]), GRID_M)
    woodland = canopy.intersection(green).difference(set_precision(footways.buffer(1.15), GRID_M))
    crowns = [point for point in CROWNS if woodland.buffer(-0.25).covers(Point(*TO_METRES(*point)))]

    result = {
        "anchor": ANCHOR,
        "source": {
            "planning": PLANNING_SOURCE, "planningMonth": "2026-09",
            "records": [{"id": key, "name": plans[key][0]} for key in PLANNING_IDS],
            "osm": f"https://www.openstreetmap.org/way/{PARK_WAY}",
            "pathWayIds": [int(key) for key in PARK_PATHS],
            "pavement": pavement["sidewalkSource"]["source"],
            "imagery": IMAGERY, "imageryDate": "2025-10-28",
        },
        "cover": [
            {"category": "grass", "shapes": export_polygons(green.difference(woodland))},
            {"category": "wood", "shapes": export_polygons(woodland)},
        ],
        "paving": [polygon[0][:-1] for polygon in export_polygons(clearings)],
        "crowns": crowns,
    }
    (folder / "garak-green-strip.json").write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n",
                                                   encoding="utf-8")
    print(f"{usable.area:.0f} m² site, {woodland.area:.0f} m² canopy, {clearings.area:.0f} m² paving, {len(crowns)} crowns")


if __name__ == "__main__":
    main()
