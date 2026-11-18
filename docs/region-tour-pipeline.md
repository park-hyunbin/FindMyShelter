# 지역별 3D 임장

메인에서 오포 임장에 바로 입장합니다. 지역을 검색하거나 `?region=songpa`를 열면 가락동부센트레빌로 이동합니다. `ShelterHome`은 선택한 구역의 `OpoTour`를 열고 필요한 건물 조각·DEM·환경·POI만 요청합니다. 지역 전환 시 이전 렌더러·GPU 자원·이벤트·로딩 요청을 정리합니다. `/polygons`는 건물 자료 검증 화면입니다.

## 현재 지역

- 오포: 기존 건물 214개, 주변 OSM 건물, DEM, 도로, 녹지, 수계, POI, 단지 도로·시설·공원 경로·위성영상.
- 송파는 가락동부센트레빌 101~105동, 송파대로32길의 눈높이 시작점, 지도상 단지 경계, 8m 간격 실외 일조 표본을 제공합니다. 반경 600m 건물 표본 752개와 GEDTM30 격자 11,025점, 주변 OSM 도로·녹지·장소를 사용합니다. 높이 미확인 309개는 그대로 NULL입니다. 주동 형상과 동 번호는 건물 표본을 사용했습니다. OSM의 103·104동 표기는 해당 표본과 차이가 있습니다. 경계는 OSM 주거 영역이며, 출입구·내부 보행로·상세 외관은 추가 확인이 필요합니다. [서울시 단지 정보](https://openapt.seoul.go.kr/openApt/index.do?aptCode=A13816002) · [OSM 경계](https://www.openstreetmap.org/way/1079940834) · [시작 도로](https://www.openstreetmap.org/way/169916279)

OSM 길은 일반화된 지도 선이며 정밀 도로 폭·보행 적합성·실제 교통 정보를 보장하지 않습니다. 송파의 운전 모드는 이 길 위의 탐색 연출입니다. DEM은 원본 약 30m를 25m 간격으로 보간한 표현이며 새로운 해상도를 만들지 않습니다.

## 지역 추가 순서

1. `data/config/buildings/{지역}.json`을 작성합니다. 안정적인 건물 ID·CRS·컬럼 매핑·중심·범위·출처를 지정합니다.
2. Python 건물 파이프라인으로 init → QGIS 검증 → build합니다. [건물 파이프라인](building-pipeline.md) 참조.
3. `node frontend/scripts/prepare-region.mjs --region {지역}`으로 해당 건물 원점에 정합되는 도로·녹지·물길·POI·DEM을 오프라인 생성합니다.
4. `frontend/components/data/regions.ts`에 지역명·검색어와 각 생성 파일 경로를 등록하고 화면을 검증합니다. 새 지역의 site/surrounding은 없으면 null입니다.

```sh
.venv/bin/python -m backend.pipeline build --config data/config/buildings/songpa.json
node frontend/scripts/prepare-region.mjs --region songpa
# 원본 변경 시에만 외부 지도/DEM을 다시 요청
node frontend/scripts/prepare-region.mjs --region songpa --refresh
```

`prepare-region`은 생성 파일이 있으면 외부 호출 없이 재사용합니다. 건물 원점과 DEM 원점이 다르면 중단하여 다른 동네 지형이 섞이지 않게 합니다. 도로·POI를 갱신하려면 --refresh를 사용합니다. 지역의 좌표를 변경했다면 반드시 함께 갱신해야 합니다. GEDTM30 출처와 라이선스는 terrain.json, OSM 출처·스냅샷은 environment.geojson에 남깁니다.

## 전국 확장의 경계

현재 검색은 **미리 준비된 오포·송파 카탈로그**입니다. 전국 주소를 지오코딩하는 기능이나 전국 임장이 완성된 상태는 아닙니다. 준비되지 않은 지역은 검색 결과 없음으로 표시하고 다른 지역 데이터를 대신 열지 않습니다.

전국 원본을 확보하면 시군구 단위 원본과 QGIS 검증 기준을 관리하고, 임장 중심의 제한된 반경별로 건물 manifest와 지역 묶음을 생성합니다. 같은 건물 ID와 내용 해시를 재사용할 수 있습니다. 모든 전국 폴리곤을 하나의 초기 요청으로 보내지 않습니다. 현재 브라우저는 선택한 작은 구역의 건물 조각을 동시 최대 4개씩 읽습니다.

이후 필요한 추가 구현은 주소 검색 API와 이용 조건 확인, 좌표→준비된 구역 조회 API, 카메라 범위별 타일/LOD 스트리밍입니다. 현재 정적 카탈로그·경량 manifest·지역별 지형/환경 계약은 이 조회 결과를 연결할 수 있도록 분리했습니다. 임의 주소의 분석을 접속 시 즉석 계산하는 서버는 아직 만들지 않았습니다.
