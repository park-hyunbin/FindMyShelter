"""Contract-first response. No geocoder, GIS measurement or scoring is connected yet."""
from datetime import datetime, timezone


GROUPS = {
    "coordinates": ("lat", "lng"),
    "building": ("polygon", "facing_degrees"),
    "terrain": ("elevation_m", "rear_elevation_diff_m"),
    "water": ("nearest_distance_m", "relative_direction"),
    "scores": ("terrain", "water", "road", "building"),
}


def unavailable_analysis(address: str) -> dict:
    address = address.strip()
    if not 2 <= len(address) <= 200:
        raise ValueError("주소는 2~200자로 입력하세요.")
    return {
        "schema_version": "0.1.0",
        "status": "unavailable",
        "data_mode": "no_data",
        "address": address,
        **{group: dict.fromkeys(fields) for group, fields in GROUPS.items()},
        "interpretation": {
            "strengths": [],
            "limitations": ["주소 검색 및 GIS 데이터 공급자가 아직 연결되지 않았습니다."],
            "summary": "실제 공간 데이터가 없어 분석과 점수를 제공하지 않습니다.",
        },
        "evidence": {
            f"{group}.{field}": {
                "status": "missing", "source": None, "source_date": None,
                "method": None, "crs": None, "unit": None,
                "missing_reason": "provider_not_connected",
            }
            for group, fields in GROUPS.items() for field in fields
        },
        "scoring": {"experimental": True, "rule_version": None, "coverage": 0},
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
