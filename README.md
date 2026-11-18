# Find My Shelter

실제 동네와 주변 자연환경을 브라우저에서 둘러보는 3D 온라인 임장입니다. 오포 롯데캐슬 포레스트와 서울 송파구 가락동부센트레빌에서 관심 있는 두 실외 지점의 직사광과 그늘을 같은 날짜에 비교하고, 방향별 시야와 녹지·수계·학교의 위치를 확인할 수 있습니다.

송파의 **주거환경 분석 → 임장 체크리스트**에서 14개 항목의 자료 범위와 현장에서 볼 내용을 확인할 수 있습니다. 일조 지도, 방향별 시야, 단지 조감, 학교·상점 위치를 이어서 열 수 있으며 개인 기록은 현재 브라우저에 저장됩니다. 현장에서는 **체크리스트 받기**로 내려받은 텍스트를 볼 수 있습니다.

송파의 **단지 정보**에서 2025-10-28 World Imagery를 참고해 그린 단지 안 포장 구간과 수목을 눈높이로 보고, 두 대표 지점을 겨울 오후 2시의 같은 조건으로 비교할 수 있습니다. 영상에서 읽은 위치와 형상은 근사입니다. 수목 높이와 노면 단차는 추정이며 출입구까지의 연결은 현장 확인이 필요합니다. 일조 계산은 건물과 지형을 기준으로 합니다. [항공영상 메타데이터](https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/9/query?objectIds=480339&outFields=SRC_DATE,NICE_DESC,SRC_RES&returnGeometry=false&f=pjson)

가락동부센트레빌 101~105동의 위치는 건물 표본과 공개 배치 자료를 대조했습니다. 103동은 세 갈래 주동, 104동은 그 서쪽 일자형 주동입니다. 지상 사진과 항공영상에서 읽은 흰 외벽, 청록색 창호, 원형 옥상 구조를 3D에 반영했습니다. 창호, 동 번호판, 옥상 구조의 세부 위치와 치수는 근사입니다. 일조 계산에는 GIS 윤곽과 높이 표본의 체적을 사용합니다. [공개 배치 참고 지도](https://m.richgo.ai/api/og/danji-map/a9phoJw) · [공개 단지 사진](https://hogangnono.com/apt/1Zfb4)

송파의 **일조 비교 → 겨울 위성영상과 비교**에서 2025-12-22 11:27:11 KST에 촬영된 Sentinel-2 10m 영상과 같은 시각의 모델 판정을 볼 수 있습니다. 101동 남서쪽의 어두운 실외 표본은 모델에서 103동에 가려지고, 상대적으로 밝은 중앙 포장로 표본은 모델에서 직사광으로 판정됩니다. 픽셀 밝기에는 재질과 수목의 영향도 있으며 순간 영상과 비교한 두 예시입니다. 하루 직사광 시간과 겨울 오후의 경계는 추가 관찰이 필요합니다. `node frontend/scripts/prepare-songpa-winter-imagery.mjs`로 영상과 좌표를 다시 생성할 수 있습니다. [촬영 메타데이터와 원본](https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/S2B_52SCG_20251222_0_L2A)

K-apt 단지코드 `A13816002`의 관리시설정보(2026-11-18 조회)는 264세대, 주차 536면(지상 19면·지하 517면), 승강기 8대를 기록합니다. 행정안전부 시설 현황에서 같은 주소의 단지 놀이터를 확인할 수 있습니다. 단지 내 개별 시설 좌표와 방문 주차 조건은 현장 확인이 필요합니다. [K-apt 관리시설정보](https://www.k-apt.go.kr/kaptinfo/openKaptMng.do) · [행정안전부 놀이시설 현황](https://www.cpf.go.kr/cpf/ko/nori/0006/index.jsp?sido=1100000000&sigungu=1171000000&rgnCd=1171000000&ronaDaddr=%EC%86%A1%ED%8C%8C%EB%8C%80%EB%A1%9C32%EA%B8%B8)

송파의 **역·공원 방향 경로**는 단지 앞 교차점부터 송파역 2번 출구 인근 보행 겸용로(581m)와 송이공원 남쪽 보행로(484m)까지의 지도 연결입니다. 지도상 횡단 구간, 약 30m 표고 모델에 따른 지형 단면, 선택 위치의 눈높이 시점을 제공합니다. 송파역 출구 직전 약 3m는 보행망에 연결되지 않아 직선 이격으로 표시했습니다. `node frontend/scripts/prepare-songpa-access.mjs`로 원본 지도에서 다시 생성할 수 있습니다. [송파역 2번 출구](https://www.openstreetmap.org/node/3401171608) · [송이공원 남쪽 보행로](https://www.openstreetmap.org/way/1145100664) · [송파구 송이공원 위치](https://www.songpa.go.kr/www/detailInfo.do?cpn=13&key=5463&resrceCd=LV0273-1062546&sc1=LV0271)

**송이공원 산책**은 단지 앞 교차점에서 남쪽 진입부까지 지도상 약 457m(직선 약 323m), 공원 안 보행로까지 약 484m입니다. 2025-10-28 항공영상에서 남쪽 보도와 진입부 포장의 연결을 확인했고, 지상 사진과 대조한 포장과 수목을 눈높이 시점에 구현했습니다. 포장 폭과 수목의 위치·높이는 근사이며 현재 개방 여부와 계단·노면 경사는 현장에서 확인할 항목입니다. [항공영상 촬영 정보](https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/9/query?objectIds=480339&outFields=SRC_DATE,NICE_DESC,SRC_RES&returnGeometry=false&f=pjson) · [공원 지상 사진](https://my-context.tistory.com/46) · [송파구 공원 소개](https://songpa.newstool.co.kr/view.php?aid=9704&eid=8617)

송파역·송이공원·서울신가초의 **경로 지형 단면**에는 서울시 1:5,000 수치지형도(2025-03-20 공개 파일)의 등고선과 표고점을 사용합니다. 삼각망으로 보간해 경로를 10m씩 표본화하고, 30m 구간의 시작·끝 높이 차로 변화율을 계산합니다. 송이공원은 남쪽 진입부부터 내부 보행로까지의 약 28m에서 보간 높이가 약 1.6m 높아지고, 지도상 출발 위치에서 약 481m 지점에 30m 등고선이 만납니다. 각 경로 75m 이내의 표고점을 하나씩 제외한 내부 검증의 평균 절대차는 1.04~1.49m였습니다. 실제 보도와 계단은 현장 확인 항목입니다. 원본 `서울시 등고선.zip`에서 `uv run --with pyshp --with pyproj --with scipy --with "shapely>=2.1" python backend/scripts/prepare_songpa_route_elevation.py <원본.zip>`로 재현할 수 있습니다. [서울시 표고점과 등고선](https://data.seoul.go.kr/dataList/OA-22241/F/1/datasetView.do)

**초등학교 통학구역**은 2026-09-20 기준 한국교육시설안전원 경계와 학교 연계표를 대조했습니다. 지도상 단지 경계 전체가 서울신가초 통학구역에 들어갑니다. 단지 앞 교차점부터 송이로 횡단보도를 건너 학교 쪽 보행로까지 지도상 385m가 이어집니다. 횡단보도 서쪽 보행로의 눈높이 시점과 경로 지형 단면을 열 수 있으며, 학교 쪽 보행로와 교문 사이의 연결은 현장 확인이 필요합니다. 원본 통학구역 ZIP과 학교·학구도 연계 ZIP에서 `uv run --with pyshp --with "shapely>=2.1" --with pyproj python backend/scripts/prepare_songpa_school.py <통학구역.zip> <학교학구연계.zip>`로 자료를 다시 생성할 수 있습니다. [통학구역 원본](https://www.data.go.kr/data/15159265/fileData.do) · [학교·학구도 연계](https://schoolzone.emac.kr/publicData/publicDataList.do) · [서울신가초](https://singa.sen.es.kr/12615/subMenu.do) · [송이로 횡단보도](https://www.openstreetmap.org/way/544143915)

**뉴스타트병원 방향**은 단지 앞 교차점부터 송이로14길이 송이로와 만나는 지도상 지점까지 표시합니다. 지도에서 이어지는 약 290m 중 보행로·보도 표기가 있는 구간은 약 28m입니다. 서울시 2022-11-23 조사 식별자 `B1103_004`의 보조출입구에는 경사로 설치, 조사 기준 5° 이하 경사, 문폭 1m 이상, 문 하부 단차 없음이 기록되어 있습니다. 도로 종점과 이 출입구의 직선 이격은 약 23m입니다. 보도 연결과 출입구 개방 여부는 현장 확인 항목입니다. [서울시 보행자 출입구 정보](https://data.seoul.go.kr/dataList/OA-21699/S/1/datasetView.do?tab=A) · [서울시 시설 정보](https://data.seoul.go.kr/dataList/OA-21698/S/1/datasetView.do?tab=A) · [OpenStreetMap 송이로14길](https://www.openstreetmap.org/way/169916267)

송파의 **소음·야간**은 양재대로 옆 보행로와 단지 안 포장 공간에서 같은 시각의 3D 시점을 엽니다. 도로 중심선까지의 직선거리는 각각 약 22m와 132m입니다. 단지 안 비교점에서 약 490m, 500m 떨어진 서울시 S-DoT 두 센서의 2026-11-02~08 시간별 평균 소음(dB)·조도(lx)를 센서 위치와 함께 제공합니다. 단지 내 소음과 조명은 현장 확인 항목이며 3D의 주변광은 시각에 따른 연출입니다. 원본 설치 위치표와 `S_DOT_ENV_2026.11.02-11.08.csv`를 내려받아 `python backend/scripts/prepare_songpa_ambient.py <설치 위치표.xlsx> <관측.csv>`로 관측 자료를 다시 만들 수 있습니다. [서울시 센서 설치 위치](https://data.seoul.go.kr/dataList/OA-15969/S/1/datasetView.do) · [서울시 시간별 기록](https://data.seoul.go.kr/dataList/OA-22833/S/1/datasetView.do) · [OpenStreetMap 양재대로](https://www.openstreetmap.org/way/1175929595)

송파의 **물길·침수**는 서울시가 공개한 2010~2025년의 14개 파일을 지도상 단지 경계에서 700m 범위로 조회합니다. 주변에 표시할 기록이 있는 연도는 2010년·2011년·2022년이며 지도상 단지 경계와 겹치는 도형은 확인되지 않았습니다. 가장 가까운 2022년 기록은 경계 밖 약 10m에 있습니다. 표시 도형의 중복은 합치고 거리와 겹침은 원본으로 계산합니다. 주변 연못의 가장자리와 탄천 중심선까지의 직선거리는 각각 약 450m, 1,050m입니다. 단지 안 배수 상태나 향후 침수 여부를 판단하려면 별도 현장·방재 자료가 필요합니다. 원본 ZIP을 연도별로 `YYYY.zip`으로 저장한 뒤 `uv run --with pyshp --with "shapely>=2.1" --with pyproj python backend/scripts/prepare_songpa_flood.py <파일 폴더> --checked-on 2026-11-18`로 이력을 다시 생성할 수 있습니다. [서울시 침수흔적도](https://data.seoul.go.kr/dataList/OA-15636/F/1/datasetView.do) · [단지 경계](https://www.openstreetmap.org/way/1079940834) · [연못](https://www.openstreetmap.org/way/691611266) · [탄천](https://www.openstreetmap.org/way/768407483)

## 실행

```sh
npm --prefix frontend ci
npm --prefix frontend run dev
```

브라우저에서 http://127.0.0.1:3000 을 열면 오포 수레실길의 보행 시점에서 시작합니다. 화면의 **지역 바꾸기**에서 가락동부센트레빌을 선택하거나 http://127.0.0.1:3000/?region=songpa 를 열면 송파대로32길에서 단지를 바라보는 시점으로 입장합니다. PC에서는 WASD나 방향키를 쓰고, 휴대폰에서는 걷기 조이스틱과 운전 버튼을 사용합니다. 가까운 바닥을 누르면 해당 위치로 걸어갑니다. 오포의 **동네 드라이브**는 단지 입구에서 수레실 정류장을 거쳐 능평도서관까지 연결된 도로를 따라갑니다. [HRUM의 3D 웹사이트 제작과 이동 조작 가이드](https://hrum.ai/spaceEbook/)

```sh
npm --prefix frontend run build
```

로컬에서 같은 지역의 아바타와 채팅을 공유하려면 프로덕션 빌드 후 WebSocket 서버를 실행합니다.

```sh
npm --prefix frontend run serve:tour
```

브라우저 두 탭에서 http://127.0.0.1:4295 를 열고 같은 지역에 입장합니다. 각 탭에서 **함께 임장 → 함께 임장 입장**을 선택하면 접속 인원과 다른 참가자의 걷기·운전 상태를 볼 수 있습니다. 메시지는 접속한 방으로 전송하며 서버에 기록하지 않습니다. 오포와 송파는 별도 방입니다. [ws](https://github.com/websockets/ws) · [sirv](https://github.com/lukeed/sirv)

Sites용 빌드는 `frontend/dist`에 브라우저 파일과 동행 Worker를 생성합니다. Worker는 D1과 같은 출처의 HTTPS 요청을 사용합니다. 지역 방은 최대 24명이 참여할 수 있으며, 연결이 끊긴 참가자는 마지막 업데이트 후 약 25초 뒤 목록에서 빠집니다. 방에 입장한 뒤에 도착한 채팅만 표시합니다.

Node WebSocket 서버를 따로 배포할 경우 `TOUR_HOST`와 `PORT`로 바인딩 주소와 포트를, `TOUR_ORIGINS`로 허용할 HTTPS 출처를 지정합니다.

## 오포 데이터와 계산

일조 비교의 **그늘 원인 보기**를 누르면 선택 지점과 햇빛이 처음 닿는 건물 체적 또는 지형이 3D에 표시됩니다. A·B 지점의 시간 막대를 누르거나 키보드로 조절해 같은 시각의 경로를 볼 수 있습니다. 미판정 방향은 점선으로 표시하며, 밤에는 경로를 숨깁니다.

**주변 자연환경 → 수목 피복**에서 오포 중심 2.5km × 2.5km의 2025년 수목 분류를 3D 지형 위에 겹쳐 볼 수 있습니다. Sentinel‑2 기반 10m 토지피복 자료를 EPSG:5186으로 최근접 재투영했습니다. 3D 숲은 해당 분류 셀에 배치한 시각 모델이며 개별 수목의 위치·수종·높이는 추정입니다. 일조와 시야는 지형·건물 자료로 계산합니다. `node frontend/scripts/prepare-opo-tree-cover.mjs`로 원본 범위를 다시 추출할 수 있습니다. [Esri · Impact Observatory · Microsoft 토지피복](https://livingatlas.arcgis.com/landcover/) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

**같은 지점의 계절별 일조**는 A나 B의 좌표와 지면 기준 1.5m 높이를 고정하고, 선택한 해의 3월 21일, 6월 21일, 9월 23일, 12월 21일을 비교합니다. 하루 직사광과 미판정 시간은 10분 표본에서 합산합니다. 공통 시각의 차폐 원인은 **3D에서 보기**로 확인할 수 있습니다.

**단지 일조 분포**는 지도상의 단지 경계 안에서 8m 간격으로 추출한 실외 표본을 조감 화면에 표시합니다. 선택한 날짜와 시각의 직사광, 건물 그늘, 지형 그늘, 미판정과 야간을 구분합니다. A·B의 위치 선택을 켜고 표본을 누르면 같은 좌표의 하루 일조 결과가 열립니다. 8m는 표본 간격이며, 지형 자료의 원 해상도는 약 30m입니다.

주변 자연환경의 **공원 인근 도로 연결**에서 경로를 열면 50m 간격으로 계산한 지형 단면을 볼 수 있습니다. 단면 슬라이더로 위치를 고르면 3D 표식이 함께 움직이며, 선택 위치에서 경로 방향의 눈높이 시점을 열 수 있습니다. 표고와 변화율은 약 30m 지형 모델에 기반합니다. 공원 출입구와 보도 연결, 실제 노면 경사는 추가 대조가 필요합니다.

101~104동은 공개 외관 사진을 참고해 회백색 벽, 세로 장식, 층 사이 띠와 열린 지붕 탑으로 표현합니다. 사진 출처와 GIS 윤곽에서 선택한 기준 면은 `frontend/public/opo-architecture.json`에 기록했습니다. 탑의 위치·크기와 창·띠 간격은 근사이며, 단지 시설의 자료에서 원본 사진을 열 수 있습니다.

수레실길의 정문과 진입교는 2025년 12월 촬영 로드뷰를 참고해 석재 아치, 경비실, 흰 난간, 보도와 횡단보도를 입체화했습니다. 위치 기준은 지도상의 도로 중심선이며, 시설물 치수와 교량 단차는 시각 모델의 근사값입니다. 일조 계산은 등록 높이의 건물 체적과 지형을 사용합니다. [카카오맵 정문 로드뷰](https://map.kakao.com/link/roadview/37.351201,127.165458) · [OpenStreetMap 진입교](https://www.openstreetmap.org/way/835665646)

정문의 석재는 색상·표면 굴곡·거칠기 지도를 사용해 가까이에서 질감이 보이도록 표현했습니다. 접촉 그림자는 지원되는 데스크톱의 오포 걷기·운전에서 Three.js r187 GTAO로 표현합니다. 화면 해상도와 접촉 그림자 계산 해상도에 상한을 두었습니다. [Poly Haven Granite Tile 03 · CC0](https://polyhaven.com/a/granite_tile_03) · [Three.js r187](https://github.com/mrdoob/three.js/releases/tag/r187)

- **건물** · QGIS 편집본의 214개 건물 윤곽·높이 후보와 OSM의 주변 건물 윤곽 2,014개를 대조해 범위 안에 겹치지 않는 건물을 3D로 표시합니다. 2026년 10월 건축물대장에서 확인한 101~104동의 높이는 모두 46.78m이며 103동은 14층, 다른 주동은 15층입니다. 모델의 외벽 층간 간격에 이 층수를 사용했습니다. 갈색 경사지붕과 창호는 공개 단지 사진을 참고해 표현했습니다. 대장 건축면적과 3D 도형 면적 차이를 단지 시설 탭에서 확인할 수 있습니다. [건축HUB 표제부](https://www.hub.go.kr/portal/opn/tyb/idx-bdrg-ttlldr.do) · [호갱노노 단지 사진](https://hogangnono.com/apt/6AD09) · [KB부동산 단지 사진](https://kbland.kr/se/c/21160)
- **동네 도로와 장소** · OSM 원본의 도로·보행로 711개, 지도상 위치 385개, 주차장 윤곽 12개를 로컬 좌표로 변환합니다. 운전은 동일 OSM 노드에서 연결된 차량 통행 구간을 따라가고, 자동 주행은 기록된 일방통행도 적용합니다. 보도·횡단보도·정류장은 위치와 태그를 사용하며 페인트와 표지 디자인, 기록이 없는 폭과 교량 높이는 시각 모델입니다. 동네를 구성하는 방식은 Bumpinto World, 운전 조작과 시점은 차멍을 참고했습니다. [OSM 도로 자료](https://www.openstreetmap.org/api/0.6/map.json?bbox=127.1497,37.3392,127.1788,37.3624) · [Bumpinto World](https://github.com/dohoon84/bumpinto-world) · [차멍](https://metamoa.com/s/car-meong-soosang-party-mw7er2bm)
- **101·104동 중정** · 항공영상에서 원형 개구부와 서쪽 파란 포장 공간을 주동 윤곽과 대조했습니다. 공개 사진의 원형 하부 계단, 놀이기차, 세 단의 석재 물길과 데크 쉼터를 모델링했습니다. 남쪽 정원의 목재 계단은 걸어서 내려갈 수 있습니다. 시설물의 깊이와 고도는 시각 모델의 근사값이며, 실외 일조는 지형과 등록 건물 높이로 계산합니다. [단지 전경](https://kbland.kr/se/c/21160) · [정원 사진](https://hogangnono.com/apt/6AD09) · [항공영상 출처](https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer)
- **자연환경과 진입로** · OpenFreeMap/OpenMapTiles에 포함된 © OpenStreetMap contributors 데이터에서 도로, 녹지, 수계를 가져옵니다. 줌 14 스냅샷을 사용하며 타일 빌드 식별자와 추출 범위는 `frontend/public/opo-environment.geojson`의 메타데이터에 있습니다. 도로 폭과 수계 표현은 화면용이며 녹지와 수계까지의 거리는 직선거리입니다. [OpenStreetMap 데이터 이용 조건](https://www.openstreetmap.org/copyright)
- **공원 인근 도로 연결** · 단지 진입부에서 능평3통 쌈지공원 및 능평8통 체육공원 인근까지 OSM에서 실제로 이어진 도로를 표시합니다. 두 경로는 보도 연결을 확인할 수 없어 점선으로 표시하며, 거리는 도로망 기준입니다. [쌈지공원 등록 위치](https://platformdodam.com/children-play-facilities/10830) · [능평8통 체육공원 지도](https://www.openstreetmap.org/way/1266958183)
- **위성영상** · 2026-10-08 Sentinel-2 L2A 10m 영상을 오포 주변으로 자르고 건물과 같은 좌표계로 변환했습니다. 자연환경 탭의 **위성영상**에서 켤 수 있습니다. Contains modified Copernicus Sentinel data 2026. [Sentinel-2 영상 원본 안내](https://registry.opendata.aws/sentinel-2-l2a-cogs/)
- **지형과 직사광** · 렌더링은 [Three.js](https://threejs.org/), 좌표 변환은 [Proj4js](https://proj4js.org/), 태양 위치는 [SunCalc3](https://github.com/hypnos3/suncalc3)를 사용합니다. 지형은 Ho & Hengl의 GEDTM30 v1.1(EGM2008, CC BY 4.0) 오포 부분을 EPSG:5186으로 좌표 변환·보간한 모델입니다. 지면 1.5m 위에서 건물과 지형이 태양을 가리는지 한국 시각 기준 10분 간격으로 검사합니다. 주동 차폐는 등록 높이와 현재 평면 윤곽을 합친 단순화 체적을 사용합니다. 높이가 없는 주변 건물의 차폐 가능성과 판정이 어려운 시간도 표시합니다. [GEDTM30 원자료](https://zenodo.org/records/15689805)
- **방향별 시야** · 주변 자연환경 탭에서 8방향을 선택해 두 지점의 지형 단면과 차폐각을 비교합니다. 차폐각은 눈높이 1.5m에서 선택 방향 800m 안의 지형과 높이가 있는 건물 지붕이 수평선 위를 가리는 각도입니다. 건물이 더 높게 보이면 지형만 적용한 각도를 함께 표시합니다. 3D에서 그 방향을 눈높이로 볼 수 있습니다. 주변 건물의 높이 자료 범위가 제한되며, 선택 방향에서 높이 미확인 윤곽을 만나면 가장 가까운 위치까지의 거리를 표시합니다. [GRASS GIS 지평선 각도 계산 원리](https://grass.osgeo.org/grass-stable/manuals/r.horizon.html)

데이터 생성 스크립트는 `frontend/scripts`에 있습니다. `node frontend/scripts/prepare-opo-streets.mjs`는 OSM 원본에서 도로·장소·주변 건물 자료를 함께 갱신합니다. `node frontend/scripts/prepare-opo-terrain.mjs`는 공개 지형을 잘라 90m 기준과 대조합니다. 건물·DEM의 전처리와 자료 상태는 [데이터 안내](data/README.md), 전체 구현 범위와 검증 항목은 [기획서](docs/planning/2026-11-17-complex-online-tour-spec.md)에 있습니다.

## 지역과 건물 데이터 작업

오포·송파 건물 윤곽은 지역별 QGIS 편집본에서 생성한 manifest를 통해 불러옵니다. `/polygons`에서 지역별 건물 자료를 검토할 수 있습니다. 송파는 OpenFreeMap의 도로와 주변 장소를 사용하며, 높이가 미확인된 건물은 평면 윤곽으로 표시합니다. [지역 데이터 생성](docs/region-tour-pipeline.md) · [폴리곤 파이프라인](docs/building-pipeline.md)
