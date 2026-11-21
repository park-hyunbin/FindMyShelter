"""Match a complex's modeled tower heights and floor counts to the Seoul building register."""
import argparse
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "frontend/public/datasets"
SOURCE = "https://data.seoul.go.kr/dataList/OA-22424/S/1/datasetView.do"


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def digits(value):
    return value.strip().lstrip("0")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("region")
    parser.add_argument("register", type=Path)
    parser.add_argument("--parcel", required=True)
    parser.add_argument("--road-number", required=True, type=int)
    parser.add_argument("--complex", required=True)
    args = parser.parse_args()
    buildings = PUBLIC / "buildings" / args.region
    towers = {}
    for chunk in read(buildings / "manifest.json")["chunks"]:
        for feature in read(buildings / chunk["url"])["features"]:
            row = feature["properties"]
            if row["name"] == args.complex and row["dong"]:
                dong = row["dong"].removesuffix("동")
                if dong in towers:
                    raise ValueError(f"Duplicate modeled tower {dong}")
                towers[dong] = row
    if not towers:
        raise ValueError("No named towers in the current region")
    verified = {}
    with args.register.open(encoding="cp949", newline="") as source:
        for row in csv.DictReader(source):
            if row["대지위치"] != args.parcel or digits(row["새주소주지번"]) != str(args.road_number):
                continue
            dong = row["동명"].strip().removesuffix("동")
            if dong not in towers or row["주부속구분코드명"] != "주건축물" or row["주용도코드명"] != "공동주택":
                continue
            if dong in verified:
                raise ValueError(f"Duplicate registered tower {dong}")
            height, floors = float(row["높이"]), int(row["지상층수"])
            model = towers[dong]
            if height <= 0 or floors < 1 or abs(model["height_m"] - height) > 0.01 or model["floors"] != floors:
                raise ValueError(f"Registered and modeled dimensions differ for tower {dong}")
            verified[dong] = {
                "buildingId": model["id"], "dong": f"{dong}동", "heightM": height, "floors": floors,
                "approvedOn": row["사용승인일자"], "collectedOn": row["데이터수집일"][:10],
            }
    if verified.keys() != towers.keys():
        raise ValueError(f"Missing register rows for {sorted(towers.keys() - verified.keys())}")
    result = {"source": SOURCE, "parcel": args.parcel, "roadNumber": args.road_number,
              "towers": [verified[dong] for dong in sorted(verified)]}
    path = PUBLIC / "regions" / args.region / "facade-elevations.json"
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(verified)} towers match the register's heights and floor counts")


if __name__ == "__main__":
    main()
