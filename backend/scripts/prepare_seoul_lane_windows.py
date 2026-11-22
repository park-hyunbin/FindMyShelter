"""Refresh tour lane layers from one Seoul-wide marking index."""

import argparse
from collections import Counter
from contextlib import closing
import json
from pathlib import Path
import sqlite3
from tempfile import NamedTemporaryFile

from shapely import from_wkb
from shapely.geometry import Point, box

from audit_seoul_road_sources import layer_metadata, open_layer
from extract_seoul_road_window import bounds_parameters
from prepare_neighborhood_pavement import parts
from prepare_songpa_road_markings import BOUNDS, BUS_KINDS, EDGE_KINDS, LANES, REGIONS, TO_METERS, gps


BUS_LANES = "https://data.seoul.go.kr/dataList/OA-22396/F/1/datasetView.do"
SOURCES = {"lanes": LANES, "bus-lanes": BUS_LANES}
EXISTING_BOUNDS = {
    "songpa": BOUNDS,
    "jamsil-leel": (127.1004, 37.5118, 127.114, 37.523),
    "seoul-a13822004": (127.071, 37.505, 127.092, 37.524),
    "seoul-a13880407": (127.106, 37.487, 127.126, 37.505),
}


def region_bounds(region, existing, datasets):
    if "laneBounds" in existing:
        return tuple(existing["laneBounds"])
    if region in EXISTING_BOUNDS:
        return EXISTING_BOUNDS[region]
    manifest = datasets / "buildings" / region / "manifest.json"
    longitude, latitude = json.loads(manifest.read_text(encoding="utf-8"))["metadata"]["center_lnglat"]
    return longitude - 0.009, latitude - 0.0075, longitude + 0.009, latitude + 0.0075


def lane_kinds(directory, indexed_sources):
    rows = {}
    for source, metadata in indexed_sources.items():
        if layer_metadata(directory, source) != metadata:
            raise ValueError(f"{source} archive differs from the city index source")
        with open_layer(directory, source, attributes=True, read_shapes=False) as reader:
            rows[source] = {row.oid: row["A058_KND_C"] for row in reader.iterRecords(fields=["A058_KND_C"])
                            if row["A058_KND_C"] in EDGE_KINDS | BUS_KINDS}
    return rows


def extract_lanes(db, bounds, kinds):
    west, south, east, north = bounds
    if not (-180 <= west < east <= 180 and -90 < south < north < 90):
        raise ValueError(f"Invalid lane clip bounds: {bounds}")
    window = box(*TO_METERS.transform_bounds(*bounds))
    query = """SELECT m.source,m.source_row,m.style,m.management_id,m.geometry
        FROM marking_bounds b JOIN marking m ON m.id=b.id
        WHERE b.min_x<=? AND b.max_x>=? AND b.min_y<=? AND b.max_y>=?
        ORDER BY m.source DESC,m.source_row,m.part"""
    for source, row_id, style, management, geometry in db.execute(query, bounds_parameters(window)):
        original = from_wkb(geometry)
        for line in parts(original.intersection(window), "LineString"):
            if line.length <= 0.25:
                continue
            kind = kinds[source].get(row_id)
            item = lane_item(line, original, style, kind)
            if source != "lanes":
                item["source"] = source
                item["managementId"] = management
            yield item


def lane_item(line, original, style, kind):
    dashed = style.endswith("-dash") or "-combined" in style
    if dashed:
        begin = original.project(Point(line.coords[0]))
        end = original.project(Point(line.coords[-1]))
        if end < begin:
            line = line.reverse()
            begin = end
    item = {"style": style, "points": gps(line.simplify(0.11).coords)}
    if dashed and begin > 0.001:
        item["dashOffsetM"] = round(begin, 3)
    if kind in EDGE_KINDS:
        item["edge"] = True
    if kind in BUS_KINDS:
        item["busLane"] = True
    return item


def signatures(lanes):
    return Counter((lane["style"], bool(lane.get("edge")), bool(lane.get("busLane")), tuple(map(tuple, lane["points"])))
                   for lane in lanes)


def render_windows(directory, index, regions, output):
    with closing(sqlite3.connect(index.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        report = json.loads(db.execute("SELECT value FROM metadata WHERE key='report'").fetchone()[0])
        if report["epsg"] != 5186:
            raise ValueError("Unexpected marking index coordinate system")
        indexed_sources = {name: report["sources"][name] for name in SOURCES if name in report["sources"]}
        kinds = lane_kinds(directory, indexed_sources)
        versions = {name: {"url": SOURCES[name], "archiveDate": metadata["shape_index_date"], "sha256": metadata["sha256"]}
                    for name, metadata in indexed_sources.items()}
        files = sorted(regions.glob("*/road-markings.json"))
        if not files:
            raise ValueError(f"No published road-markings files in {regions}")
        results = {}
        summary = {}
        for file in files:
            region = file.parent.name
            current = json.loads(file.read_text(encoding="utf-8"))
            bounds = region_bounds(region, current, regions.parent)
            lanes = list(extract_lanes(db, bounds, kinds))
            if not lanes:
                raise ValueError(f"No matching lane geometry for {region}")
            previous, updated = signatures(current["lanes"]), signatures(lanes)
            summary[region] = {
                "recordsBefore": len(current["lanes"]), "recordsAfter": len(lanes),
                "displayRecordsRemoved": (previous - updated).total(), "displayRecordsAdded": (updated - previous).total(),
                "busFeatures": sum(lane.get("source") == "bus-lanes" for lane in lanes),
            }
            current.update(lanes=lanes, laneBounds=bounds, laneSources=versions,
                           markingsArchiveDate=versions["lanes"]["archiveDate"])
            results[output / region / file.name] = current
    for file, data in results.items():
        file.parent.mkdir(parents=True, exist_ok=True)
        stream = NamedTemporaryFile(dir=file.parent, prefix=file.name + ".", suffix=".part",
                                    mode="w", encoding="utf-8", newline="\n", delete=False)
        temporary = Path(stream.name)
        try:
            with stream:
                json.dump(data, stream, separators=(",", ":"))
                stream.write("\n")
            temporary.replace(file)
        finally:
            temporary.unlink(missing_ok=True)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path, help="Source ZIP cache used to build the index")
    parser.add_argument("index", type=Path, help="Citywide SQLite marking index")
    parser.add_argument("--output", type=Path, default=REGIONS, help="Destination regions directory")
    args = parser.parse_args()
    print(json.dumps(render_windows(args.directory, args.index, REGIONS, args.output), indent=2))


if __name__ == "__main__":
    main()
