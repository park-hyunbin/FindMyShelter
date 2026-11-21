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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("baseline", type=Path, help="Baseline EPSG:5186 marking index")
    parser.add_argument("candidate", type=Path, help="Candidate EPSG:5186 marking index")
    parser.add_argument("--regions", type=Path, default=REGIONS)
    args = parser.parse_args()
    baseline = inspect_windows(args.baseline, args.regions)
    candidate = inspect_windows(args.candidate, args.regions)
    print(json.dumps({"baseline": baseline, "candidate": candidate}, indent=2))


if __name__ == "__main__":
    main()
