# Find My Shelter

오포 롯데캐슬 포레스트 단지 전체와 주변 자연환경을 브라우저에서 둘러보는 3D 온라인 임장입니다. 관심 있는 두 실외 지점의 직사광과 그늘을 같은 날짜에 비교하고, 산지와 건물이 방향별 시야를 얼마나 가리는지와 녹지·수계의 위치를 확인할 수 있습니다.

## 실행

```sh
npm --prefix frontend ci
npm --prefix frontend run dev
```

브라우저에서 http://127.0.0.1:3000 을 엽니다. 조감에서는 드래그로 회전하고 스크롤로 확대합니다. **걷기**와 **운전**에서는 WASD, 방향키 또는 화면의 이동 버튼을 사용합니다. 분석 패널에서 101~104동 인근 실외 지점을 선택하거나 지점 선택 버튼으로 공간에서 직접 고를 수 있습니다. **단지 시설**에서는 OSM 단지 영역, 수레실길에서 교량을 통과하는 진입로, 공개 기록에 등록된 놀이시설을 확인할 수 있습니다.

```sh
npm --prefix frontend run build
```

## 데이터와 계산

- **건물** · QGIS 편집본의 214개 건물 윤곽과 높이 후보를 사용합니다. K-apt의 4개 동 수와 자료의 101~104동을 대조했습니다. 외관의 색과 반복 창호는 공개 단지 사진을 참고해 코드로 모델링했습니다. 외벽 무늬와 시설의 세부 형태는 근사입니다. [K-apt 단지 현황](https://www.k-apt.go.kr/cmmn/introMmentPop.do?bjdCode=41&searchOccuDate=201711&upYn=Y) · [호갱노노 단지 사진](https://hogangnono.com/apt/6AD09) · [KB부동산 단지 사진](https://kbland.kr/se/c/21160)
- **자연환경과 진입로** · OpenFreeMap/OpenMapTiles에 포함된 © OpenStreetMap contributors 데이터에서 도로, 녹지, 수계를 가져옵니다. 줌 14 스냅샷을 사용하며 타일 빌드 식별자와 추출 범위는 `frontend/public/opo-environment.geojson`의 메타데이터에 있습니다. 도로 폭과 수계 표현은 화면용이며 녹지와 수계까지의 거리는 직선거리입니다. [OpenStreetMap 데이터 이용 조건](https://www.openstreetmap.org/copyright)
- **공원 인근 도로 연결** · 단지 진입부에서 능평3통 쌈지공원 및 능평8통 체육공원 인근까지 OSM에서 실제로 이어진 도로를 표시합니다. 두 경로는 보도 연결을 확인할 수 없어 점선으로 표시하며, 거리는 도로망 기준입니다. [쌈지공원 등록 위치](https://platformdodam.com/children-play-facilities/10830) · [능평8통 체육공원 지도](https://www.openstreetmap.org/way/1266958183)
- **위성영상** · 2026-10-08 Sentinel-2 L2A 10m 영상을 오포 주변으로 자르고 건물과 같은 좌표계로 변환했습니다. 자연환경 탭의 **위성영상**에서 켤 수 있습니다. Contains modified Copernicus Sentinel data 2026. [Sentinel-2 영상 원본 안내](https://registry.opendata.aws/sentinel-2-l2a-cogs/)
- **지형과 직사광** · 렌더링은 [Three.js](https://threejs.org/), 좌표 변환은 [Proj4js](https://proj4js.org/), 태양 위치는 [SunCalc3](https://github.com/hypnos3/suncalc3)를 사용합니다. 지형은 Ho & Hengl의 GEDTM30 v1.1(EGM2008, CC BY 4.0) 오포 부분을 EPSG:5186으로 좌표 변환·보간한 모델입니다. 지면 1.5m 위에서 건물과 지형이 태양을 가리는지 한국 시각 기준 10분 간격으로 검사합니다. QGIS 표본 주변 건물의 OSM 윤곽으로 높이가 없는 건물과 표본 밖 차폐 가능성을 검토하고, 판정이 어려운 구간은 일조 합계에서 별도로 표시합니다. [GEDTM30 원자료](https://zenodo.org/records/15689805)
- **방향별 시야** · 주변 자연환경 탭에서 8방향을 선택해 두 지점의 지형 단면과 차폐각을 비교합니다. 차폐각은 눈높이 1.5m에서 선택 방향 800m 안의 지형과 높이가 있는 건물 지붕이 수평선 위를 가리는 각도입니다. 건물이 더 높게 보이면 지형만 적용한 각도를 함께 표시합니다. 3D에서 그 방향을 눈높이로 볼 수 있습니다. 주변 건물의 높이 자료 범위가 제한되며, 선택 방향에서 높이 미확인 윤곽을 만나면 가장 가까운 위치까지의 거리를 표시합니다. [GRASS GIS 지평선 각도 계산 원리](https://grass.osgeo.org/grass-stable/manuals/r.horizon.html)

데이터 생성 스크립트는 `frontend/scripts`에 있습니다. `node frontend/scripts/prepare-opo-terrain.mjs`는 공개 지형을 잘라 90m 기준과 대조합니다. 건물·DEM의 전처리와 자료 상태는 [데이터 안내](data/README.md), 전체 구현 범위와 검증 항목은 [기획서](docs/planning/2026-11-17-complex-online-tour-spec.md)에 있습니다.
## 건물 데이터 작업

지역 추가·QGIS 수기검증·경량 웹 출력은 [폴리곤 파이프라인 안내](docs/building-pipeline.md)를 사용합니다.
현재 건물 입력은 `data/working/buildings/opo/buildings.gpkg`에서 생성한 지역별 manifest입니다.
