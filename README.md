# Find My Shelter (가제)

실제 SHP 건물 데이터를 작은 GeoJSON으로 전처리해 보여주는 지도 샘플입니다.
현재 범위: 오포 롯데캐슬 포레스트 101동과 주변 300m, 214개 건물.

## 데이터 편집

QGIS 편집 대상: `data/working/opo_300m/buildings.shp`.
작업 순서와 칼럼 설명은 [data/README.md](data/README.md)를 참고하세요.

```sh
.venv/bin/python backend/scripts/prepare_sample.py
npm --prefix frontend run dev
```

VS Code의 `터미널 → 작업 실행`에서도 전처리와 미리보기를 실행할 수 있습니다.
QGIS 저장만으로 배포 사이트가 바뀌지는 않습니다. 전처리 후 로컬 확인, 빌드·배포가 필요합니다.

- `backend/scripts/prepare_sample.py`: 현재 샘플 전처리 진입점
- `frontend/public/sample-buildings.geojson`: 자동 생성 출력
- `data/raw/`: 원본 보관
- `data/working/`: QGIS 편집본
- `data/archive/`: 이전 시도·대량 중간 파일, 현재 화면에서 미사용
- `notebooks/`: 현재 편집본 확인용 노트북

현재 공간 정보는 실제 형상·기록된 높이 후보와 Python의 면적·거리 계산입니다.
DEM·하천·통행량·풍수 점수는 아직 연결하지 않았습니다. 백엔드 분석 API 골격은 화면과 미연결입니다.

## 배경지도

MapLibre + OpenFreeMap(OSM) 저채도 도로 스타일을 사용합니다. 배경 건물은 숨기고 QGIS 편집본 건물만 표시합니다. 출처 표시는 지도 우측 하단에 유지합니다. 배경 타일은 인터넷 연결이 필요하고, 로딩 실패 안내와 별개로 샘플 건물은 표시하도록 구성했습니다. 통행량 데이터는 연결하지 않았습니다.

DEM은 `data/raw/dem/`에 보관하고 `prepare_terrain.py`로 샘플 주변만 추출·측정합니다. 자세한 사용법과 미확인 항목은 data/README.md의 고도 DEM 항목에 있습니다. 웹 지형 연결은 아직 미구현입니다.
