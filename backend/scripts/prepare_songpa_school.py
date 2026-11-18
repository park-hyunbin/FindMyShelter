"""Confirm the Songpa site's elementary school using the published school-zone archives."""

import argparse
import csv
from io import BytesIO
import json
from pathlib import Path
from zipfile import ZipFile

import shapefile
from pyproj import CRS, Transformer
from shapely import make_valid, transform
from shapely.geometry import mapping, shape


REGION = Path(__file__).resolve().parents[2] / "frontend/public/datasets/regions/songpa"


def find_school_zone(zones_path, site):
    with ZipFile(zones_path) as archive:
        (filename,) = [name for name in archive.namelist() if name.lower().endswith(".shp")]
        stem = filename[:-4]
        crs = CRS.from_wkt(archive.read(stem + ".prj").decode("ascii"))
        to_local = Transformer.from_crs(4326, crs, always_xy=True)
        site = transform(site, to_local.transform, interleaved=False)
        with shapefile.Reader(shp=BytesIO(archive.read(filename)), shx=BytesIO(archive.read(stem + ".shx")),
                              dbf=BytesIO(archive.read(stem + ".dbf")), encoding="cp949") as reader:
            candidates = []
            for record in reader.iterShapeRecords(bbox=site.bounds):
                zone = make_valid(shape(record.shape.__geo_interface__))
                if zone.intersection(site).area > 0:
                    candidates.append((zone, record.record.as_dict()))
    if len(candidates) != 1 or not candidates[0][0].covers(site):
        raise ValueError("The site does not lie entirely in one elementary school zone.")
    zone, fields = candidates[0]
    if fields["HAKGUDO_GB"] != "0" or not crs.is_projected:
        raise ValueError("Expected an exclusive elementary school zone in a projected CRS.")
    to_wgs84 = Transformer.from_crs(crs, 4326, always_xy=True)
    display = transform(zone.simplify(1, preserve_topology=True), to_wgs84.transform, interleaved=False)
    return fields, mapping(display)


def find_link(links_path, zone_id, reference_date):
    with ZipFile(links_path) as archive:
        (filename,) = [name for name in archive.namelist() if name.lower().endswith(".csv")]
        table = csv.DictReader(archive.read(filename).decode("utf-8-sig").splitlines())
        matches = [row for row in table if row["학구ID"] == zone_id and row["학교급구분"] == "초등학교"]
    if len(matches) != 1 or matches[0]["데이터기준일자"] != reference_date:
        raise ValueError("The school association is ambiguous or has a different reference date.")
    return matches[0]


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("zones", type=Path)
    args.add_argument("links", type=Path)
    args = args.parse_args()
    site_file = json.loads((REGION / "site.geojson").read_text(encoding="utf-8"))
    fields, geometry = find_school_zone(args.zones, shape(site_file["features"][0]["geometry"]))
    association = find_link(args.links, fields["HAKGUDO_ID"], fields["BASE_DT"])
    result = {
        "school": association["학교명"],
        "schoolId": association["학교ID"],
        "zoneId": fields["HAKGUDO_ID"],
        "zoneName": fields["HAKGUDO_NM"],
        "referenceDate": fields["BASE_DT"],
        "districtOffice": association["교육지원청명"],
        "geometry": geometry,
    }
    (REGION / "school.json").write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
