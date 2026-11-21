# Find My Shelter 문서 안내

아파트를 보러 가기 전에 동네를 3D로 걸어보고, 겨울에 볕이 드는 곳이나 역에서 집까지의 오르막을 살펴보는 프로젝트입니다. 처음에는 모바일용 안내에서 한 번의 임장이 어떻게 만들어지는지 보고, 관심 있는 자료를 골라 읽을 수 있습니다.

[프로젝트 전체 안내](https://find-my-shelter-opo-tour.roankoala1.chatgpt.site/docs/project-architecture/) · [서울 단지 목록과 3D 임장](https://find-my-shelter-opo-tour.roankoala1.chatgpt.site/seoul/)

**[클릭하는 데이터 연결 그래프](https://find-my-shelter-opo-tour.roankoala1.chatgpt.site/docs/project-architecture/#flow)**에서 건축물대장, 지형, 도로 같은 상자를 누르면 어디서 가져오고 어떤 파일이나 임장 화면을 만드는지 확인할 수 있습니다. [건축물대장이 연결되는 예](https://find-my-shelter-opo-tour.roankoala1.chatgpt.site/docs/project-architecture/#node-registry)

공간 데이터의 출처와 확인 범위를 다루는 원칙, 공동으로 쓰는 `main`의 작업 절차는 [프로젝트 전역 규칙](../AGENTS.md)에 있습니다. 차선 원본과 렌더링은 [차선과 포장 이음새](region-tour-pipeline.md#차선과-포장-이음새)에서 확인할 수 있습니다.

## 한 번의 임장이 만들어지는 과정

1. 공개 자료에서 단지 목록, 건물의 모양과 높이, 도로와 지형을 가져옵니다.
2. 서로 다른 자료의 위치와 식별자를 맞추고, 확인되지 않은 부분을 기록합니다.
3. 같은 동네에서 함께 쓰는 지도와 지형, 각 단지에 필요한 정보를 웹용 파일로 준비합니다.
4. 단지를 선택하면 브라우저에서 3D 장면을 그리고, 실외 일조와 시야, 확보된 보행 경로를 표시합니다.

서울 25개 구의 K-apt 목록 3,158곳을 검색할 수 있고, 이 중 4개 구 10곳에 공개 3D 장면이 있습니다. 6곳에는 보행 경로와 고도 단면도 연결돼 있습니다. 상세 범위와 기준일은 아래 서울 데이터 현황에서 확인할 수 있습니다.

## 무엇을 만들고 있나

- [프로젝트를 시작한 이유](planning/2026-11-15-why-find-my-shelter.md) — 처음의 아이디어가 어떤 집 구하기 문제로 이어졌는지 살펴봅니다.
- [온라인 임장 기획과 체크리스트](planning/2026-11-17-complex-online-tour-spec.md) — 현장에서 확인할 14개 항목과 온라인에서 확인할 수 있는 범위를 정리했습니다.
- [서울 전역 확장안](planning/2026-11-21-seoul-rollout-plan.md) — 동네 데이터를 함께 쓰고, 준비된 단지부터 공개하는 기준을 정리했습니다.

## 데이터를 읽고 싶을 때

- [공동주택 기본정보 · K-apt](data/kapt-complexes.md) — 아파트의 주소, 세대수, 주차, 관리비 자료가 어디서 오는지 확인합니다.
- [검색 조건과 실거래 자료](data/tour-matching.md) — 예산과 생활 조건으로 후보를 고르는 방법을 알아봅니다.
- [도로·차선 데이터 기준과 공개 장면 점검](data/road-markings.md) — 11개 공개 장면의 도색 손실을 비교하고 도로·차선 연결과 갱신 기준을 설명합니다.
- [서울 단지별 데이터 현황](planning/2026-11-21-seoul-tour-coverage.md) — 목록 수와 주동 윤곽·3D·보행 경로 제공 범위를 확인합니다.
- [경기도 건물 데이터 항목 조사](data/gyeonggi-columns.md) — 초기에 경기도 건물 파일을 해석하며 어떤 항목을 점검했는지 남긴 기록입니다.

## 3D 장면을 만드는 방법

- [건물 파일 만들기](building-pipeline.md) — 지도 속 건물 윤곽에 높이와 층수를 연결하고 웹용 파일로 내보내는 과정을 봅니다.
- [한 지역의 3D 장면 만들기](region-tour-pipeline.md) — 건물·지형·도로를 하나의 장면으로 연결하고 검사하는 방법입니다.
- [잠실 르엘 제작 사례](planning/2026-11-21-jamsil-leel-build.md) — 신축 단지에 공개 지도를 적용하면서 확보한 모습과 부족한 정보를 살펴봅니다.
- [서울 4개 구에서 확인한 결과](planning/2026-11-21-seoul-pilot-validation.md) — 10개 장면의 제작 결과와 이웃 단지의 높이·보행 경로를 대조한 기록입니다.

## 별도로 조사하고 있는 주제

- [지형의 능선을 찾는 실험 계획](experiments/ridges.md) — 등고선에서 땅의 모양을 읽는 방법과 능선 후보를 검증할 때 볼 조건입니다.
