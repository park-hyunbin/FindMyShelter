"""Compare the marking-to-pavement fit in every published Seoul scene window."""

import argparse
from collections import Counter
from contextlib import closing
import json
from pathlib import Path
import sqlite3

from shapely.geometry import box

from extract_seoul_road_window import TO_METRES, marking_lines
from prepare_seoul_lane_windows import region_bounds
from prepare_songpa_road_markings import REGIONS


def inspect_windows(index, regions):
    windows = sorted(regions.glob("*/road-markings.json"))
    if not windows:
        raise ValueError(f"No published marking windows in {regions}")
    report = {}
    with closing(sqlite3.connect(index.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        metadata = json.loads(db.execute("SELECT value FROM metadata WHERE key='report'").fetchone()[0])
        if metadata["epsg"] != 5186:
            raise ValueError("Unexpected coordinate reference system")
        for path in windows:
            current = json.loads(path.read_text(encoding="utf-8"))
            region = path.parent.name
            bounds = region_bounds(region, current, regions.parent)
            window = box(*TO_METRES.transform_bounds(*bounds))
            totals = Counter()
            for line, _, _, _, status, _ in marking_lines(db, window):
                totals[status] += line.length
            length = totals.total()
            if not length:
                raise ValueError(f"No indexed markings in {region} {bounds}")
            report[region] = {
                "bounds": bounds, "length_m": round(length, 3),
                "single_road_share": round(totals["single_road"] / length, 6),
                "by_status_m": {status: round(metres, 3) for status, metres in sorted(totals.items())},
            }
    return {"sources": metadata["sources"], "scenes": report}


def compare_identical_markings(baseline, candidate):
    with closing(sqlite3.connect(candidate.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        db.execute("ATTACH DATABASE ? AS baseline", (baseline.resolve().as_uri() + "?mode=ro",))
        # Only use unique management numbers with identical style and line geometry.
        # This keeps changes to the marking inventory out of the surface comparison.
        db.execute("""CREATE TEMP TABLE shared AS
            WITH old_ids AS (
                SELECT min(id) id, management_id FROM baseline.marking
                WHERE management_id<>'' GROUP BY management_id HAVING count(*)=1
            ), new_ids AS (
                SELECT min(id) id, management_id FROM main.marking
                WHERE management_id<>'' GROUP BY management_id HAVING count(*)=1
            )
            SELECT old.id old_id, new.id new_id FROM old_ids JOIN new_ids USING(management_id)
            JOIN baseline.marking old ON old.id=old_ids.id JOIN main.marking new ON new.id=new_ids.id
            WHERE old.style=new.style AND old.geometry=new.geometry
        """)
        records = db.execute("SELECT count(*) FROM shared").fetchone()[0]
        report = {"records": records}
        for name, schema, reference in (("baseline", "baseline", "old_id"), ("candidate", "main", "new_id")):
            total, matched = db.execute(f"""SELECT sum(end_m-start_m),
                sum(CASE WHEN status='single_road' THEN end_m-start_m ELSE 0 END)
                FROM shared JOIN {schema}.span ON marking_id={reference}""").fetchone()
            report[name] = {"length_m": total, "single_road_m": matched}
        return report


def ground_centerline_inventory(index):
    with closing(sqlite3.connect(index.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        if db.execute("SELECT 1 FROM sqlite_schema WHERE name='tgis_marking_source'").fetchone() is None:
            return None
        rows = db.execute("""SELECT m.district, s.status, count(DISTINCT m.id), sum(s.end_m-s.start_m)
            FROM tgis_marking_source t JOIN marking m ON m.source_row=t.source_row
            JOIN span s ON s.marking_id=m.id WHERE t.kind='001' AND m.source='tgis-lanes'
            GROUP BY m.district,s.status ORDER BY m.district,s.status""")
        districts = {}
        for district, status, records, length in rows:
            districts.setdefault(district, {})[status] = {"records": records, "length_m": round(length, 3)}
        unique, = db.execute("""SELECT count(DISTINCT m.management_id) FROM tgis_marking_source t
            JOIN marking m ON m.source_row=t.source_row WHERE t.kind='001'
            AND m.source='tgis-lanes' AND m.management_id<>''""").fetchone()
        return {"unique_management_ids": unique, "districts": districts}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("baseline", type=Path, help="Baseline EPSG:5186 marking index")
    parser.add_argument("candidate", type=Path, help="Candidate EPSG:5186 marking index")
    parser.add_argument("--regions", type=Path, default=REGIONS)
    args = parser.parse_args()
    report = {
        "baseline": inspect_windows(args.baseline, args.regions),
        "candidate": inspect_windows(args.candidate, args.regions),
        "identical_markings": compare_identical_markings(args.baseline, args.candidate),
    }
    centerlines = ground_centerline_inventory(args.candidate)
    if centerlines is not None:
        report["ground_centerlines"] = centerlines
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
