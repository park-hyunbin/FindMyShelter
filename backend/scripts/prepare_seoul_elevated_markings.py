"""Attach surveyed T-GIS elevated markings to uniquely supported S-Map decks."""

import argparse
from collections import Counter
from contextlib import closing
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sqlite3

from shapely import STRtree, union_all

from index_seoul_road_markings import future_installation, snapshot_features
from prepare_neighborhood_pavement import parts
from prepare_seoul_current_crosswalks import digest, local_polygon
from prepare_seoul_lane_windows import lane_item
from prepare_songpa_road_markings import REGIONS, lane_style


LAYER = "A058_L"


def elevated_sources(snapshot, day):
    condition = " AND ".join(f"json_extract(properties,'$.{key}')='{value}'" for key, value in (
        ("VIEW_CDE", "002"), ("STAT_CDE", "001"), ("EVE_CDE", "002"),
    ))
    for _, identifier, tags, geometry in snapshot_features(snapshot, LAYER, condition):
        kind = tags.get("A058_KND_CDE")
        style = lane_style(kind, tags.get("A058_KND2_CDE"))
        if style is None or future_installation(tags.get("ESB_YMD"), day):
            continue
        for line in parts(geometry, "LineString"):
            if line.length > 0.25:
                yield identifier, tags.get("MGRNU"), kind, style, line


def export_window(markings, pavement, snapshot_sha, sources, index):
    if markings.get("roadDataset") != pavement.get("roadDataset") or (
        pavement.get("roadDataset", {}).get("sha256") != snapshot_sha
    ):
        raise ValueError("Pavement and markings must reference this T-GIS snapshot")
    structure_shas = sorted(source["sha256"] for source in pavement.get("structureSources", []))
    decks = {deck["sourceId"]: union_all([local_polygon(rings) for rings in deck["polygons"]])
             for deck in pavement.get("elevatedRoads", [])}
    if decks and not structure_shas:
        raise ValueError("Elevated road boundaries must identify their source archives")
    counts = Counter()
    records = []
    for source_id, deck in sorted(decks.items()):
        shared = union_all([other for other_id, other in decks.items()
                            if other_id != source_id and deck.intersects(other)])
        overlap = deck.intersection(shared)
        exclusive = deck.difference(shared)
        for i in sorted(index.query(deck, predicate="intersects")):
            identifier, management, kind, style, original = sources[i]
            counts["overlap_m"] += original.intersection(overlap).length
            for line in parts(original.intersection(exclusive), "LineString"):
                if line.length <= 0.25:
                    continue
                item = lane_item(line, original, style, kind)
                item.update(deckId=source_id, featureId=identifier, managementId=management)
                records.append(item)
                counts["length_m"] += line.length
    # A rerun must remove a deck whose source or boundary has ceased to support it.
    markings.pop("elevatedMarkings", None)
    if records:
        markings["elevatedMarkings"] = {"sha256": snapshot_sha, "structureShas": structure_shas, "records": records}
    return {"records": len(records), "features": len({item["featureId"] for item in records}),
            **{key: round(value, 2) for key, value in counts.items()}}


def build(snapshot_path, regions, output):
    snapshot_sha = digest(snapshot_path)
    with closing(sqlite3.connect(snapshot_path.resolve().as_uri() + "?mode=ro", uri=True)) as snapshot:
        raw, = snapshot.execute("SELECT value FROM metadata WHERE key='report'").fetchone()
        report = json.loads(raw)
        if report["epsg"] != 5186 or not report["layers"].get(LAYER):
            raise ValueError("T-GIS snapshot requires the A058_L marking layer in EPSG:5186")
        day = datetime.fromisoformat(report["requested_at"]).astimezone(timezone(timedelta(hours=9))).date()
        sources = list(elevated_sources(snapshot, day))
    index = STRtree([line for *_, line in sources])
    results = {}
    for file in sorted(regions.glob("*/road-markings.json")):
        markings = json.loads(file.read_text(encoding="utf-8"))
        pavement = json.loads(file.with_name("pavement.json").read_text(encoding="utf-8"))
        results[file.parent.name] = markings, export_window(markings, pavement, snapshot_sha, sources, index)
    if not results:
        raise ValueError(f"No Seoul region markings in {regions}")
    for region, (data, _) in results.items():
        target = output / region / "road-markings.json"
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
