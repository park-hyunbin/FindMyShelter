"""Collect public Seoul road layers once and measure their geometric agreement."""

import argparse
from collections import Counter, defaultdict
from contextlib import contextmanager
import hashlib
from io import BytesIO
import json
import logging
from pathlib import Path
import shutil
from tempfile import NamedTemporaryFile
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zipfile import ZipFile, is_zipfile

import numpy as np
from pyproj import CRS
import shapefile
from shapely import STRtree, is_valid, line_interpolate_point, make_valid
from shapely.geometry import shape

from prepare_neighborhood_pavement import parts
from prepare_songpa_road_markings import lane_style


SEOUL_FILE_URL = "https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?useCache=false"
SEOUL_CATALOG_URL = "https://data.seoul.go.kr/dataList/OA-15537/S/1/datasetView.do"
OPENLAB = "https://openlab.eseoul.go.kr/qgisplugin/SHP"
LAYERS = {
    "lanes": "A058_L",
    "bus-lanes": "A058_L",
    "road": "N1A_A0010000",
    "walk": "N1A_A0033320",
    "axis": "N1L_A0020000",
    "crossing": "N1A_A0043325",
}
LANE_FIELDS = ["STAT_CDE", "VIEW_CDE", "GU_CDE", "MGRNU", "LINE_MGRNU", "SIXID", "RN_CDE",
               "A058_KND_C", "A058_KND2_"]
MATCH_CLASSES = ["road_only_m", "road_and_walk_m", "walk_only_m", "near_road_m", "outside_m"]


def seoul_file(dataset, dataset_sequence, file_sequence, catalog):
    return Request(
        SEOUL_FILE_URL,
        data=urlencode({"infId": dataset, "infSeq": dataset_sequence, "seq": file_sequence, "seqNo": ""}).encode(),
        headers={"Referer": catalog},
    )


def sources():
    files = {f"{name}.zip": Request(f"{OPENLAB}/{layer}.zip")
             for name, layer in LAYERS.items() if name not in {"lanes", "bus-lanes"}}
    files["lanes.zip"] = seoul_file("OA-15537", 3, 9, SEOUL_CATALOG_URL)
    files["lane-inventory.xlsx"] = seoul_file("OA-15537", 3, 11, SEOUL_CATALOG_URL)
    files["bus-lanes.zip"] = seoul_file("OA-22396", 1, 2, "https://data.seoul.go.kr/dataList/OA-22396/F/1/datasetView.do")
    return files


def acquire(directory, refresh):
    directory.mkdir(parents=True, exist_ok=True)
    for name, request in sources().items():
        output = directory / name
        if not refresh and is_zipfile(output):
            continue
        with NamedTemporaryFile(dir=directory, prefix=f"{name}.", suffix=".part", delete=False) as stream:
            temporary = Path(stream.name)
        try:
            with urlopen(request, timeout=60) as response, temporary.open("wb") as stream:
                shutil.copyfileobj(response, stream)
            if not is_zipfile(temporary):
                raise ValueError(f"{name} did not contain a valid archive")
            temporary.replace(output)
        finally:
            temporary.unlink(missing_ok=True)


def layer_stem(bundle, layer):
    return next(path[:-4] for path in bundle.namelist()
                if path.rsplit("/", 1)[-1].lower() == f"{layer.lower()}.shp")


@contextmanager
def open_layer(directory, name, *, attributes=False, read_shapes=True):
    layer = LAYERS[name]
    with ZipFile(directory / f"{name}.zip") as bundle:
        stem = layer_stem(bundle, layer)
        crs = CRS.from_wkt(bundle.read(stem + ".prj").decode("ascii"))
        if crs.to_epsg() != 5186:
            raise ValueError(f"{layer} has an unexpected CRS: {crs.to_string()}")
        streams = {}
        if read_shapes:
            streams["shp"] = BytesIO(bundle.read(stem + ".shp"))
            streams["shx"] = BytesIO(bundle.read(stem + ".shx"))
        if attributes:
            streams["dbf"] = BytesIO(bundle.read(stem + ".dbf"))
        with shapefile.Reader(encoding="cp949", **streams) as reader:
            yield reader


def polygon_index(directory, layer):
    polygons = []
    with open_layer(directory, layer) as reader:
        for row in reader.iterShapes():
            if not row.points:
                continue
            geometry = shape(row.__geo_interface__)
            if not is_valid(geometry):
                geometry = make_valid(geometry)
            polygons.extend(parts(geometry, "Polygon"))
    if not polygons:
        raise ValueError(f"{layer} contains no usable polygons")
    return STRtree(polygons)


def covered(tree, points):
    mask = np.zeros(len(points), dtype=bool)
    mask[tree.query(points, predicate="intersects")[0]] = True
    return mask


def compare_batch(records, road, walk, spacing, districts):
    lines = np.asarray([line for line, _ in records], dtype=object)
    lengths = np.asarray([line.length for line in lines])
    sizes = np.ceil(lengths / spacing).astype(int)
    indices = np.repeat(np.arange(len(lines)), sizes)
    weights = (lengths / sizes)[indices]
    origins = np.repeat(np.cumsum(sizes) - sizes, sizes)
    distances = weights * (np.arange(len(indices)) - origins + 0.5)
    points = line_interpolate_point(lines[indices], distances)
    in_road = covered(road, points)
    in_walk = covered(walk, points)
    outside = ~in_road & ~in_walk
    near = np.zeros(len(points), dtype=bool)
    outside_indices = np.flatnonzero(outside)
    if len(outside_indices):
        pairs = road.query_nearest(points[outside], max_distance=0.5, all_matches=False)
        near[outside_indices[pairs[0]]] = True
    masks = (in_road & ~in_walk, in_road & in_walk, ~in_road & in_walk, near, outside & ~near)
    for label, mask in zip(MATCH_CLASSES, masks):
        lengths_by_line = np.bincount(indices[mask], weights[mask], minlength=len(lines))
        for (_, district), matched in zip(records, lengths_by_line):
            districts[district][label] += float(matched)


def layer_metadata(directory, name):
    archive = directory / f"{name}.zip"
    with ZipFile(archive) as bundle:
        stem = layer_stem(bundle, LAYERS[name])
        projection_member = bundle.getinfo(stem + ".prj")
        index_member = bundle.getinfo(stem + ".shx")
        epsg = CRS.from_wkt(bundle.read(projection_member).decode("ascii")).to_epsg()
        if epsg != 5186:
            raise ValueError(f"{LAYERS[name]} has an unexpected CRS: {epsg}")
    with archive.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    return {"layer": LAYERS[name], "archive_size": archive.stat().st_size, "sha256": digest,
            "crs": epsg, "shape_count": (index_member.file_size - 100) // 8,
            "shape_index_date": "%04d-%02d-%02d" % index_member.date_time[:3]}


def audit(directory, spacing):
    layers = {name: layer_metadata(directory, name) for name in LAYERS}
    road = polygon_index(directory, "road")
    walk = polygon_index(directory, "walk")
    districts = defaultdict(Counter)
    identifiers = Counter()
    active_ids = set()
    batch = []
    omitted_style = 0
    with open_layer(directory, "lanes", attributes=True) as reader:
        for row in reader.iterShapeRecords(fields=LANE_FIELDS):
            tags = row.record
            if (tags["STAT_CDE"], tags["VIEW_CDE"]) != ("001", "002"):
                continue
            district = tags["GU_CDE"] or "unknown"
            districts[district]["active_records"] += 1
            identifiers.update(key for key in ("MGRNU", "LINE_MGRNU", "SIXID", "RN_CDE") if tags[key])
            if tags["MGRNU"]:
                active_ids.add(tags["MGRNU"])
            if lane_style(tags["A058_KND_C"], tags["A058_KND2_"]) is None:
                omitted_style += 1
                continue
            if not row.shape.points:
                continue
            lines = [line for line in parts(shape(row.shape.__geo_interface__), "LineString")
                     if line.length > 0.25]
            if not lines:
                continue
            districts[district]["audited_records"] += 1
            batch.extend((line, district) for line in lines)
            if len(batch) >= 2048:
                compare_batch(batch, road, walk, spacing, districts)
                batch.clear()
    if batch:
        compare_batch(batch, road, walk, spacing, districts)
    totals = Counter()
    for stats in districts.values():
        totals.update(stats)
    if not totals["audited_records"]:
        raise ValueError("The bundle contained no usable lane records")
    with open_layer(directory, "bus-lanes", attributes=True, read_shapes=False) as reader:
        bus_ids = {row["MGRNU"] for row in reader.iterRecords(fields=["MGRNU"]) if row["MGRNU"]}
    return {"layers": layers, "sample_spacing_m": spacing, "near_road_tolerance_m": 0.5,
            "unmapped_style_records": omitted_style, "identifier_counts": dict(identifiers),
            "bus_lane_ids": {"distinct": len(bus_ids), "in_active_lane_archive": len(bus_ids & active_ids)},
            "districts": dict(sorted(districts.items())), "total": dict(totals)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--download", action="store_true", help="Fetch the source bundle and reuse valid local archives")
    parser.add_argument("--refresh", action="store_true", help="Replace cached archives from the same official downloads")
    parser.add_argument("--spacing", type=float, default=2.0, help="Maximum spacing between lane samples in metres")
    parser.add_argument("--output", type=Path, help="Write the JSON report here")
    args = parser.parse_args()
    if not 0.25 <= args.spacing <= 10:
        parser.error("--spacing must be between 0.25 and 10 metres")
    if args.refresh and not args.download:
        parser.error("--refresh requires --download")
    logging.getLogger("shapefile").setLevel(logging.ERROR)
    if args.download:
        acquire(args.directory, args.refresh)
    report = json.dumps(audit(args.directory, args.spacing), indent=2, ensure_ascii=False)
    if args.output:
        args.output.write_text(report + "\n", encoding="utf-8")
    else:
        print(report)


if __name__ == "__main__":
    main()
