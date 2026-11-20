"""Extract the two nearest Songpa pilot S-DoT stations from the Seoul source files."""

import argparse
import csv
from datetime import date, datetime, timedelta
import json
from math import isfinite
from pathlib import Path
import xml.etree.ElementTree as ET
from zipfile import ZipFile


STATIONS = ("V02Q1940706", "V02Q1940679")
SAMPLE_MINUTE = 7
NAMESPACES = {"sheet": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
OUTPUT = (
    Path(__file__).resolve().parents[2]
    / "frontend/public/datasets/regions/songpa/ambient.json"
)


def read_locations(path):
    locations = {}
    with ZipFile(path) as book:
        strings = ET.fromstring(book.read("xl/sharedStrings.xml"))
        text = ["".join(s.itertext()) for s in strings]
        sheet = ET.fromstring(book.read("xl/worksheets/sheet1.xml"))
    for row in sheet.findall(".//sheet:row", NAMESPACES):
        cells = {}
        for cell in row.findall("sheet:c", NAMESPACES):
            column = cell.attrib["r"].rstrip("0123456789")
            value = cell.findtext("sheet:v", namespaces=NAMESPACES)
            if value is None:
                continue
            cells[column] = text[int(value)] if cell.get("t") == "s" else value
        if cells.get("B") in STATIONS and cells.get("D") == "W84":
            locations[cells["B"]] = {
                "address": cells["C"].removeprefix("서울특별시 송파구 "),
                "coordinate": [float(cells["F"]), float(cells["E"])],
            }
    if locations.keys() != set(STATIONS):
        raise ValueError("The placement workbook did not contain both WGS84 stations.")
    return locations


def measurement(raw):
    if not raw or not raw.strip():
        return None
    value = float(raw)
    return value if isfinite(value) and value >= 0 else None


def read_measurements(paths, days):
    stations = {serial: {day: [None] * 24 for day in days} for serial in STATIONS}
    revisions = {serial: {} for serial in STATIONS}
    for path in paths:
        with path.open(encoding="cp949", newline="") as source:
            for row in csv.DictReader(source):
                serial = row["시리얼"]
                if serial not in stations:
                    continue
                day_text, _, clock = row["센서 시간"].partition("_")
                stamp = datetime.fromisoformat(f"{day_text}T{clock.replace('-', ':')}")
                day = stamp.date().isoformat()
                if day not in stations[serial]:
                    raise ValueError(f"Unexpected observation date: {day}")
                if (stamp.minute, stamp.second, stamp.microsecond) != (SAMPLE_MINUTE, 0, 0):
                    continue
                # Seoul designates DATA_NO 2 as final for the same sensor and time.
                kind = int(row["데이터구분번호"])
                if kind not in (1, 2):
                    raise ValueError(f"Unexpected observation revision: {kind}")
                revision = (kind, datetime.fromisoformat(row["데이터수집시간"]))
                previous = revisions[serial].get(stamp)
                if previous is not None and revision < previous:
                    continue
                bucket = stations[serial][day]
                reading = [measurement(row["평균 소음"]), measurement(row["평균 조도"])]
                if revision == previous and bucket[stamp.hour] != reading:
                    raise ValueError(f"Conflicting observations for {serial} at {stamp}")
                revisions[serial][stamp] = revision
                bucket[stamp.hour] = reading
    if any(not entries for entries in revisions.values()):
        raise ValueError("A required station is missing all observations.")
    return stations


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("locations", type=Path)
    args.add_argument("observations", type=Path, nargs="+")
    args.add_argument("--start", type=date.fromisoformat, default=date(2026, 11, 2))
    args.add_argument("--weeks", type=int, default=1)
    args = args.parse_args()
    if args.weeks < 1:
        raise ValueError("At least one week is required.")
    days = [(args.start + timedelta(days=offset)).isoformat() for offset in range(7 * args.weeks)]
    locations = read_locations(args.locations)
    observations = read_measurements(args.observations, days)
    result = {
        "start": days[0],
        "end": days[-1],
        "minute": SAMPLE_MINUTE,
        "stations": [
            {"serial": serial, **locations[serial], "days": observations[serial]}
            for serial in STATIONS
        ],
    }
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
