"""Compare indexed Seoul marking spans with the city axes and national road links."""

import argparse
from collections import Counter, defaultdict
from contextlib import closing
from functools import lru_cache
import hashlib
from io import BytesIO
import json
from pathlib import Path
import sqlite3
from tempfile import NamedTemporaryFile
from zipfile import ZipFile

import numpy as np
from pyproj import CRS, Transformer
import shapefile
from shapely import (
    STRtree, covers, from_wkb, get_coordinates, get_parts, line_interpolate_point,
    linestrings, points, transform,
)
from shapely.geometry import shape

from audit_seoul_road_sources import layer_metadata


SPACING_M = 4.0
AXIS_RADIUS_M = 16.0
STRUCTURE_RADIUS_M = 16.0
TIE_M = 1.0
ANGLE = np.deg2rad(25)
MISSING = -1
AMBIGUOUS = -2
NO_SURFACE = -3
STRUCTURE_CODES = {"001": "elevated", "002": "underpass", "003": "bridge", "004": "tunnel"}

SCHEMA = """
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE evidence (
    marking_id INTEGER NOT NULL, start_m REAL NOT NULL, end_m REAL NOT NULL, district TEXT NOT NULL,
    axes TEXT NOT NULL, aligned_m REAL NOT NULL, ambiguous_m REAL NOT NULL, no_axis_m REAL NOT NULL,
    no_surface_m REAL NOT NULL, structure_near_m REAL NOT NULL, ground_and_structure_m REAL NOT NULL,
    structures TEXT NOT NULL, PRIMARY KEY(marking_id,start_m)
);
"""


class Network:
    def __init__(self, lines, references, kinds=None):
        parts, owners = get_parts(lines, return_index=True)
        coords, part_ids = get_coordinates(parts, return_index=True)
        start, end = coords[:-1], coords[1:]
        keep = (part_ids[:-1] == part_ids[1:]) & np.any(start != end, axis=1)
        self.start, end = start[keep], end[keep]
        self.vectors = end - self.start
        self.lengths = np.linalg.norm(self.vectors, axis=1)
        self.units = self.vectors / self.lengths[:, None]
        self.owners = owners[part_ids[:-1][keep]]
        self.references = references
        self.kinds = kinds
        self.tree = STRtree(linestrings(np.stack((self.start, end), axis=1)))

    def candidates(self, coordinates, radius):
        sample_ids, edge_ids = self.tree.query(points(coordinates), predicate="dwithin", distance=radius)
        return sample_ids, edge_ids, self.owners[edge_ids]


def load_city_axes(directory):
    lines, references = [], []
    stem = "N1L_A0020000"
    with ZipFile(directory / "axis.zip") as archive:
        if CRS.from_wkt(archive.read(stem + ".prj").decode("ascii")).to_epsg() != 5186:
            raise ValueError("Unexpected city axis coordinates")
        with archive.open(stem + ".dbf") as attributes, shapefile.Reader(
            shp=BytesIO(archive.read(stem + ".shp")), shx=BytesIO(archive.read(stem + ".shx")),
            dbf=attributes, encoding="cp949",
        ) as reader:
            for row in reader.iterShapeRecords(fields=["UFID"]):
                if row.shape.points and row.record["UFID"]:
                    lines.append(shape(row.shape.__geo_interface__))
                    references.append(row.record["UFID"])
    if not lines:
        raise ValueError("No usable city axes")
    return Network(lines, references)


def load_national_links(path, city_bounds):
    lines, references, kinds = [], [], []
    stem = "MOCT_LINK"
    with ZipFile(path) as archive:
        crs = CRS.from_wkt(archive.read(stem + ".prj").decode("ascii"))
        project = Transformer.from_crs(crs, 5186, always_xy=True)
        unproject = Transformer.from_crs(5186, crs, always_xy=True)
        west, south, east, north = city_bounds
        bbox = unproject.transform_bounds(west - 40, south - 40, east + 40, north + 40)
        with archive.open(stem + ".dbf") as attributes, shapefile.Reader(
            shp=BytesIO(archive.read(stem + ".shp")), shx=BytesIO(archive.read(stem + ".shx")),
            dbf=attributes, encoding="cp949",
        ) as reader:
            for row in reader.iterShapeRecords(fields=["LINK_ID", "ROAD_TYPE", "ROAD_USE"], bbox=bbox):
                record = row.record
                if record["ROAD_USE"] != "0" or not row.shape.points:
                    continue
                lines.append(shape(row.shape.__geo_interface__))
                references.append(record["LINK_ID"])
                kinds.append(record["ROAD_TYPE"])
    if not lines or not any(kind in STRUCTURE_CODES for kind in kinds):
        raise ValueError("No usable national road structure codes near the city")
    return Network(transform(np.asarray(lines, dtype=object), project.transform, interleaved=False),
                   references, np.asarray(kinds))


def sample_spans(geometries, starts, lengths):
    counts = np.ceil(lengths / SPACING_M).astype(int)
    indices = np.repeat(np.arange(len(geometries)), counts)
    weights = (lengths / counts)[indices]
    origins = np.repeat(np.cumsum(counts) - counts, counts)
    along = starts[indices] + weights * (np.arange(len(indices)) - origins + 0.5)
    lines = geometries[indices]
    step = np.minimum(0.25, weights / 4)
    a = get_coordinates(line_interpolate_point(lines, along - step))
    b = get_coordinates(line_interpolate_point(lines, along + step))
    vectors = b - a
    norms = np.linalg.norm(vectors, axis=1)
    tangents = np.divide(vectors, norms[:, None], out=np.zeros_like(vectors), where=norms[:, None] > 0)
    return counts, indices, weights, get_coordinates(line_interpolate_point(lines, along)), tangents


def select_axes(network, coordinates, tangent, road_geometries, is_stop, *, require_projection=False):
    selected = np.full(len(coordinates), MISSING, dtype=int)
    if not len(coordinates):
        return selected
    samples, edges, owners = network.candidates(coordinates, AXIS_RADIUS_M)
    direction = np.abs(np.sum(tangent[samples] * network.units[edges], axis=1))
    keep = np.where(is_stop[samples], direction <= np.sin(ANGLE), direction >= np.cos(ANGLE))
    samples, edges, owners = samples[keep], edges[keep], owners[keep]
    starts, vectors = network.start[edges], network.vectors[edges]
    relative = coordinates[samples] - starts
    positions = np.sum(relative * vectors, axis=1) / network.lengths[edges] ** 2
    feet = starts + np.clip(positions, 0, 1)[:, None] * vectors
    keep = covers(road_geometries[samples], points(feet))
    if require_projection:
        keep &= (positions >= 0) & (positions <= 1)
    samples, owners = samples[keep], owners[keep]
    distances = np.linalg.norm(coordinates[samples] - feet[keep], axis=1)
    order = np.lexsort((owners, distances, samples))
    nearest_samples, first = np.unique(samples[order], return_index=True)
    nearest = order[first]
    closest = np.full(len(coordinates), np.inf)
    closest[nearest_samples] = distances[nearest]
    selected[nearest_samples] = owners[nearest]
    ties = (owners != selected[samples]) & (distances - closest[samples] <= TIE_M)
    selected[samples[ties]] = AMBIGUOUS
    return selected


def structure_evidence(network, coordinates):
    samples, _, owners = network.candidates(coordinates, STRUCTURE_RADIUS_M)
    structural = np.isin(network.kinds[owners], tuple(STRUCTURE_CODES))
    ground = np.zeros(len(coordinates), dtype=bool)
    nearby = np.zeros(len(coordinates), dtype=bool)
    nearby[samples[structural]] = True
    ground[samples[network.kinds[owners] == "000"]] = True
    return nearby, nearby & ground, samples[structural], owners[structural]


def analyze_batch(rows, axes, national, road_at, districts):
    counts, indices, weights, coordinates, tangents = sample_spans(
        from_wkb([row[6] for row in rows]), np.asarray([row[1] for row in rows]),
        np.asarray([row[2] - row[1] for row in rows]),
    )
    roads = np.asarray([row[4] or 0 for row in rows])[indices]
    stop = np.asarray([row[5] == "stop" for row in rows])[indices]
    usable = roads != 0
    statuses = np.full(len(coordinates), NO_SURFACE, dtype=int)
    road_ids, road_indices = np.unique(roads[usable], return_inverse=True)
    geometry = np.asarray([road_at(int(id_)) for id_ in road_ids], dtype=object)
    statuses[usable] = select_axes(axes, coordinates[usable], tangents[usable], geometry[road_indices], stop[usable])
    nearby, both, structural_samples, national_owners = structure_evidence(national, coordinates)
    with_structure = defaultdict(set)
    for index, owner in zip(indices[structural_samples], national_owners):
        with_structure[index].add((national.references[owner], STRUCTURE_CODES[national.kinds[owner]]))

    masks = (statuses >= 0, statuses == AMBIGUOUS, statuses == MISSING, statuses == NO_SURFACE, nearby, both)
    keys = ("aligned_m", "ambiguous_m", "no_axis_m", "no_surface_m", "structure_near_m", "ground_and_structure_m")
    lengths = [np.bincount(indices, weights=weights * mask, minlength=len(rows)) for mask in masks]
    position = 0
    for i, (row, count) in enumerate(zip(rows, counts)):
        ids = statuses[position:position + count]
        position += count
        references = sorted({axes.references[axis] for axis in ids if axis >= 0})
        values = [float(column[i]) for column in lengths]
        districts[row[3]].update(dict(zip(keys, values)))
        yield (*row[:4], json.dumps(references, separators=(",", ":")), *values,
               json.dumps(sorted(with_structure[i]), separators=(",", ":")))


def reconcile(directory, road_index, national_path, output):
    index_uri = road_index.resolve().as_uri() + "?mode=ro"
    with closing(sqlite3.connect(index_uri, uri=True)) as source:
        source_report = source.execute("SELECT value FROM metadata WHERE key='report'").fetchone()[0]
        city_bounds = source.execute("SELECT min(min_x),min(min_y),max(max_x),max(max_y) FROM road_bounds").fetchone()

        @lru_cache(maxsize=8192)
        def road_at(id_):
            return from_wkb(source.execute("SELECT geometry FROM road WHERE id=?", (id_,)).fetchone()[0])

        axes = load_city_axes(directory)
        national = load_national_links(national_path, city_bounds)
        districts = defaultdict(Counter)
        cursor = source.execute("""SELECT s.marking_id,s.start_m,s.end_m,m.district,s.road_id,m.style,m.geometry
            FROM span s JOIN marking m ON m.id=s.marking_id ORDER BY s.marking_id,s.start_m""")
        with NamedTemporaryFile(dir=output.parent, prefix=output.name + ".", suffix=".part", delete=False) as stream:
            temporary = Path(stream.name)
        try:
            with closing(sqlite3.connect(temporary)) as result:
                result.executescript(SCHEMA)
                while batch := cursor.fetchmany(1024):
                    result.executemany("INSERT INTO evidence VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                                       analyze_batch(batch, axes, national, road_at, districts))
                total = Counter()
                for district in districts.values():
                    total.update(district)
                checked_length = sum(total[key] for key in ("aligned_m", "ambiguous_m", "no_axis_m", "no_surface_m"))
                if abs(checked_length - json.loads(source_report)["total"]["source_length_m"]) > 0.01:
                    raise ValueError("The reconciliation does not cover the original indexed marking length")
                with national_path.open("rb") as archive:
                    checksum = hashlib.file_digest(archive, "sha256").hexdigest()
                report = {"index_report_sha256": hashlib.sha256(source_report.encode()).hexdigest(),
                          "axis": layer_metadata(directory, "axis"),
                          "national_archive": national_path.name, "national_sha256": checksum,
                          "national_types": dict(Counter(national.kinds.tolist())),
                          "sample_spacing_m": SPACING_M, "axis_radius_m": AXIS_RADIUS_M,
                          "structure_radius_m": STRUCTURE_RADIUS_M, "tie_m": TIE_M,
                          "districts": dict(sorted(districts.items())), "total": dict(total)}
                result.execute("INSERT INTO metadata VALUES (?,?)", ("report", json.dumps(report, ensure_ascii=False)))
                result.commit()
            temporary.replace(output)
        finally:
            temporary.unlink(missing_ok=True)
        return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path, help="Directory with the Seoul source bundle")
    parser.add_argument("road_index", type=Path, help="SQLite output of index_seoul_road_markings.py")
    parser.add_argument("national_zip", type=Path, help="Public national node-link ZIP containing MOCT_LINK")
    parser.add_argument("output", type=Path, help="New SQLite evidence file")
    args = parser.parse_args()
    if args.output.suffix.lower() != ".sqlite" or args.output.resolve() == args.road_index.resolve():
        parser.error("output must be a different .sqlite file")
    print(json.dumps(reconcile(args.directory, args.road_index, args.national_zip, args.output), ensure_ascii=False))


if __name__ == "__main__":
    main()
