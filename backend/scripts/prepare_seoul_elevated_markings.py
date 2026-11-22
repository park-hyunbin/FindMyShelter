"""Attach surveyed T-GIS markings to uniquely supported S-Map decks."""

import argparse
from collections import Counter
from contextlib import closing
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sqlite3

import numpy as np
from shapely import STRtree, from_wkb, union_all
from shapely.geometry import LineString
from shapely.ops import substring

from extract_seoul_road_window import TO_METRES
from index_seoul_road_markings import future_installation, snapshot_features
from prepare_neighborhood_pavement import GRID_M, parts
from prepare_seoul_current_crosswalks import digest, local_polygon
from prepare_seoul_lane_windows import lane_item
from prepare_seoul_ramp_lanes import SOURCE as NATIONAL_LINKS_SOURCE
from prepare_songpa_road_markings import REGIONS, lane_style
from reconcile_seoul_marking_links import (
    MISSING, SPACING_M, Network, axis_candidates, load_national_links, sample_spans, select_axes,
)


LAYER = "A058_L"
MIN_DECK_SHARE = 0.98
SAME_PAINT_M = 0.15
SURVEYED_PAINT_CLEARANCE_M = 0.5
WHITE_LANE_KINDS = ("006", "007")
ELEVATED_LINK_KINDS = ("001", "003")


def marking_sources(snapshot, day, level, *, include_white_lanes=False):
    condition = " AND ".join(f"json_extract(properties,'$.{key}')='{value}'" for key, value in (
        ("VIEW_CDE", "002"), ("STAT_CDE", "001"), ("EVE_CDE", level),
    ))
    if level == "001":
        kinds = ("001", *WHITE_LANE_KINDS) if include_white_lanes else ("001",)
        condition += " AND json_extract(properties,'$.A058_KND_CDE') IN (" + ",".join(map(repr, kinds)) + ")"
    for _, identifier, tags, geometry in snapshot_features(snapshot, LAYER, condition):
        kind = tags.get("A058_KND_CDE")
        style = lane_style(kind, tags.get("A058_KND2_CDE"))
        if style is None or future_installation(tags.get("ESB_YMD"), day):
            continue
        for line in parts(geometry, "LineString"):
            if line.length > 0.25:
                yield identifier, tags.get("MGRNU"), kind, style, line


def road_axes(roads, pavement):
    records = {road["id"]: road for road in roads}
    alignments = pavement.get("elevatedAlignment", {}).get("roads", [])
    if all(
        (road := records.get(item["id"])) and road["motor"] and road["bridge"] and not road["unpaved"]
        and road["oneWay"] == item["oneWay"]
        and len(item["coordinates"]) == len(road["coordinates"])
        and item["vertices"] == [[node, *point] for node, point in zip(road["nodeIds"], road["coordinates"], strict=True)]
        for item in alignments
    ):
        adjusted = {item["id"]: item["coordinates"] for item in alignments}
    else:
        adjusted = {}
    axes = {road["id"]: LineString([TO_METRES.transform(*point)
                                   for point in adjusted.get(road["id"], road["coordinates"])])
            for road in roads if road["motor"] and not road["unpaved"] and len(road["coordinates"]) >= 2}
    return ({key: axis for key, axis in axes.items() if records[key]["bridge"]},
            {key: axis for key, axis in axes.items() if not records[key]["bridge"]})


def axis_network(axes):
    return Network(np.array(list(axes.values())), list(axes)) if axes else None


def unambiguous_deck_paint(line, carriageway, outline, elevated, ground):
    # Multiple projected axes are acceptable on the same confirmed deck. A
    # competing ground axis in the footprint makes the source level uncertain.
    _, _, _, points, tangents = sample_spans(np.array([line]), np.zeros(1), np.array([line.length]))
    stop = np.zeros(len(points), dtype=bool)
    upper = select_axes(elevated, points, tangents, np.full(len(points), carriageway, dtype=object), stop,
                        require_projection=True, require_connected=True)
    mark = upper != MISSING
    if ground is not None:
        lower = select_axes(ground, points, tangents, np.full(len(points), outline, dtype=object), stop,
                            require_projection=True, require_connected=True)
        mark &= lower == MISSING
    edges = np.linspace(0, line.length, len(points) + 1)
    transitions = np.flatnonzero(np.diff(np.r_[False, mark, False]))
    for first, last in transitions.reshape(-1, 2):
        if edges[last] - edges[first] > 0.25:
            yield substring(line, edges[first], edges[last])


def supported_deck_sections(original, carriageway, deck, owner, ground, paint, minimum_length):
    for line in parts(original.intersection(carriageway).difference(paint), "LineString"):
        if line.length <= 0.25:
            continue
        for verified in unambiguous_deck_paint(line, carriageway, deck, owner, ground):
            if verified.length >= minimum_length:
                yield verified


def national_deck_sections(line, carriageway, outline, national):
    _, _, _, coordinates, tangents = sample_spans(np.array([line]), np.zeros(1), np.array([line.length]))
    stop = np.zeros(len(coordinates), dtype=bool)
    elevated = np.isin(national.kinds, ELEVATED_LINK_KINDS)
    samples, owners, _, _, _ = axis_candidates(
        national, coordinates, tangents, np.full(len(coordinates), carriageway, dtype=object), stop,
        require_projection=True, require_connected=True, owner_mask=elevated,
    )
    competing, _, _, _, _ = axis_candidates(
        national, coordinates, tangents, np.full(len(coordinates), outline, dtype=object), stop,
        require_projection=True, require_connected=True, owner_mask=~elevated,
    )
    supported = np.zeros(len(coordinates), dtype=bool)
    supported[samples] = True
    supported[competing] = False
    boundaries = np.linspace(0, line.length, len(coordinates) + 1)
    transitions = np.flatnonzero(np.diff(np.r_[False, supported, False]))
    for start, end in transitions.reshape(-1, 2):
        if boundaries[end] - boundaries[start] >= 3 * SPACING_M:
            links = sorted({national.references[owner] for owner in owners[(samples >= start) & (samples < end)]})
            yield substring(line, boundaries[start], boundaries[end]), links


def reassigned_road_markings(road_index, snapshot_sha, road_ufids):
    if not road_ufids:
        return {}
    if road_index is None:
        raise ValueError("Reassigned deck surfaces require the matching T-GIS road index (--road-index)")
    with closing(sqlite3.connect(road_index.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        report = json.loads(db.execute("SELECT value FROM metadata WHERE key='report'").fetchone()[0])
        if report["sources"]["tgis-lanes"]["sha256"] != snapshot_sha:
            raise ValueError("Reassigned deck surfaces require the road index for this T-GIS snapshot")
        result = {}
        for ufid in sorted(road_ufids):
            rows = db.execute("""SELECT t.feature_id,m.management_id,t.kind,m.style,m.geometry,s.start_m,s.end_m
                FROM road r JOIN span s ON s.road_id=r.id JOIN marking m ON m.id=s.marking_id
                JOIN tgis_marking_source t ON t.source_row=m.source_row
                WHERE r.ufid=? AND s.status='single_road' AND t.kind<>'001' AND m.style<>'stop'
                ORDER BY m.id,s.start_m""", (ufid,))
            result[ufid] = [(identifier, management, kind, style, from_wkb(line), start, end)
                            for identifier, management, kind, style, line, start, end in rows]
        return result


def export_window(markings, pavement, snapshot_sha, sources, index, ground_sources, ground_index, roads,
                  reassigned_paint=None, national=None):
    if markings.get("roadDataset") != pavement.get("roadDataset") or (
        pavement.get("roadDataset", {}).get("sha256") != snapshot_sha
    ):
        raise ValueError("Pavement and markings must reference this T-GIS snapshot")
    structure_shas = sorted(source["sha256"] for source in pavement.get("structureSources", []))
    deck_records = {deck["sourceId"]: deck for deck in pavement.get("elevatedRoads", [])}
    decks = {key: union_all([local_polygon(rings) for rings in deck["polygons"]])
             for key, deck in deck_records.items()}
    if decks and not structure_shas:
        raise ValueError("Elevated road boundaries must identify their source archives")
    counts = Counter()
    records = []
    upper, lower = road_axes(roads, pavement)
    ground_network = axis_network(lower)
    ground = union_all([local_polygon(rings) for rings in pavement["roads"]]) if decks else None
    ground_and_walk = union_all([ground, *(local_polygon(rings) for rings in pavement["sidewalks"])]).buffer(
        GRID_M
    ) if decks else None
    for source_id, deck in sorted(decks.items()):
        shared = union_all([other for other_id, other in decks.items()
                            if other_id != source_id and deck.intersects(other)])
        overlap = deck.intersection(shared)
        exclusive = deck.difference(shared)
        central_strokes, explicit_strokes = [], []
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
                explicit_strokes.append(line)
                if kind == "001":
                    central_strokes.append(line)
        surveyed_deck = deck_records[source_id]
        owner = axis_network({key: upper[key] for key in surveyed_deck["roadIds"] if key in upper})
        if owner is None:
            continue
        dividers = union_all([local_polygon(rings) for record in surveyed_deck.get("dividers", [])
                             for rings in record["polygons"]])
        carriageway = exclusive.difference(dividers)
        confirmed_paint = union_all(central_strokes)
        existing_paint = confirmed_paint.buffer(SAME_PAINT_M)
        isolated_carriageway = carriageway.difference(ground_and_walk)
        surveyed_clearance = confirmed_paint.buffer(SURVEYED_PAINT_CLEARANCE_M)
        ground_candidates = sorted(ground_index.query(carriageway, predicate="intersects"))
        published_strokes = explicit_strokes.copy()
        for i in ground_candidates:
            identifier, management, kind, style, original = ground_sources[i]
            if kind != "001":
                continue
            whole = (original.intersection(deck).length >= MIN_DECK_SHARE * original.length
                     and original.intersection(ground).length <= GRID_M)
            # A source line may leave the deck at its approach or cross several
            # separately surveyed decks. Verify each isolated carriageway section.
            surface = carriageway if whole else isolated_carriageway
            clearance = existing_paint if whole else surveyed_clearance
            minimum_length = 0 if whole else 2 * SPACING_M
            for verified in supported_deck_sections(original, surface, deck, owner, ground_network, clearance,
                                                    minimum_length):
                item = lane_item(verified, original, style, kind)
                item.update(deckId=source_id, featureId=identifier, managementId=management, sourceLevel="001")
                records.append(item)
                published_strokes.append(verified)
                counts["length_m"] += verified.length
                counts["inferred_deck_m"] += verified.length
                if not whole:
                    counts["section_inferred_m"] += verified.length
        ufids = surveyed_deck.get("surveyedRoadUFIDs", [])
        if ufids:
            clearance = union_all(explicit_strokes).buffer(SAME_PAINT_M)
            for ufid in ufids:
                for identifier, management, kind, style, original, start, end in reassigned_paint[ufid]:
                    span = substring(original, start, end)
                    for verified in supported_deck_sections(span, isolated_carriageway, deck, owner, ground_network,
                                                            clearance, 0.25):
                        item = lane_item(verified, original, style, kind)
                        item.update(deckId=source_id, featureId=identifier, managementId=management, sourceLevel="001")
                        records.append(item)
                        published_strokes.append(verified)
                        counts["length_m"] += verified.length
                        counts["reassigned_deck_m"] += verified.length
        if national is not None:
            clearance = union_all(published_strokes).buffer(SURVEYED_PAINT_CLEARANCE_M)
            for i in ground_candidates:
                identifier, management, kind, style, original = ground_sources[i]
                if kind not in WHITE_LANE_KINDS or style not in ("white", "white-dash"):
                    continue
                for verified in supported_deck_sections(original, isolated_carriageway, deck, owner, ground_network,
                                                        clearance, 3 * SPACING_M):
                    for line, links in national_deck_sections(verified, carriageway, deck, national):
                        item = lane_item(line, original, style, kind, preserve_vertices=True)
                        item.update(deckId=source_id, featureId=identifier, managementId=management, sourceLevel="001",
                                    nationalLinkIds=links)
                        records.append(item)
                        clearance = clearance.union(line.buffer(SURVEYED_PAINT_CLEARANCE_M))
                        counts["length_m"] += line.length
                        counts["corroborated_white_m"] += line.length
    # A rerun must remove a deck whose source or boundary has ceased to support it.
    markings.pop("elevatedMarkings", None)
    if records:
        markings["elevatedMarkings"] = {"sha256": snapshot_sha, "structureShas": structure_shas, "records": records}
    return {"records": len(records), "features": len({item["featureId"] for item in records}),
            **{key: round(value, 2) for key, value in counts.items()}}


def build(snapshot_path, regions, output, road_index=None, national_links=None):
    snapshot_sha = digest(snapshot_path)
    with closing(sqlite3.connect(snapshot_path.resolve().as_uri() + "?mode=ro", uri=True)) as snapshot:
        raw, = snapshot.execute("SELECT value FROM metadata WHERE key='report'").fetchone()
        report = json.loads(raw)
        if report["epsg"] != 5186 or not report["layers"].get(LAYER):
            raise ValueError("T-GIS snapshot requires the A058_L marking layer in EPSG:5186")
        day = datetime.fromisoformat(report["requested_at"]).astimezone(timezone(timedelta(hours=9))).date()
        sources = list(marking_sources(snapshot, day, "002"))
        ground_sources = list(marking_sources(snapshot, day, "001", include_white_lanes=national_links is not None))
    national = load_national_links(national_links, report["bounds"]) if national_links else None
    national_source = {"url": NATIONAL_LINKS_SOURCE, "sha256": digest(national_links)} if national_links else None
    index = STRtree([line for *_, line in sources])
    ground_index = STRtree([line for *_, line in ground_sources])
    inputs = [(file, json.loads(file.with_name("pavement.json").read_text(encoding="utf-8")))
              for file in sorted(regions.glob("*/road-markings.json"))]
    reassigned_paint = reassigned_road_markings(road_index, snapshot_sha, {
        ufid for _, pavement in inputs for deck in pavement.get("elevatedRoads", [])
        for ufid in deck.get("surveyedRoadUFIDs", [])
    })
    results = {}
    for file, pavement in inputs:
        markings = json.loads(file.read_text(encoding="utf-8"))
        roads = []
        if pavement.get("elevatedRoads"):
            site = json.loads(file.with_name("site.geojson").read_text(encoding="utf-8"))
            neighborhood = site.get("metadata", {}).get("neighborhood")
            streets = regions.parent / "neighborhoods" / neighborhood if neighborhood else file.parent
            roads = json.loads((streets / "streets.json").read_text(encoding="utf-8"))["roads"]
        counts = export_window(markings, pavement, snapshot_sha, sources, index, ground_sources, ground_index, roads,
                               reassigned_paint, national)
        if counts.get("corroborated_white_m"):
            markings["elevatedMarkings"]["nationalLinks"] = national_source
        results[file.parent.name] = markings, counts
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
    parser.add_argument("--road-index", type=Path, help="Matching T-GIS index for reclassified deck surfaces")
    parser.add_argument("--national-links", type=Path, help="Standard node-link archive for corroborating white deck paint")
    args = parser.parse_args()
    print(json.dumps(build(args.snapshot, args.regions, args.output, args.road_index, args.national_links), indent=2))
