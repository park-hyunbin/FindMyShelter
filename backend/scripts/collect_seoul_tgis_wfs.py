"""Collect the layers displayed by Seoul's public T-GIS map in one batch."""

import argparse
from collections import Counter
from contextlib import closing
from datetime import datetime, timezone
import gzip
import hashlib
import json
from pathlib import Path
import sqlite3
from tempfile import NamedTemporaryFile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from xml.etree import ElementTree

from pyproj import Transformer


MAP = "https://tgis.eseoul.go.kr/map/mapMain.do"
WFS = "https://tgis.eseoul.go.kr/geoserver/seoul/wfs"
SEOUL = (126.75, 37.40, 127.20, 37.72)
EPSG = 5186
TILE_METRES = 6500
LAYERS = {
    "A058_L": ("MGRNU", "GU_CDE", "STAT_CDE", "VIEW_CDE", "EVE_CDE", "A058_KND_CDE", "A058_KND2_CDE",
               "ESB_YMD", "CAE_YMD", "SIXID", "LINE_MGRNU", "ROD_GBN_CDE"),
    "A001_A": ("UFID", "MGRNU", "VIEW_CDE", "ROD_GBN_CDE", "도로구분", "도로폭", "차로수", "포장재질"),
    "A003_A": ("UFID", "ID", "MGRNU", "VIEW_CDE", "WID"),
    "A004_A": ("MGRNU", "GU_CDE", "STAT_CDE", "VIEW_CDE", "EVE_CDE", "ESB_YMD", "CAE_YMD", "SIXID",
               "A004_KND_CDE", "A004_KND2_CDE"),
}
SCHEMA = """
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE feature (
    layer TEXT NOT NULL, id TEXT NOT NULL, properties TEXT NOT NULL, geometry TEXT NOT NULL,
    PRIMARY KEY(layer,id)
) WITHOUT ROWID;
"""


def read_wfs(layer, bbox, **params):
    options = {"request": "GetFeature", "version": "1.1.1", "typename": f"seoul:{layer}",
               "bbox": ",".join(map(str, bbox)) + f",EPSG:{EPSG}", **params}
    request = Request(f"{WFS}?{urlencode(options)}",
                      headers={"Referer": MAP, "Accept-Encoding": "gzip"})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=90) as response:
                value = response.read()
                return gzip.decompress(value) if response.headers.get("Content-Encoding") == "gzip" else value
        except (OSError, URLError) as error:
            if attempt == 2 or isinstance(error, HTTPError) and error.code < 500 and error.code != 429:
                raise
            retry = error.headers.get("Retry-After") if isinstance(error, HTTPError) else None
            time.sleep(int(retry) if retry and retry.isdecimal() else 2 ** (attempt + 1))


def feature_count(layer, bbox):
    response = read_wfs(layer, bbox, service="WFS", version="2.0.0", resultType="hits")
    return int(ElementTree.fromstring(response).attrib["numberMatched"])


def page_features(layer, bbox, path):
    if not path.exists():
        response = json.loads(read_wfs(layer, bbox, outputFormat="application/json"))
        features = response.get("features")
        crs = (response.get("crs") or {}).get("properties", {}).get("name", "")
        if response.get("type") != "FeatureCollection" or not isinstance(features, list) or (
            features and crs.split(":")[-1] != str(EPSG)
        ):
            raise ValueError(f"Unexpected FeatureCollection or coordinate system for {layer} {bbox}")
        if response["totalFeatures"] != len(features):
            raise ValueError(f"Incomplete response for {layer} {bbox}: {len(features)}/{response['totalFeatures']}")
        keys = LAYERS[layer]
        stream = NamedTemporaryFile(dir=path.parent, suffix=".part", delete=False)
        pending = Path(stream.name)
        try:
            with stream, gzip.GzipFile(fileobj=stream, mode="wb", mtime=0) as bundle:
                for feature in features:
                    attributes = feature["properties"]
                    result = feature["id"], {key: attributes[key] for key in keys if key in attributes}, feature["geometry"]
                    bundle.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n")
            pending.replace(path)
        finally:
            pending.unlink(missing_ok=True)
    with gzip.open(path, "rt", encoding="utf-8") as bundle:
        for row in bundle:
            yield json.loads(row)


def windows(bbox):
    west, south, east, north = bbox
    for x in range(west, east, TILE_METRES):
        for y in range(south, north, TILE_METRES):
            yield x, y, min(x + TILE_METRES, east), min(y + TILE_METRES, north)


def snapshot_rows(layer, records):
    occurrences = Counter()
    for _, properties, geometry in records:
        # The public GeoServer generates a different feature ID for each request.
        # Identical copies of a record intersect the same tiles, so preserve their
        # within-tile multiplicity while removing repeat responses at tile boundaries.
        properties_json = json.dumps(properties, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        geometry_json = json.dumps(geometry, sort_keys=True, separators=(",", ":"))
        fingerprint = hashlib.sha256((properties_json + "\n" + geometry_json).encode("utf-8")).hexdigest()
        occurrences[fingerprint] += 1
        yield layer, f"{fingerprint}:{occurrences[fingerprint]}", properties_json, geometry_json


def collect(cache, output, layers):
    to_meters = Transformer.from_crs(4326, EPSG, always_xy=True)
    west, south, east, north = to_meters.transform_bounds(*SEOUL)
    bounds = int(west), int(south), int(east) + 1, int(north) + 1
    cache.mkdir(parents=True, exist_ok=True)
    requested_at = datetime.now(timezone.utc)
    report = {"endpoint": WFS, "map": MAP, "epsg": EPSG,
              "bounds": bounds, "tile_m": TILE_METRES, "layers": {}}
    with NamedTemporaryFile(dir=output.parent, suffix=".part", delete=False) as stream:
        temporary = Path(stream.name)
    try:
        with closing(sqlite3.connect(temporary)) as db:
            db.executescript(SCHEMA)
            for layer in layers:
                expected = feature_count(layer, bounds)
                print(f"{layer}: WFS reports {expected:,} features.", flush=True)
                for tile, bbox in enumerate(windows(bounds), 1):
                    path = cache / f"{layer}-{'-'.join(map(str, bbox))}.jsonl.gz"
                    db.executemany("INSERT OR IGNORE INTO feature VALUES (?,?,?,?)",
                                   snapshot_rows(layer, page_features(layer, bbox, path)))
                    requested_at = min(requested_at, datetime.fromtimestamp(path.stat().st_mtime, timezone.utc))
                    if tile % 6 == 0:
                        print(f"{layer}: {tile} tiles collected", flush=True)
                count = db.execute("SELECT count(*) FROM feature WHERE layer=?", (layer,)).fetchone()[0]
                if count != expected or feature_count(layer, bounds) != expected:
                    raise ValueError(f"Citywide count mismatch for {layer}: {count}/{expected}. Start a fresh cache.")
                report["layers"][layer] = count
            report["requested_at"] = requested_at.isoformat()
            report["checked_at"] = datetime.now(timezone.utc).isoformat()
            db.execute("INSERT INTO metadata VALUES ('report',?)", (json.dumps(report, ensure_ascii=False),))
            db.commit()
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cache", type=Path, help="Fresh tile cache, reusable when resuming the same collection")
    parser.add_argument("output", type=Path, help="SQLite snapshot output")
    parser.add_argument("--layer", action="append", choices=LAYERS, help="Collect a subset of the default four layers")
    args = parser.parse_args()
    if args.output.suffix.lower() != ".sqlite":
        parser.error("output must have a .sqlite suffix")
    print(json.dumps(collect(args.cache, args.output, dict.fromkeys(args.layer or LAYERS)), indent=2))


if __name__ == "__main__":
    main()
