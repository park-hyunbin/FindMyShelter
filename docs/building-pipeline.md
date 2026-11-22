# 지역별 건물 폴리곤 파이프라인

지도에서 건물을 위에서 본 모양에 높이·층수 같은 정보를 붙이고, 브라우저가 읽을 수 있는 작은 파일로 준비하는 과정입니다.

[전체 문서 목차](README.md) · [한 지역의 3D 장면 만들기](region-tour-pipeline.md) · [서울 건물 연결 현황](planning/2026-11-21-seoul-tour-coverage.md#주동을-지도-윤곽에-연결)

원본은 한 번 받아 QGIS나 자동 검사로 대조합니다. 바뀐 자료를 오프라인에서 웹 파일로 다시 만들고, 브라우저는 준비된 파일을 읽습니다. 이 문서는 건물 도형 전처리를 다룹니다. 지형·도로·생활시설을 합치는 단계는 지역별 3D 임장 문서에서 설명합니다.

```text
data/raw/                         원본 SHP/GeoJSON/GPKG 보존
data/config/buildings/{지역}.json 원본 경로·컬럼 매핑·범위·출처
data/working/buildings/{지역}/
  buildings.gpkg                 QGIS 수기검증의 기준 파일 (buildings 레이어)
  import.json                    최초 ID 목록·가져오기 설정
data/processed/buildings/{지역}/
  inventory.json                 inspect로 생성하는 원본 컬럼 정보
  quality.json                   누락·검증 오류 보고서
frontend/public/datasets/buildings/{지역}/
  manifest.json                  현재 버전·품질·조각 목록
  chunks/{SHA256}.geojson         변경되지 않으면 이름과 내용 유지
backend/pipeline/                지역 공통 Python 전처리
frontend/components/data/        브라우저 데이터 로더
```

기존 원본 및 옛 스크립트는 삭제하지 않았습니다. 기존 `prepare_sample.py`는 이전 단일 GeoJSON 출력 도구입니다. 현재 브라우저의 건물 입력은 새 오포 manifest입니다. 새 QGIS 편집은 반드시 `data/working/buildings/opo/buildings.gpkg`에서 진행하세요. 옛 `data/working/opo_300m/buildings.shp` 수정은 새 파이프라인에 자동 반영되지 않습니다.

## 실행 (프로젝트 루트)

```sh
# 가상환경 GIS 의존성이 없을 때만 설치
.venv/bin/python -m pip install -r backend/requirements-gis.txt

# 컬럼·NULL·샘플 확인
.venv/bin/python -m backend.pipeline inspect --config data/config/buildings/opo.json

# 처음 한 번만. 기존 QGIS 작업 파일이 있으면 덮어쓰지 않고 중단
.venv/bin/python -m backend.pipeline init --config data/config/buildings/opo.json

# QGIS 편집·저장 후 검사 및 웹 출력
.venv/bin/python -m backend.pipeline check --config data/config/buildings/opo.json
.venv/bin/python -m backend.pipeline build --config data/config/buildings/opo.json

# 같은 파이프라인, 다른 지역 설정
.venv/bin/python -m backend.pipeline inspect --config data/config/buildings/songpa.json
.venv/bin/python -m backend.pipeline init --config data/config/buildings/songpa.json
.venv/bin/python -m backend.pipeline build --config data/config/buildings/songpa.json
```

이미 생성된 두 지역에 `init`을 다시 실행할 필요가 없습니다. 새 지역은 설정을 복사하고 `region`, `source`, `encoding`, `center_lnglat`, `radius_m`, `fields`, `provenance`를 바꿔 시작하세요. 원본 날짜가 바뀌거나 범위를 확대한다면 새 지역 버전 이름으로 가져온 뒤 기존 편집값을 ID로 대조해야 합니다. 자동 덮어쓰기·자동 ID 재발급은 하지 않습니다. GPKG 원본은 `source_layer`도 지정합니다. SHP는 .shp/.shx/.dbf/.prj/.cpg 전체가 필요합니다.

## QGIS 검증

1. `buildings.gpkg`의 `buildings` 레이어를 열고 편집합니다. CRS는 EPSG:5186입니다.
2. `bldg_id`는 수정하지 않습니다. 높이(`height_m`, m), 층수(`floors`), 이름·동·주소·용도를 채웁니다. 알 수 없는 값은 NULL입니다.
3. `rev_status`는 pending / edited / verified 중 하나입니다. verified에는 `rev_note` 근거와 `rev_date` 확인일(YYYY-MM-DD)이 필요합니다. 이 상태는 사용자의 수기 확인을 의미합니다.
4. 편집 내용을 저장한 뒤 check/build를 실행합니다. 잘못된 도형은 QGIS 도형 검사·수정 후 다시 실행합니다. 자동 복구로 도형을 몰래 바꾸지 않습니다.

음수·소수 층수·잘못된 높이·중복/삭제/변경 ID·빈 도형이 있으면 중단합니다. 실패하면 기존 manifest가 유지됩니다. 높이·층수 0은 웹에서 NULL이며 층수로 높이를 추정하지 않습니다. 개발 샘플은 미검증 건물도 포함하고 상태를 기록합니다. 전체 수기검증을 강제하려면 `require_verified: true`를 사용합니다.

## 로딩과 재사용

- 범위를 정한 뒤 원본의 공간 필터로 읽습니다. 건물 전체를 지역별로 한꺼번에 브라우저에 보내지 않습니다.
- 250m 격자별로 묶고 파일 크기를 기본 180KB 이하로 나눕니다. 경계 건물은 자르거나 중복 복제하지 않습니다. 하나의 건물만으로 예산을 초과하면 출력 중단 후 확인합니다.
- 웹 도형만 기본 0.1m 단순화합니다. 면적 변화 1% 초과 시 원래 도형을 사용합니다. QGIS 원본은 그대로이며 4326 이중 좌표·미터 로컬 좌표를 중복 저장하지 않습니다.
- 현재 로더는 선택한 샘플의 모든 조각을 동시 최대 4개씩 읽습니다. 파일 이름은 내용 해시로 고정되므로 HTTP 캐시를 재사용합니다. manifest는 재검증합니다. 같은 데이터를 build하면 파일 수정 시각도 유지합니다.
- 전국 지도에서 카메라 범위만 읽는 타일 스트리밍·LOD는 아직 구현하지 않았습니다. 이 파이프라인은 아파트 주변의 제한된 범위를 위한 MVP입니다. 전국 전체를 하나의 설정으로 생성하지 마세요.
- 배포 시 해시 파일은 `Cache-Control: public,max-age=31536000,immutable`, manifest는 `no-cache`를 호스팅에 설정할 수 있습니다. 실제 적용은 호스팅 설정에 따릅니다. 오래된 조각은 기존 사용자의 요청을 보호하기 위해 자동 삭제하지 않습니다.

## 임장 화면의 건물 용도

송파 AL_D198 원본에서 `A26`은 용도 코드, `A27`은 용도명입니다. `02001` 아파트는 기존 외관을 사용하고 `02002` 연립주택과 `02003` 다세대주택에는 빌라 외관을 적용합니다. `01001` 단독주택은 큰 창, 현관, 지붕 마감을 표시합니다. `01003` 다가구주택과 서울시의 `일반주택`은 공통 주택 외관을 사용합니다. 소매점 `03001`과 음식점 `03002`·`04001` 등 용도가 명확한 시설에 쇼윈도를 표시합니다. `02000` 공동주택처럼 세부 유형이 불명확한 기록은 단순 외관입니다. [행정표준 건축물용도코드](https://www.data.go.kr/data/15140420/fileData.do)

기존 웹 조각에 코드 필드가 빠진 경우에는 송파의 `A0`로 `A26`을, 서울시 건물의 `UFID`로 원본 `종류`를 연결합니다. 서울시 표제부 연결 과정에서 `공동주택`으로 저장된 319개도 동일 버전의 원본에서 `종류=아파트`를 확인했습니다. 오포 편집본의 `use=아파트`와 OSM의 `building=apartments`는 명시적인 아파트 분류이므로 같은 렌더링 코드로 변환합니다. 명칭이나 층수로 추정하지 않습니다. [서울시 건물 도형 원본](https://openlab.eseoul.go.kr/qgisplugin/SHP/N1A_B0010000.zip)

자료를 갱신하면 아래 명령으로 속성 연결표를 다시 생성합니다. 연결표는 현재 manifest 버전에만 적용됩니다. 임장 대상의 외곽선은 현재 단지에 연결된 동을 따라 별도로 표시합니다. 창과 현관은 외벽 위 재질로 표현하고, 카메라가 멀어지면 단색 마감으로 천천히 전환합니다. 현관과 쇼윈도의 위치는 외벽 길이를 기준으로 배치한 시각 모형입니다. 단독주택의 경사진 지붕도 외곽선과 기존 최고 높이 안에서 만든 시각 모형이며, 일조·시야 계산은 기존 건물 체적을 사용합니다.

```sh
.venv/bin/python backend/scripts/prepare_building_use_evidence.py <송파-원본-SHP> <서울시-건물-ZIP>
```

## 현재 확보와 부족

| 지역 | 자료 | 부족 |
|---|---|---|
| 오포 | 기존 편집본 214개 | 높이 9, 층수 1, 이름 84, 동 93개 NULL, 전체 pending |
| 송파 | 원본 전체 18,105개 중 기술검증 중심점 600m 표본 752개 | 높이 309, 이름 538, 동 648개 NULL, 전체 pending |

광주시 전체 건물 원본은 현재 없습니다. 필요한 추가 자료는 **지역별 건물 SHP/GeoJSON/GPKG와 컬럼 정의서**입니다. 최소 안정적인 건물 ID·CRS·Polygon이 필요하고, 실제 높이·지상층수·건물명·동·주소·용도가 있으면 활용합니다. 송파의 A30 높이/A31 층수 등은 값 형태로 연결한 후보이므로 제공기관 컬럼 정의서와 QGIS 확인이 필요합니다. A1은 중복이 있어 현재 스냅샷 내 A0를 개별 ID로 사용합니다. 원본 교체 시 동일 ID 유지 여부를 별도 대조해야 합니다. CP949로 한글을 정상 읽었습니다.

## 상업시설과 건물 연결

송파 원본 A26/A27에서 `03001`은 소매점, `07001`은 도매시장, `07101`은 시장, `07201`은 상점, `07999`는 기타판매시설입니다. 이 값은 건물 용도를 설명합니다. 시설의 상호와 업태는 행정안전부 대규모점포 인허가 자료 또는 기존 OSM 생활시설 자료에서 가져옵니다. [행정표준 건축물용도코드](https://www.data.go.kr/data/15140420/fileData.do) · [행정안전부 대규모점포](https://www.data.go.kr/data/15045013/fileData.do) · [OpenStreetMap 데이터 라이선스](https://www.openstreetmap.org/copyright)

```sh
.venv/bin/python backend/scripts/prepare_retail_places.py data/raw/retail/localdata-large-scale-retail-20261121.csv
```

인허가 전국 CSV의 정상영업 기록 중 지원 업태를 대상으로 단지 중심 1km를 검색합니다. 행정안전부 좌표는 EPSG:5174에서 변환하고 공간 대조는 EPSG:5186에서 수행합니다. 같은 좌표에 중복 등록된 동일 상호나 법인명 변형은 최근 수정 기록을 우선합니다. 인허가 상태는 실시간 영업 정보를 제공하지 않습니다.

출력은 `frontend/public/datasets/retail/{지역}.geojson`입니다. QGIS에서 해당 점 레이어와 건물 레이어를 겹쳐 열고, 점의 `building_id`를 건물 ID와 대조할 수 있습니다. 점이 정확히 하나의 폴리곤 내부에 들어갈 때만 연결합니다. 경계나 겹치는 도형의 점은 위치만 남깁니다. 화면은 건물 manifest의 도형을 사용해 연결된 건물의 외곽선을 강조합니다. 건물 manifest 버전이 갱신되면 위 스크립트를 다시 실행해 주세요.

검증 명령: `.venv/bin/python -m unittest discover -s backend/pipeline/tests -v`
