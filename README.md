# Find My Shelter

실제 동네와 주변 자연환경을 브라우저에서 둘러보는 3D 온라인 임장입니다. 오포 롯데캐슬 포레스트와 서울 송파·가락동 표본에서 관심 있는 두 실외 지점의 직사광과 그늘을 같은 날짜에 비교하고, 방향별 시야와 녹지·수계·학교의 위치를 확인할 수 있습니다.

## 실행

```sh
npm --prefix frontend ci
npm --prefix frontend run dev
```

브라우저에서 http://127.0.0.1:3000 을 열고 오포 또는 송파·가락동을 검색해 입장합니다. 오포는 수레실길의 보행 시점, 송파는 임장구역 전체를 보는 시점에서 시작합니다. PC에서는 WASD나 방향키를 쓰고, 휴대폰에서는 걷기 조이스틱과 운전 버튼을 사용합니다. 가까운 바닥을 누르면 해당 위치로 걸어갑니다. 오포의 **동네 드라이브**는 단지 입구에서 수레실 정류장을 거쳐 능평도서관까지 연결된 도로를 따라갑니다. [HRUM의 3D 웹사이트 제작과 이동 조작 가이드](https://hrum.ai/spaceEbook/)

```sh
npm --prefix frontend run build
```

같은 지역에서 아바타와 채팅을 공유하는 **함께 임장**은 프로덕션 빌드 후 WebSocket 서버로 실행합니다.

```sh
npm --prefix frontend run serve:tour
```

브라우저 두 탭에서 http://127.0.0.1:4295 를 열고 같은 지역에 입장합니다. 각 탭에서 **함께 임장 → 함께 임장 입장**을 선택하면 접속 인원과 다른 참가자의 걷기·운전 상태를 볼 수 있습니다. 메시지는 접속한 방으로 전송하며 서버에 기록하지 않습니다. 오포와 송파는 별도 방입니다. [ws](https://github.com/websockets/ws) · [sirv](https://github.com/lukeed/sirv)

공개 환경에서 활성화하려면 같은 HTTPS 주소에서 정적 페이지와 `/tour-live` WebSocket 업그레이드를 제공해야 합니다. Node 서버는 기본적으로 루프백에서 실행하며, 배포 환경의 바인딩 주소와 포트는 `TOUR_HOST`, `PORT`로 지정합니다. `TOUR_ORIGINS`에는 허용할 HTTPS 출처를 쉼표로 구분해 지정합니다. 정적 Sites 배포는 현재 혼자 입장하는 임장을 제공합니다.

## 오포 데이터와 계산

일조 비교의 **그늘 원인 보기**를 누르면 선택 지점과 햇빛이 처음 닿는 건물 체적 또는 지형이 3D에 표시됩니다. A·B 지점의 시간 막대를 누르거나 키보드로 조절해 같은 시각의 경로를 볼 수 있습니다. 미판정 방향은 점선으로 표시하며, 밤에는 경로를 숨깁니다.

주변 자연환경의 **공원 인근 도로 연결**에서 경로를 열면 50m 간격으로 계산한 지형 단면을 볼 수 있습니다. 단면 슬라이더로 위치를 고르면 3D 표식이 함께 움직이며, 선택 위치에서 경로 방향의 눈높이 시점을 열 수 있습니다. 표고와 변화율은 약 30m 지형 모델에 기반합니다. 공원 출입구와 보도 연결, 실제 노면 경사는 추가 대조가 필요합니다.

101~104동은 공개 외관 사진을 참고해 회백색 벽, 세로 장식, 층 사이 띠와 열린 지붕 탑으로 표현합니다. 사진 출처와 GIS 윤곽에서 선택한 기준 면은 `frontend/public/opo-architecture.json`에 기록했습니다. 탑의 위치·크기와 창·띠 간격은 근사이며, 단지 시설의 자료에서 원본 사진을 열 수 있습니다.

- **건물** · QGIS 편집본의 214개 건물 윤곽·높이 후보와 OSM의 주변 건물 윤곽 2,014개를 대조해 범위 안에 겹치지 않는 건물을 3D로 표시합니다. 2026년 10월 건축물대장에서 확인한 101~104동의 높이는 모두 46.78m이며 103동은 14층, 다른 주동은 15층입니다. 모델의 외벽 층간 간격에 이 층수를 사용했습니다. 갈색 경사지붕과 창호는 공개 단지 사진을 참고해 표현했습니다. 대장 건축면적과 3D 도형 면적 차이를 단지 시설 탭에서 확인할 수 있습니다. [건축HUB 표제부](https://www.hub.go.kr/portal/opn/tyb/idx-bdrg-ttlldr.do) · [호갱노노 단지 사진](https://hogangnono.com/apt/6AD09) · [KB부동산 단지 사진](https://kbland.kr/se/c/21160)
- **동네 도로와 장소** · OSM 원본의 도로·보행로 711개, 지도상 위치 385개, 주차장 윤곽 12개를 로컬 좌표로 변환합니다. 운전은 동일 OSM 노드에서 연결된 차량 통행 구간을 따라가고, 자동 주행은 기록된 일방통행도 적용합니다. 보도·횡단보도·정류장은 위치와 태그를 사용하며 페인트와 표지 디자인, 기록이 없는 폭과 교량 높이는 시각 모델입니다. 동네를 구성하는 방식은 Bumpinto World, 운전 조작과 시점은 차멍을 참고했습니다. [OSM 도로 자료](https://www.openstreetmap.org/api/0.6/map.json?bbox=127.1497,37.3392,127.1788,37.3624) · [Bumpinto World](https://github.com/dohoon84/bumpinto-world) · [차멍](https://metamoa.com/s/car-meong-soosang-party-mw7er2bm)
- **101·104동 중정** · 항공영상에서 원형 광장과 서쪽 파란 포장 공간을 주동 윤곽과 대조했습니다. 사진에서 확인한 원형 난간, 석축, 식재, 목재 계단을 3D로 표현했습니다. 치수와 단차는 근사이며 원본 사진은 모델에 포함하지 않습니다. 단지 시설에서 중정으로 이동하거나 해당 위치를 실외 일조 비교 지점으로 선택할 수 있습니다. [단지 사진](https://kbland.kr/se/c/21160) · [다른 각도의 단지 사진](https://hogangnono.com/apt/6AD09) · [항공영상 출처](https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer)
- **자연환경과 진입로** · OpenFreeMap/OpenMapTiles에 포함된 © OpenStreetMap contributors 데이터에서 도로, 녹지, 수계를 가져옵니다. 줌 14 스냅샷을 사용하며 타일 빌드 식별자와 추출 범위는 `frontend/public/opo-environment.geojson`의 메타데이터에 있습니다. 도로 폭과 수계 표현은 화면용이며 녹지와 수계까지의 거리는 직선거리입니다. [OpenStreetMap 데이터 이용 조건](https://www.openstreetmap.org/copyright)
- **공원 인근 도로 연결** · 단지 진입부에서 능평3통 쌈지공원 및 능평8통 체육공원 인근까지 OSM에서 실제로 이어진 도로를 표시합니다. 두 경로는 보도 연결을 확인할 수 없어 점선으로 표시하며, 거리는 도로망 기준입니다. [쌈지공원 등록 위치](https://platformdodam.com/children-play-facilities/10830) · [능평8통 체육공원 지도](https://www.openstreetmap.org/way/1266958183)
- **위성영상** · 2026-10-08 Sentinel-2 L2A 10m 영상을 오포 주변으로 자르고 건물과 같은 좌표계로 변환했습니다. 자연환경 탭의 **위성영상**에서 켤 수 있습니다. Contains modified Copernicus Sentinel data 2026. [Sentinel-2 영상 원본 안내](https://registry.opendata.aws/sentinel-2-l2a-cogs/)
- **지형과 직사광** · 렌더링은 [Three.js](https://threejs.org/), 좌표 변환은 [Proj4js](https://proj4js.org/), 태양 위치는 [SunCalc3](https://github.com/hypnos3/suncalc3)를 사용합니다. 지형은 Ho & Hengl의 GEDTM30 v1.1(EGM2008, CC BY 4.0) 오포 부분을 EPSG:5186으로 좌표 변환·보간한 모델입니다. 지면 1.5m 위에서 건물과 지형이 태양을 가리는지 한국 시각 기준 10분 간격으로 검사합니다. 주동 차폐는 등록 높이와 현재 평면 윤곽을 합친 단순화 체적을 사용합니다. 높이가 없는 주변 건물의 차폐 가능성과 판정이 어려운 시간도 표시합니다. [GEDTM30 원자료](https://zenodo.org/records/15689805)
- **방향별 시야** · 주변 자연환경 탭에서 8방향을 선택해 두 지점의 지형 단면과 차폐각을 비교합니다. 차폐각은 눈높이 1.5m에서 선택 방향 800m 안의 지형과 높이가 있는 건물 지붕이 수평선 위를 가리는 각도입니다. 건물이 더 높게 보이면 지형만 적용한 각도를 함께 표시합니다. 3D에서 그 방향을 눈높이로 볼 수 있습니다. 주변 건물의 높이 자료 범위가 제한되며, 선택 방향에서 높이 미확인 윤곽을 만나면 가장 가까운 위치까지의 거리를 표시합니다. [GRASS GIS 지평선 각도 계산 원리](https://grass.osgeo.org/grass-stable/manuals/r.horizon.html)

데이터 생성 스크립트는 `frontend/scripts`에 있습니다. `node frontend/scripts/prepare-opo-streets.mjs`는 OSM 원본에서 도로·장소·주변 건물 자료를 함께 갱신합니다. `node frontend/scripts/prepare-opo-terrain.mjs`는 공개 지형을 잘라 90m 기준과 대조합니다. 건물·DEM의 전처리와 자료 상태는 [데이터 안내](data/README.md), 전체 구현 범위와 검증 항목은 [기획서](docs/planning/2026-11-17-complex-online-tour-spec.md)에 있습니다.

## 지역과 건물 데이터 작업

오포·송파 건물 윤곽은 지역별 QGIS 편집본에서 생성한 manifest를 통해 불러옵니다. `/polygons`에서 지역별 건물 자료를 검토할 수 있습니다. 송파는 OpenFreeMap의 도로와 주변 장소를 사용하며, 높이가 미확인된 건물은 평면 윤곽으로 표시합니다. [지역 데이터 생성](docs/region-tour-pipeline.md) · [폴리곤 파이프라인](docs/building-pipeline.md)
