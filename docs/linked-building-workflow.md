# 도형과 건물대장 속성 연결

연속수치지형도 UFID 도형을 기준으로 유지하고, GIS건물통합정보의 높이·이름·동·주소·용도를 연결합니다. 층수는 NMLY를 유지하며 실제 높이로 환산하지 않습니다. 기존 두 원본 및 이전 QGIS 파일은 변경하지 않습니다.

## 실행

```sh
# 처음 한 번: 원본 범위 추출 → 대응 후보 생성 → QGIS 편집본
.venv/bin/python -m backend.pipeline init --config data/config/buildings/songpa-linked.json
.venv/bin/python -m backend.pipeline init --config data/config/buildings/jamsil-linked.json

# QGIS 저장 후: 품질 검사와 경량 웹 파일 재생성
.venv/bin/python -m backend.pipeline check --config data/config/buildings/songpa-linked.json
.venv/bin/python -m backend.pipeline build --config data/config/buildings/songpa-linked.json
```

이미 생성한 편집본에는 init을 다시 실행하지 않습니다. 새 지역은 설정의 source/fields/center/radius와 `attributes_config`를 지정합니다. 속성 원본은 기준 반경보다 100m 넓게 읽어 경계부 매칭 누락을 줄입니다. 같은 건물이라고 식별하는 공통 키는 아직 확인되지 않아 공간 대응 후보를 사용합니다.

## 연결 조건

EPSG:5186에서 공간 인덱스로 교차 후보를 찾습니다. 교차 면적 1㎡ 초과 및 둘 중 하나의 도형 면적 대비 10% 이상인 후보만 비교표에 남깁니다. 자동 속성 연결 후보는 다음 조건을 모두 만족해야 합니다.

- IoU(교차면적 / 합집합면적) ≥ 0.70
- 기준 도형·속성 도형 각각의 면적 대비 교차면적 ≥ 0.80
- 1순위와 2순위 IoU 차이 ≥ 0.15
- 두 자료에 층수가 있으면 일치
- 두 자료에 이름이 있으면 공백 제거 후 일치
- 동일 속성 레코드를 여러 기준 도형에 자동 할당하지 않음

최근접 거리만으로 연결하지 않습니다. 작은 부속 도형이 큰 아파트 높이를 상속하지 않도록 양쪽 도형의 면적 비율을 검사합니다. 이 조건은 **실험적인 데이터 연결 기준**이며 건물 동일성을 보증하지 않습니다. 모든 자동 연결은 pending/candidate로 남깁니다. 기존 기준 도형의 값은 보존하고 비어 있는 필드만 보완합니다.

## QGIS 파일

- `data/working/buildings/songpa-linked/buildings.gpkg`
- `data/working/buildings/jamsil-linked/buildings.gpkg`

`buildings` 레이어가 편집 기준입니다. `attribute_source`에는 속성 원본의 표준화 레코드와 도형이 있습니다. `link_candidates`는 후보 ID·IoU·각 도형의 중첩률·중심거리 비교표입니다. 초기 생성 요약은 같은 폴더의 link-summary.json, 현재 상태는 check/build의 quality.json에 기록합니다.

| 컬럼 | 의미 |
|---|---|
| bldg_id | 도형 기준 UFID, 변경 금지 |
| candidate_id | 가장 높은 점수의 속성 후보 ID, 미연결이어도 참고용으로 유지 |
| attr_id | 실제 속성을 가져온 기존 자료의 ID |
| link_status | candidate / unmatched / geometry_ambiguous / floor_conflict / name_conflict / shared_attribute / verified / rejected |
| link_iou, base_cover, attr_cover, link_margin | 점수 및 2순위와의 차이 |
| topo_name, topo_floors, topo_anno | 새 원본의 이름·층수·주기 보존 |
| height_basis | attribute_candidate(자동 연결 후보), base_source, 또는 수기 편집 시 manual |
| name_basis, dong_basis, address_basis, use_basis | 필드별 연결 출처 |
| rev_status, rev_note, rev_date | 사용자 검증 상태·근거·확인일 |

후보가 맞으면 link_status와 rev_status를 verified로 설정하고 근거·날짜를 입력합니다. 애매한 후보는 비교 레이어와 현장 근거를 대조해 attr_id 및 필요한 속성을 직접 입력합니다. 잘못된 연결은 rejected로 바꾸고 복사된 높이 등을 지우세요. 직접 확인한 높이로 대체했다면 height_basis=manual과 검증 근거를 기록합니다. rejected 상태에서 attribute_candidate 높이가 남아 있으면 build가 중단됩니다. verified 연결은 실제 존재하는 속성 원본 ID와 검증 근거가 필요합니다.

검증용 웹 파일에는 `attr_id`, `link_status`, `height_basis`를 포함합니다. 상세 대응표와 검증 메모는 QGIS에 보관합니다. 공간 연결은 전처리에서 한 번 계산하며, 원래 도형 기준 파일과 연결본의 웹 출력은 별도 경로로 보관합니다.

## 현재 결과 (수기검증 전)

| 구역 | 기준 도형 | 연결 후보 | 높이 연결 | 높이 미확인 |
|---|---:|---:|---:|---:|
| 잠실 350m | 409 | 22 | 19 | 390 |
| 송파 600m | 2,096 | 481 | 264 | 1,832 |

미연결 도형은 삭제하지 않고 높이 없이 평면으로 표시합니다. 새 자료에는 작은 부속 도형도 포함돼 있어 높은 미연결 비율이 곧 오류를 뜻하지 않습니다. 반대로 연결 후보의 값도 QGIS 검증 전까지 확정 높이로 간주하지 않습니다.

`/polygons`에서 송파 연결본·잠실 연결본·기존 송파 표본을 선택해 비교할 수 있습니다. 송파 연결본은 기존 DEM·도로와 동일한 좌표계 및 원점을 사용합니다. 가락동부센트레빌 운영 임장은 별도의 경량 수치지형도 파일과 검토한 101~105동 ID 대응표를 사용하며, 일조·시야에는 기존 GIS 높이 표본을 사용합니다. 자동 속성 연결 후보는 운영 분석으로 승격하지 않습니다. [운영 데이터 구성](region-tour-pipeline.md)을 참고하세요. 잠실 연결본은 르엘 동별 구성을 확정한 자료가 아닙니다.
