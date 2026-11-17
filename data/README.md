# 데이터 작업 순서

현재 건물 데이터 작업은 [지역 공통 파이프라인 안내](../docs/building-pipeline.md)를 사용합니다.
QGIS 기준 파일은 `data/working/buildings/opo/buildings.gpkg`이며, 아래 SHP 흐름은 이전 방식입니다.

1. QGIS에서 `data/working/opo_300m/buildings.shp`를 엽니다.
2. 속성 편집으로 필요한 값을 입력하고 레이어 편집 내용을 저장합니다.
3. VS Code에서 `터미널 → 작업 실행 → 데이터: QGIS 편집본 → 웹 GeoJSON`을 실행합니다.
4. 로컬 화면은 새로고침합니다. 배포 사이트 반영은 별도 빌드·배포가 필요합니다.

| 폴더 | 역할 | 직접 수정 |
|---|---|---|
| `raw/` | 원본과 기존 웹 샘플 스냅샷 | 하지 않음 |
| `working/opo_300m/` | QGIS 편집용 SHP 세트 | 이곳만 편집 |
| `archive/` | 이전 시도와 중간 결과 보관 | 현재 화면에서 미사용 |
| `../frontend/public/sample-buildings.geojson` | 자동 생성 웹용 출력 | 하지 않음 |

현재 광주시 원본 SHP는 작업 폴더에서 더 이상 확인되지 않아, 기존 웹 샘플에서 214개 도형을 복원했습니다. 원본 A칼럼 전체가 있는 파일은 아닙니다. 속성 매핑은 검증 전 후보입니다. `raw/incoming/`에는 사용자가 추가했던 자료를 폴더 구조 그대로 옮겼으며 지역·데이터 내용 검증은 별도입니다.

## 편집 칼럼

- `bldg_id`: 연결 식별자. 수정·중복·행 삭제 금지.
- `name`, `dong`, `address`, `use`: 이름·동·주소·용도.
- `height_m`: 미터 단위 건물 높이. 모르면 NULL. 층수로 임의 계산하지 않습니다.
- `floors`: 지상층수. 모르면 NULL.
- `rev_status`: `pending`(미확인), `edited`(수정), `verified`(직접 확인).
- `rev_note`: 확인 자료·수정 근거. 짧게 기록합니다.
- `rev_date`: 확인일(예: 2026-11-14).

QGIS 속성 테이블의 NULL은 미확인입니다. 높이와 층수의 0도 웹 전처리에서 NULL로 둡니다. 미확인 높이는 평면으로 표시합니다. 음수, 비정상 범위, 소수 층수, 잘못된 도형·식별자가 있으면 전처리를 중단하며 기존 웹 출력을 유지합니다. `verified`는 사용자가 직접 지정한 상태이며 자동 검증을 뜻하지 않습니다.

SHP는 `.shp`, `.shx`, `.dbf`, `.prj`, `.cpg`를 함께 보관하세요. 편집본 CRS는 EPSG:5186, 한글 인코딩은 UTF-8입니다. GeoJSON 출력은 EPSG:4326이며 면적·거리와 화면용 상대좌표는 Python에서 EPSG:5186으로 재계산합니다.

명령줄 실행:

```sh
.venv/bin/python backend/scripts/prepare_sample.py
npm --prefix frontend run dev
```

## 고도 DEM (추가)

- 원본: `data/raw/dem/korea_90m_grs80.img` (약 550MB, 사용자 제공 VWorld 한반도 DEM 복사본)
- 출처 메타데이터: `data/terrain.json`
- QGIS 확인용: `data/working/terrain/sample_dem_90m.tif` (샘플 중심 약 3km 폭, 원래 90m 격자 유지)
- 측정 결과: `data/processed/terrain/sample_terrain.json`
- 미리보기: `data/processed/terrain/sample_terrain_preview.png`

원본 수평 CRS를 읽어 건물 CRS와 변환합니다. 수직 단위·기준면·제작 시점·이용 조건은 현재 미확인입니다. JSON 표고값은 원본 숫자 단위이며 아직 확정된 m 표고로 쓰지 않습니다. 90m DEM을 보간해 건물 단위 정확도로 표시하지 않습니다.

VS Code 작업 **지형: DEM 샘플 추출·측정** 또는 다음 명령으로 재실행합니다.

```sh
.venv/bin/python backend/scripts/prepare_terrain.py
```

건물 중심 250/500/1000m 원 안의 셀 중심을 대상으로 유효 셀 비율·최저·최고·평균·중앙값·동서남북 분포를 측정합니다. 집의 방향을 입력하지 않아 전면/후면 결과는 NULL입니다. 셀이 부족하거나 유효율 80% 미만이면 결과를 비웁니다.

이 DEM은 용맥 선 데이터가 아닙니다. 능선 추출, 산줄기 연결성, 풍수 규칙·점수는 아직 구현하지 않았습니다. 90m 자료로는 작은 능선을 확정할 수 없습니다. QGIS에서 건물 SHP와 샘플 GeoTIFF를 함께 열어 주변 지형의 정합성을 먼저 확인하세요. 90m 자료는 현재 오프라인 지형 요약과 모델 간 비교에 씁니다.

## 소하천 자료 (로컬 검증 전용)

사용자 Downloads의 `LSMD_CONT_UJ301_경기` 파일 세트를 `data/raw/water/LSMD_CONT_UJ301_경기/`에 복사했습니다. 원본 11,001개 중 샘플 건물 주변 2km와 교차하는 31개 도형을 `data/processed/water/sample-water.geojson`으로 추출합니다. 도형 자르기·단순화 없이 좌표계만 변환합니다.

UJC100 4개는 소하천구역, UJC200 27개는 예정지 후보입니다. 이는 실제 수면·유량·흐름 방향이 아닙니다. 기존 구역 경계까지의 최단거리 후보는 8.05m로 계산되지만, 물까지의 거리나 홍수 위험으로 해석하지 않습니다.

공식 관련 자료 안내: https://www.data.go.kr/data/15161704/fileData.do (제4유형: 출처표시·상업이용금지·변경금지). 정확한 다운로드 파일의 이용 조건을 확인하기 전에는 배포 사이트에 이 데이터를 포함하지 않습니다.

```sh
.venv/bin/python backend/scripts/prepare_water.py
npm --prefix frontend run build
.venv/bin/python backend/scripts/preview_map.py
```

로컬 주소는 http://127.0.0.1:4174 입니다. 이 서버에서만 소하천 GeoJSON을 제공합니다. `frontend/public`과 배포 묶음에는 소하천 원본/추출본을 넣지 않습니다. QGIS에서는 `data/processed/water/sample-water.geojson`을 열어 검증할 수 있습니다.

## 웹 임장 지형 · GEDTM30

`node frontend/scripts/prepare-opo-terrain.mjs`는 GEDTM30 v1.1 표고와 예측 산포가 담긴 공개 COG에서 분석 범위만 읽습니다. 표고의 수직 기준은 EGM2008이며, 건물과 일치하는 EPSG:5186 좌표의 25m 간격 격자로 자르고 보간해 `frontend/public/opo-terrain.json`을 만듭니다. 25m 저장 간격은 원본의 약 30m 지형 해상도를 높이지 않습니다. [Ho & Hengl · GEDTM30 (CC BY 4.0)](https://zenodo.org/records/15689805)

웹 임장은 이 자료로 지형 단면과 차폐 계산을 수행합니다. 기존 90m 타일은 `prepare_web_terrain.py`가 생성하며, 두 모델은 각각 중앙 지점의 표고를 빼 상대 높이로 비교합니다. 지금 오포 작업 범위에서 평균 절대 차이는 8.1m입니다. 예측 산포는 학습 모델의 변동량이고, 두 자료의 차이는 현장 표고 오차를 검증한 결과와 구분합니다.

## 실폭도로 · 모드 전환

- 원본: `data/raw/roads/TL_SPRD_RW_41/` (SHP, EPSG:5179)
- 샘플: `data/processed/roads/sample-roads.geojson` (1km 범위, EPSG:4326)
- 전처리: `.venv/bin/python backend/scripts/prepare_roads.py`

원본 칼럼은 OPERT_DE/RW_SN/SIG_CD입니다. 도로 폭이 Polygon 형상으로 표현되며 별도 폭(m) 숫자 칼럼은 없습니다. 현재는 도로 면을 표시하며 교통량·통행 방향·차로 수·정확한 폭을 추정하지 않습니다. 사용 조건 확인 전에는 4174 로컬 검증 서버에서만 제공합니다.

새 3D 임장 화면의 도로·녹지·수계는 별도 OSM 스냅샷을 사용합니다. 스냅샷과 위성영상의 전처리 방법은 [실행 안내](../README.md)의 데이터와 계산 항목에 있습니다.
