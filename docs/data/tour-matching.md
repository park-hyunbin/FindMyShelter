# 조건 맞춤 임장

예산, 주차, 놀이터처럼 내가 중요하게 보는 조건으로 후보를 고를 때 어떤 자료를 사용하는지 설명합니다.

[전체 문서 목차](../README.md) · [K-apt 기본정보](kapt-complexes.md) · [서울 단지 목록 열기](https://find-my-shelter-opo-tour.roankoala1.chatgpt.site/seoul/)

첫 화면에서 오포와 서울 송파·마포·성동·성북의 단지를 권역별 지도로 탐험할 수 있습니다. 지도 아래 검색창은 자치구·주소·단지명, 거래 유형, 예산과 생활 조건으로 단지 목록을 조회합니다. 3D 임장 가능한 단지가 먼저 표시되고, 지도에서 열거나 바로 입장할 수 있습니다. 입장 시 선택한 단지의 3D 데이터를 불러오며, 탐험 화면으로 돌아와도 입력값을 유지합니다.

직접 입력한 매매가는 현재 매물 비교에만 사용합니다. 입력값을 받지 않는 전월세의 현재 가격은 미확인입니다. 과거 계약 참고에서는 매매가 또는 보증금과 월세 상한을 적용합니다. 과거 계약이 예산 이내여도 현재 매물이 예산에 맞는다는 의미가 아닙니다. 예산과 매물가는 탭 화면 상태로만 유지하며 서버로 전송하지 않습니다.

탐험 지도는 기존 OpenStreetMap 스냅샷의 단지 경계, 도로, 물길과 녹지를 EPSG:5186으로 투영해 단순화합니다. 핀은 단지 경계 안의 대표점입니다. 권역별 지도 파일을 갱신하려면 `.venv/bin/python backend/scripts/prepare_tour_maps.py`를 실행합니다.

경기 광주 오포권은 능평·신현·양벌을 포함합니다. [단지 연결 설정](../../data/config/tour-maps/gwangju.json)의 K-apt 단지 코드로 기본정보와 실거래를 연결합니다. 능평·신현 4개 단지의 건물 외곽은 VWorld `AL_D198_41610_20260715` 검수용 GeoPackage에서 지번 PNU, 등록 이름, 아파트 용도 코드, 주건축물 구분, 동수를 대조해 가져옵니다.

광주역 우방아이유쉘은 [K-apt](https://www.data.go.kr/data/15073271/fileData.do)의 관리 단지 `A10025136` 기준 798세대입니다. 청석로 70(1단지)과 74(2단지)의 실거래는 [국토교통부 자료제공](https://rt.molit.go.kr/pt/xls/xls.do)의 단지명·도로명 또는 법정동·지번을 대조하고 계약별 단지 구분을 기록합니다. 지도에는 [1단지 경계](https://www.openstreetmap.org/way/757265072)와 [2단지 경계](https://www.openstreetmap.org/way/757265073), 각 경계 안에서 확인한 OpenStreetMap 동 외곽 12개를 표시합니다. K-apt 동수 16개 가운데 나머지 4개는 외곽 미연결 상태입니다. 원본 스냅샷 시각과 건물별 OSM ID는 [도형 스냅샷](../../data/config/tour-maps/woobang-osm.json)에 기록합니다.

경기 광주 지도와 건물 외곽을 다시 생성할 때는 다음 명령을 사용합니다.

```sh
node frontend/scripts/prepare-neighborhood.mjs --map-window \
  127.12,37.32,127.285,37.419 /tmp/fms-gwangju-environment.geojson
.venv/bin/python backend/scripts/prepare_tour_maps.py \
  --gwangju-environment /tmp/fms-gwangju-environment.geojson
```

`--gwangju-register`로 VWorld 검수용 GeoPackage 경로를 지정할 수 있습니다. 기본 경로는 `data/archive/previous-gwangju/apartments_qgis_review.gpkg`입니다. 지도 생성 시 원본 단지 ID와 GIS 출처를 담은 `frontend/public/datasets/tour-maps/gwangju-buildings.geojson`도 함께 출력합니다.

화면에는 [Animal Island UI 4.0.1](https://github.com/guokaigdg/animal-island-ui) 컴포넌트를 사용합니다. UI 패키지와 관련 라이선스는 `/licenses/`에서 볼 수 있습니다.

## K-apt 자료 갱신

```sh
.venv/bin/python backend/scripts/prepare_tour_complexes.py \
  data/processed/complexes/kapt/20261113_단지_기본정보.csv --snapshot-date 2026-11-13
```

단지 코드 `A46492201`, `A13816002`로 각각 오포, 송파 행을 선택합니다. 앱에는 세대수·주차대수·복도 유형·놀이터 여부·충전시설 여부만 담습니다. 시설 수나 상태를 확인할 수 없는 항목은 NULL을 유지합니다. 전체 CSV나 연락처는 웹에 넣지 않습니다. [K-apt CSV 만들기](kapt-complexes.md)

## 실거래 CSV 갱신

직접 내려받은 매매·전월세 CSV를 `data/raw/transactions/molit/`에 날짜를 포함한 원본 이름으로 둡니다. 한 쌍은 같은 계약일 범위로 내려받습니다. 여러 달을 추가할 때는 앞 기간 종료일의 다음 날부터 조회해 날짜가 겹치거나 비지 않도록 합니다.

```sh
.venv/bin/python backend/scripts/prepare_tour_transactions.py
```

파일 이름으로 거래 유형을 나누고 CSV 내부의 계약일 범위로 짝을 맞춥니다. 같은 기간에 같은 유형 파일이 두 개 있거나 범위가 겹치거나 비면 기존 출력은 유지하고 중단합니다. 특정 파일만 선택하려면 `--sale`과 `--rent`를 기간별로 반복해 지정합니다.

새 단지를 `frontend/scripts/prepare-catalog-scene.mjs`로 등록하면 기존 CSV에서 실거래도 다시 추출합니다. 단지명과 도로명주소 또는 법정동·지번이 함께 일치하는 행을 연결합니다. K-apt 스냅샷에 새 단지가 아직 없으면 3D 단지 목록의 단지명과 전체 도로명주소를 사용합니다. 이 주소도 확인할 수 없는 단지는 자료 미확인으로 표시합니다. 이름이 다르면 주소로 확인한 별칭을 스크립트의 `MOLIT_NAMES`에 등록할 수 있습니다. 기본 K-apt 스냅샷을 바꾸려면 `--kapt`로 CSV 경로를 지정합니다.

로컬 원본 CSV 쌍 또는 K-apt 스냅샷이 없으면 장면 등록은 끝내고 기존 실거래 출력을 유지합니다. 원본을 추가하거나 갱신한 뒤에는 위의 실거래 전처리 명령으로 다시 추출합니다.

현재 2026-08-18~11-18 자료를 반영합니다. 해제된 매매를 제외하고 거래 유형·계약일·전용면적·가격과 해당하는 경우 1·2단지 구분을 웹의 생성 JSON에 담습니다. 결과의 기록 없음은 선택한 거래 유형과 조회 기간 기준입니다. 이 CSV 기반 요약은 로컬 검증용입니다.

[국토교통부 실거래가 자료제공](https://rt.molit.go.kr/pt/xls/xls.do)은 계약일 기준 CSV가 변경될 수 있으며 외부 공개용 통계에는 신고일 기준 공식통계를 쓰라고 안내합니다.
