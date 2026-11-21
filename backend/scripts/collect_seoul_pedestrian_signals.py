"""Collect Seoul source snapshots and build a region's pedestrian signal layer."""

import argparse
import hashlib
from html import unescape
from io import BytesIO
import json
from pathlib import Path
import re
from tempfile import NamedTemporaryFile
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zipfile import ZipFile

from prepare_pedestrian_signals import CROSSWALK_SOURCE, INVENTORY_SOURCE, ISLAND_LAYER, ISLAND_SOURCE, POLE_SOURCE, make_dataset, read

DOWNLOAD_URL = "https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?useCache=false"
SOURCES = {
    "inventory": (INVENTORY_SOURCE, ".xlsx"),
    "poles": (POLE_SOURCE, ".csv"),
    "crosswalks": (CROSSWALK_SOURCE, ".zip"),
    "islands": (ISLAND_SOURCE, ".zip"),
}


def sha256(content):
    return hashlib.sha256(content).hexdigest()


def write_json(path, value):
    with NamedTemporaryFile(dir=path.parent, suffix=".tmp", delete=False) as output:
        output.write((json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
        temporary = Path(output.name)
    temporary.replace(path)


def request(url, parameters=None):
    form = urlencode(parameters).encode("ascii") if parameters else None
    with urlopen(Request(url, data=form, headers={"User-Agent": "FindMyShelter public Seoul dataset collector"}), timeout=60) as response:
        return response.read()


def download_source(page, suffix):
    if page == ISLAND_SOURCE:
        content = request(page)
        with ZipFile(BytesIO(content)) as archive:
            year, month, day, *_ = archive.getinfo(f"{ISLAND_LAYER}.shp").date_time
        date = f"{year:04}-{month:02}-{day:02}"
        return {"source": page, "filename": f"{ISLAND_LAYER}.zip", "fileUpdated": date,
                "recorded": date, "sha256": sha256(content)}, content
    html = request(page).decode("utf-8")
    choices = []
    for row in re.findall(r'<tr\b[^>]*id="fileTr_[0-9]+"[^>]*>.*?</tr>', html, re.S):
        file = re.search(r'''<span\s+title="([^"]+)"\s+onclick="javascript:downloadFile\('([0-9]+)'\);">''', row)
        updated = re.search(r'>(\d{4})\.(\d{2})\.(\d{2})\.?\s*</td>', row)
        if file and updated and file[1].lower().endswith(suffix):
            choices.append(("-".join(updated.groups()), unescape(file[1]), file[2]))
    if not choices:
        raise ValueError(f"No {suffix} file with a publication date at {page}")
    updated, filename, seq = max(choices)
    dataset = page.split("/")[4]
    form = re.search(r'<form\b[^>]*\bname="frmFile"[^>]*>(.*?)</form>', html, re.S)
    revision = re.search(r'name="infSeq"\s+value="(\d+)"', form[1]) if form else None
    if revision is None:
        raise ValueError(f"Missing download form revision at {page}")
    content = request(DOWNLOAD_URL, {"infId": dataset, "infSeq": revision[1], "seq": seq, "seqNo": ""})
    if suffix == ".csv":
        header = content.partition(b"\n")[0]
        valid = all(field in header for field in (b"X", b"Y", b","))
    else:
        valid = content.startswith(b"PK\x03\x04")
    if not valid or len(content) < 1024:
        raise ValueError(f"The portal did not return {filename}")
    recorded = re.search(r'(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)', filename)
    return {"source": page, "filename": filename, "fileUpdated": updated,
            "recorded": "-".join(recorded.groups()) if recorded else updated, "sha256": sha256(content)}, content


def cached_sources(cache, refresh):
    cache.mkdir(parents=True, exist_ok=True)
    manifest = cache / "pedestrian-signal-sources.json"
    if refresh or not manifest.is_file():
        sources = {}
        for name, (page, suffix) in SOURCES.items():
            entry, content = download_source(page, suffix)
            (cache / f"{name}-{entry['sha256']}{suffix}").write_bytes(content)
            sources[name] = entry
        write_json(manifest, sources)
    else:
        sources = read(manifest)

    files = {}
    for name, (page, suffix) in SOURCES.items():
        entry = sources[name]
        digest = entry["sha256"]
        if entry["source"] != page or not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise ValueError(f"Invalid source record for {name}")
        files[name] = cache / f"{name}-{digest}{suffix}"
        if sha256(files[name].read_bytes()) != digest:
            raise ValueError(f"Cached source {name} changed. Download again with --refresh.")
    return sources, files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("region_dir", type=Path, help="Regional dataset folder containing pavement.json")
    parser.add_argument("district", help="Official Seoul district name")
    parser.add_argument("cache", type=Path, help="Shared location for reusable Seoul source snapshots")
    parser.add_argument("--walk-context", type=Path, help="Existing route presentation data, including path and island geometry")
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    sources, files = cached_sources(args.cache, args.refresh)
    context = read(args.walk_context) if args.walk_context else {}
    dataset = make_dataset(context, read(args.region_dir / "pavement.json"), files["inventory"], files["poles"],
                           args.district, sources["inventory"]["recorded"], sources["poles"]["fileUpdated"],
                           files["crosswalks"], files["islands"])
    records = dataset["crossings"]
    if not records or not any(r["installed"] is not None for r in records):
        raise ValueError("No crossing status matched the selected district and region")
    dataset["sources"] = sources
    dataset["coverage"] = {
        "crossings": len(records),
        "installed": sum(record["installed"] is True for record in records),
        "absent": sum(record["installed"] is False for record in records),
        "unknown": sum(record["installed"] is None for record in records),
        "crossingsWithHeads": sum(bool(record["heads"]) for record in records),
        "heads": sum(len(record["heads"]) for record in records),
    }
    write_json(args.region_dir / "pedestrian-signals.json", dataset)
    print(json.dumps(dataset["coverage"]))


if __name__ == "__main__":
    main()
