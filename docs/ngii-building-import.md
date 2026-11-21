# 연속수치지형도 건물 ZIP 사용

사용자 제공 `(연속수치지형도)건물_001.zip`을 기존 AL_D198과 별도로 보관했습니다. 이전 원본·QGIS 작업·웹 장면은 덮어쓰지 않았습니다.

- raw: `data/raw/buildings/ngii-buildings-202610/`
- 원본: ZIP 그대로, 약 241MiB. 풀면 약 1.96GB / 2,200,000개 도형.
- 실제 CRS: EPSG:5179. 파이프라인 내부 검증·거리는 EPSG:5186으로 변환.
- ID: UFID, 건물명: NAME, 층수: NMLY. ANNO에는 동·시설명 등의 주기가 있으나 자동으로 동 이름으로 간주하지 않습니다.
- 높이(m) 컬럼은 없음. NMLY는 높이가 아니며 임의 환산하지 않음.
- 원본 페이지: https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=MK&dsId=30162 (확인 당시 CC BY).

번호는 행정구역 코드가 아닙니다. 001~011의 지역 배치를 번호만으로 가정하지 않습니다. 현재 001만 받았으므로 전국 완전성을 주장할 수 없습니다. 가능하면 VWorld의 `시도별_건물_파일_목록.xlsx`도 함께 확보해 필요한 분할 파일을 선택합니다.

## 새 ZIP 넣기

```sh
.venv/bin/python -m backend.pipeline.import_zip '/절대경로/(연속수치지형도)건물_002.zip' --dataset ngii-buildings-202610
```

원본을 복사하고 SHA256·CRS·컬럼·도형 수·범위를 inventory.json에 기록합니다. 같은 이름의 파일 내용이 바뀌면 중단하여 새 버전 폴더를 쓰도록 합니다. 압축 해제하지 않으며 GDAL `/vsizip/`과 내부 QIX로 관심 범위만 읽습니다. ZIP/원본은 Git과 브라우저 전송에서 제외됩니다.

단일 파일 설정의 `source`에 ZIP 경로를 지정하고 해당 SHP의 `source_layer`를 넣습니다. 여러 분할을 검사하려면 설정에 `sources: ["data/raw/...001.zip", "data/raw/...002.zip"]`을 추가합니다. `source`는 대표 경로로 유지합니다. 각 ZIP에서 같은 관심 범위만 읽고 UFID가 같은 완전 동일 레코드만 합칩니다. 같은 UFID의 형상·속성이 다르면 자동 선택하지 않고 중단합니다. 분할 수가 많으면 접근 비용도 늘어나므로 필요한 지역의 파일을 우선 지정합니다.

## 잠실 주변 기술 검증 표본

```sh
.venv/bin/python -m backend.pipeline init --config data/config/buildings/jamsil-topo001.json
.venv/bin/python -m backend.pipeline build --config data/config/buildings/jamsil-topo001.json
.venv/bin/python -m backend.pipeline.compare --existing data/config/buildings/songpa.json --candidate data/config/buildings/jamsil-topo001.json
```

이미 생성한 파일에 init/compare를 다시 실행하면 QGIS 작업 보호를 위해 중단합니다. QGIS 편집·검증 후에는 check/build를 실행합니다.

현재 검색 기준점의 350m 원과 교차하는 409개를 `data/working/buildings/jamsil-topo001/buildings.gpkg`로 만들었습니다. 모두 층수가 있으나 높이는 NULL입니다. 이 중심은 기술적 검색 기준이며 잠실 르엘의 확정 중심점·단지 경계가 아닙니다. NAME/ANNO에서 르엘·미성·크로바 명칭은 확인하지 못했으며, 이것만으로 도형 누락을 단정하지 않습니다.

`data/working/comparisons/jamsil-topo001/source-comparison.gpkg`에서 기존 AL_D198과 후보 레이어를 겹쳐 확인합니다. 후보의 old_overlap_ratio는 기존 도형과의 면적 중첩 비율이며 check_needed는 20% 미만인 도형을 뜻합니다. 신축 확정 판정이 아니며 작은 시설·도형 제작 차이도 포함합니다. 두 레이어에는 원본 속성도 유지됩니다.

공통 ID 조인은 아직 확인되지 않았지만, 도형 중첩과 층수·이름 일치로 공간 연결 후보를 만드는 기능을 추가했습니다. [두 자료 연결 및 QGIS 검증 안내](linked-building-workflow.md)를 참고하세요. 수치지형도만 써서 별도로 생성하려면 [도형·층수 추출](topographic-footprints.md)을 사용합니다. 층수로 추정한 화면용 높이를 도입할 때는 실제 높이와 별도 필드로 저장하고 추정임을 표시해야 합니다.
