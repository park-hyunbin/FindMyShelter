"""Attach surveyed T-GIS islands to their verified ground or elevated surface."""

import argparse
from collections import Counter
from contextlib import closing
import json
from pathlib import Path
import sqlite3

from shapely import STRtree, make_valid, union_all
from shapely.geometry import box

from collect_seoul_tgis_wfs import EPSG, MAP
from extract_seoul_road_window import TO_METRES
from index_seoul_road_markings import snapshot_features
from prepare_neighborhood_pavement import export_polygons
from prepare_seoul_current_crosswalks import digest, local_polygon
from prepare_songpa_road_markings import REGIONS


LAYER = "C080_A"
KINDS = {"2": "traffic-island", "3": "median"}
MIN_DECK_COVERAGE = 0.99


def export_pedestrian_islands(pavement, markings, known_islands, candidates, index, source):
    pavement.pop("pedestrianIslands", None)
    crossings = markings.get("currentCrosswalks") or {}
    dataset = pavement["roadDataset"]
    if dataset != markings.get("roadDataset") or dataset["sha256"] != crossings.get("sha256"):
        return 0
    window = box(*TO_METRES.transform_bounds(*dataset["bounds"]))
    current = crossings["records"]
    outlines = STRtree([local_polygon([record["outline"]]) for record in current])
    roads = union_all([local_polygon(rings) for rings in pavement["roads"]])
    already_represented = union_all([local_polygon(rings) for rings in pavement["sidewalks"] + known_islands])
    elevated = union_all([local_polygon(rings) for deck in pavement.get("elevatedRoads", [])
                          for rings in deck["polygons"]])
    records = []
    for i in sorted(index.query(window, predicate="contains")):
        management_id, island = candidates[i]
        if island.area < 0.05 or island.intersection(roads).area < island.area * 0.99:
            continue
        if island.intersection(already_represented).area + island.intersection(elevated).area > 0.05:
            continue
        landings = []
        for j in outlines.query(island, predicate="dwithin", distance=0.6):
            crossing = outlines.geometries[j]
            if island.intersection(crossing).area <= crossing.area * 0.15:
                landings.append(current[j]["id"])
        polygons = export_polygons(island)
        if landings and polygons:
            records.append({"managementId": management_id, "crossingIds": sorted(landings), "polygons": polygons})
    if records:
        pavement["pedestrianIslands"] = {**source, "records": records}
    return len(records)


def export_window(pavement, candidates, index, source):
    pavement.pop("elevatedDividerSource", None)
    decks = pavement.get("elevatedRoads", [])
    for deck in decks:
        deck.pop("dividers", None)
    if not decks:
        return {}

    window = box(*TO_METRES.transform_bounds(*pavement["roadDataset"]["bounds"]))
    outlines = [union_all([local_polygon(rings) for rings in deck["polygons"]]) for deck in decks]
    deck_index = STRtree(outlines)
    ground = union_all([local_polygon(rings) for kind in ("roads", "sidewalks") for rings in pavement[kind]])
    counts = Counter()
    for i in sorted(index.query(window, predicate="intersects")):
        management_id, kind, shape = candidates[i]
        outline = shape.intersection(window)
        area = outline.area
        if area < 0.05:
            continue
        overlaps = [(j, outline.intersection(outlines[j])) for j in deck_index.query(outline, predicate="intersects")]
        supported = [(j, overlap) for j, overlap in overlaps if overlap.area > max(0.05, area * 0.01)]
        if not supported:
            continue
        if len(supported) != 1 or supported[0][1].area < area * MIN_DECK_COVERAGE:
            counts["ambiguous_deck"] += 1
            continue
        if outline.intersection(ground).area > 0.05:
            counts["ground_overlap"] += 1
            continue
        j, overlap = supported[0]
        polygons = export_polygons(overlap)
        if polygons:
            decks[j].setdefault("dividers", []).append({
                "managementId": management_id, "kind": kind, "polygons": polygons,
            })
            counts["dividers"] += 1
    if counts["dividers"]:
        pavement["elevatedDividerSource"] = source
    return dict(counts)


def build(snapshot_path, regions, output):
    with closing(sqlite3.connect(snapshot_path.resolve().as_uri() + "?mode=ro", uri=True)) as snapshot:
        raw, = snapshot.execute("SELECT value FROM metadata WHERE key='report'").fetchone()
        report = json.loads(raw)
        if report["epsg"] != EPSG or not report["layers"].get(LAYER):
            raise ValueError(f"The snapshot must include {LAYER} in EPSG:{EPSG}")
        rows = list(snapshot_features(snapshot, LAYER, "json_extract(properties,'$.VIEW_CDE')='002'"))
    counts = Counter(str(attributes["MGRNU"]) for _, _, attributes, _ in rows if attributes.get("MGRNU"))
    candidates, pedestrian = [], []
    for _, _, attributes, shape in rows:
        identifier = str(attributes.get("MGRNU"))
        kind_code = str(attributes.get("TYPE"))
        kind = KINDS.get(kind_code)
        if kind and counts[identifier] == 1:
            candidates.append((identifier, kind, make_valid(shape)))
        if kind_code == "4" and counts[identifier] == 1:
            pedestrian.append((identifier, make_valid(shape)))
    if not candidates:
        raise ValueError(f"No usable traffic-island records in {LAYER}")
    candidates.sort(key=lambda candidate: candidate[0])
    index = STRtree([shape for _, _, shape in candidates])
    pedestrian.sort(key=lambda candidate: candidate[0])
    pedestrian_index = STRtree([shape for _, shape in pedestrian])
    source = {"url": MAP, "layer": LAYER, "retrievedAt": report["requested_at"], "sha256": digest(snapshot_path)}
    results = {}
    for file in sorted(regions.glob("*/pavement.json")):
        pavement = json.loads(file.read_text(encoding="utf-8"))
        if not pavement.get("roadDataset") or not pavement.get("structureSources"):
            continue
        counts = export_window(pavement, candidates, index, source)
        markings_file = file.with_name("road-markings.json")
        markings = json.loads(markings_file.read_text(encoding="utf-8")) if markings_file.exists() else {}
        signals = file.with_name("pedestrian-signals.json")
        signal_data = json.loads(signals.read_text(encoding="utf-8")) if signals.exists() else {}
        islands = [island["shape"] for island in signal_data.get("islands", [])]
        counts["pedestrian_islands"] = export_pedestrian_islands(pavement, markings, islands, pedestrian, pedestrian_index, source)
        results[file.parent.name] = pavement, counts
    if not results:
        raise ValueError(f"No paired Seoul pavement files with structures in {regions}")
    for region, (data, _) in results.items():
        target = output / region / "pavement.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return {region: counts for region, (_, counts) in results.items()}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("--regions", type=Path, default=REGIONS)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.snapshot, args.regions, args.output), indent=2))
