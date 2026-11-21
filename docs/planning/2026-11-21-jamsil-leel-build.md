# 잠실 르엘 3D 임장 제작 기록

2026-11-21 · 서울 송파구 올림픽로 333 · 지역 ID `jamsil-leel`

가락동부센트레빌에서 만든 도로·보도·횡단보도·보행 신호·지형 처리 규칙을 잠실 르엘에도 적용했다. 단지 전체와 주변 환경을 같은 3D 공간에서 둘러보고, 공개 원본만으로 어디까지 재현되는지 확인했다.

## 1. 원본 선택과 자동 검사

| 대상 | 작업과 확인 결과 | 원본 |
| --- | --- | --- |
| 단지와 주동 | OSM의 주거 영역 `503503948` 버전 12를 단지 경계로 사용했다. 경계 안의 공동주택 윤곽에 달린 동 이름이 101~113동과 정확히 일치하는지 검사했다. 주동 수는 롯데건설 사업개요와 일치한다. 사업개요 기준 1,865세대, 최고 지상 35층이다. | [OSM 경계](https://www.openstreetmap.org/way/503503948) · [롯데건설 사업개요](https://www.lottecastle.co.kr/APT/AT00424/16004/summary/view.do) |
| 동쪽·북쪽 진입부 | OSM의 진입도로 두 개를 추출했다. 올림픽로33길 쪽은 101·102동 사이, 북쪽은 112·113동 사이로 연결되는 배치다. 입주자모집공고의 진입 방향과 대조했다. 카메라는 진입로 인근에서 단지 안쪽을 향한다. | [동쪽 진입도로](https://www.openstreetmap.org/way/1563978281) · [북쪽 진입도로](https://www.openstreetmap.org/way/1563978280) · [롯데건설 입주자모집공고](https://www.lottecastle.co.kr/APT/AT00424/16298/supply/view.do) |
| 주변 건물과 지형 | 중심에서 800m 안과 맞닿는 건물 895개를 공통 형식으로 변환했다. 건물·도로·보도·녹지·수계는 동일한 EPSG:5186 로컬 좌표계와 지형 원점을 쓴다. GEDTM30의 원본 해상도는 약 30m다. | [OSM 지도](https://www.openstreetmap.org/#map=16/37.5171/127.1072) · [OpenFreeMap](https://openfreemap.org/) · [GEDTM30](https://zenodo.org/records/15689805) |
| 도로·보도 | 단지 경계에서 400m까지 서울시 면 자료를 잘랐다. 도로 204개 원본, 보도 166개 원본을 사용했다. OSM 도로망 구간 413개에 실측 도로면을 결합했다. 면 자료가 빠진 도로는 지도 중심선과 분류·차로 정보로 그린다. | [서울시 도로면](https://openlab.eseoul.go.kr/qgisplugin/SHP/N1A_A0010000.zip) · [서울시 보도면](https://openlab.eseoul.go.kr/qgisplugin/SHP/N1A_A0033320.zip) |
| 차선·횡단 | T-GIS에서 차선 1,527개와 횡단보도 185개를 잘랐다. 횡단보도 81개는 2026년 관리대장의 식별자와 일치했다. 도색은 도로 표면에 맞춰 그린다. 원본 제작 시점이 다른 자료가 섞여 있으므로 표식을 현행과 대조할 수 있도록 자료 날짜를 남겼다. | [서울시 차선](https://data.seoul.go.kr/dataList/OA-15537/S/1/datasetView.do) · [서울시 횡단보도 도형](https://data.seoul.go.kr/dataList/OA-15554/S/1/datasetView.do) · [횡단보도 관리대장](https://data.seoul.go.kr/dataList/OA-23081/F/1/datasetView.do) |
| 보행 신호 | 공통 수집기에서 교차로 105건을 검사했다. 설치 기록 35건, 미설치 기록 8건, 미확인 62건이다. 설치 기록과 지주 위치를 좌표로 연결할 수 있는 횡단 19곳에 신호등 모형 23개를 표시했다. 보행 신호의 실제 주기와 운용 상태는 조사 범위에 포함되지 않는다. | [서울시 보행신호 자료](https://data.seoul.go.kr/dataList/OA-22356/S/1/datasetView.do) · [추출 파일과 원본 해시](../../frontend/public/datasets/regions/jamsil-leel/pedestrian-signals.json) |

## 2. 3D 외형과 일조 데이터

건물 윤곽과 동 번호는 지도 원본을 사용했다. 확보한 OSM 및 서울시 건축물대장 표제부 자료에서는 잠실 르엘 주동의 동별 높이값을 확인하지 못했다. 리치고에서 참고 층수를 찾은 9개 동은 외형에만 적용했다. 104·109·112·113동의 외형에는 기본 30층을 적용했다. 화면의 높이 환산은 층당 3.05m의 모형 설정이다. [리치고 잠실 르엘](https://m.richgo.ai/realty/danji/a5YFxWm) · [서울시 건축물대장 표제부](https://data.seoul.go.kr/dataList/OA-22424/S/1/datasetView.do)

일조·그림자와 방향별 시야 계산에는 건물 데이터의 높이 필드만 전달한다. 잠실 르엘 주동의 높이 필드는 비어 있고, 그 윤곽이 빛 경로에 걸려 판정을 확정할 수 없는 경우 화면에 ‘미판정’으로 표시한다. 위치와 시간별 태양 경로, 동일한 지형 위에서의 관찰점 비교는 가능하다.

서울시 단지 내 도로와 놀이시설 도형에서는 단지 안쪽의 자료를 찾지 못했다. 롯데건설 공개 조경도에서 주동 중심 9곳을 GIS에 맞춰 산책로와 식재 구역을 추출했다. 기준점 위치 차이의 제곱평균제곱근은 3.0m다. 106·110동은 그림과 GIS 사이 기준점 차이가 커 정합 기준에서 제외했다. 생성기는 건물, 시 도로·보도와 겹치는 부분을 자르고 공통 포장·식재 모델에 넘긴다. 적용한 산책로·정원 위치와 나무 분포는 설계도 기준의 시각적 근사다. 실제 시설 치수와 시공 상태는 확인이 필요하다. [롯데건설 조경설계](https://www.lottecastle.co.kr/APT/AT00424/16291/download/view.do)

## 3. 재생성 순서

1. [지역 설정](../../data/config/buildings/jamsil-leel.json)에서 경계 way, 진입 way, 동 번호 범위와 지도 범위를 지정한다. OSM API의 `map.json?bbox=127.0957,37.5083,127.1187,37.526` 응답을 스냅샷으로 저장한다. 수집일이 달라지면 개수나 버전도 달라질 수 있다.
2. 아래 첫 두 명령으로 단지 경계·도로망·건물을 추출한다. 건물 파이프라인은 도형 유효성, 건물 ID 중복, 치수 값의 범위를 검사하고 250m 격자와 바이트 제한을 적용해 웹용 건물 조각을 만든다.
3. 건물 매니페스트가 생기면 환경·장소·지형을 만든다. 도로·보도 면을 생성한 뒤 같은 파일을 보행 신호 수집기에 넘긴다. 기존 서울 원본 캐시는 파일 해시를 검증한 뒤 재사용한다.
4. 서울시 차선·횡단보도 도형을 자르고 단지 선택 화면의 미리보기를 만든다. 개발 카탈로그에 지역과 생성 경로를 등록한다. 외형 참고 층수와 시작점은 [잠실 르엘 장면 설정](../../frontend/components/data/jamsil-leel.json)에 기록한다.

```sh
node frontend/scripts/prepare-opo-streets.mjs --region jamsil-leel "$OSM_JSON"
uv run --with geopandas --with shapely --with pyproj python -m backend.pipeline build-geojson --config data/config/buildings/jamsil-leel.json
node frontend/scripts/prepare-region.mjs --region jamsil-leel
uv run --with pyshp --with pyproj --with shapely python backend/scripts/prepare_neighborhood_pavement.py jamsil-leel "$ROAD_ZIP" "$WALK_ZIP" --radius 400
uv run --with openpyxl --with pyproj --with shapely --with pyshp python backend/scripts/collect_seoul_pedestrian_signals.py frontend/public/datasets/regions/jamsil-leel 송파구 "$SEOUL_CACHE"
uv run --with openpyxl --with pyproj --with shapely --with pyshp python backend/scripts/prepare_songpa_road_markings.py "$LANE_ZIP" "$CROSSWALK_ZIP" "$CROSSWALK_XLSX" --region jamsil-leel --bounds 127.1004 37.5118 127.114 37.523
uv run --with numpy --with pyproj --with shapely python backend/scripts/prepare_plan_landscape.py data/config/jamsil-leel-landscape.json
uv run --with pyproj --with shapely python backend/scripts/prepare_tour_postcard.py --region jamsil-leel
```

`OSM_JSON`은 1단계 스냅샷, `ROAD_ZIP`과 `WALK_ZIP`은 서울시 에스맵 자료다. `LANE_ZIP`은 T-GIS `A058_L`, `CROSSWALK_ZIP`은 `A004_A` 아카이브, `CROSSWALK_XLSX`는 2026-08-24 관리대장이다. 신호 캐시가 비어 있거나 갱신이 필요하면 수집기에 `--refresh`를 준다. 수작업 검수가 필요한 지역은 [QGIS 검수 경로](../building-pipeline.md)를 사용할 수 있다.

## 4. 이번 재현의 범위

자동 검사로 13동과 두 진입도로를 검증했다. 배포 화면에서는 13개 동의 조감, 진입부 눈높이, 도로 탐색과 일조 미판정을 확인한다. 동별 외장은 롯데건설 공개 이미지에 보이는 청회색 창호와 밝은 벽체를 공통 재질로 적용했다. 동별 출입문, 스카이브리지의 세부 형상과 현재 개방 여부는 추가 자료가 필요하다. [롯데건설 조감도](https://www.lottecastle.co.kr/APT/AT00424/16284/eyeview/view.do)
