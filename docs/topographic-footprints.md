# 수치지형도 건물 도형과 층수

국토지리정보원 [연속수치지형도 건물](https://www.data.go.kr/data/15125047/fileData.do)의 VWorld 배포 ZIP에서 지정한 반경에 걸치는 폴리곤 전체와 층수를 추출합니다. 시군구 전체를 브라우저에 보내거나 ZIP을 풀지 않습니다.

| 저장 위치 | 용도 |
|---|---|
| `data/raw/buildings/ngii-buildings-202610/` | 사용자 제공 원본 ZIP 및 출처 목록 |
| `data/working/buildings/{지역}-topo-footprints/buildings.gpkg` | QGIS 편집용 원본 도형(EPSG:5186), 층수, 이름, 검증 메모 |
| `data/processed/buildings/{지역}-topo-footprints/quality.json` | 출처, 도형 수, 결측 및 검증 상태 |
| `data/processed/buildings/{지역}-topo-footprints/web/` | EPSG:4326 경량 GeoJSON과 조각별 범위·크기·해시를 담은 manifest |

경량 GeoJSON은 `geometry`, `id`(원본 UFID), `floors`(원본 NMLY)로 구성합니다. ID는 QGIS 수정 내역이나 다른 속성 자료를 연결하는 데 필요합니다. 0과 빈 층수는 NULL로 남깁니다. 건물명은 찾기 편하게 QGIS에만 둡니다. 주소와 용도는 검색·분류가 필요할 때 별도 연결할 수 있습니다.

층수로 높이가 다른 건물을 시각화할 수는 있습니다. 절대 높이, 일조·조망 계산에는 층수가 아닌 확인한 `height_m`이 필요합니다. 현재 원본에는 미터 단위 높이 컬럼이 없고 값을 추정하지 않습니다.

경량 출력의 도형은 개별 면적 변화가 1% 이내인 경우에만 10cm 단순화를 적용합니다. 경위도는 소수점 7자리로 줄이되 도형이 유효하고 면적 변화가 1% 이내일 때만 적용합니다. 좁거나 복잡한 도형을 제거하지 않으며 QGIS 도형은 단순화하지 않습니다.

## 실행과 지역 추가

```sh
.venv/bin/python -m backend.pipeline prepare --config data/config/buildings/topo/songpa.json
.venv/bin/python -m backend.pipeline prepare --config data/config/buildings/topo/jamsil.json
.venv/bin/python -m backend.pipeline prepare --config data/config/buildings/topo/opo.json
```

첫 실행은 QGIS 편집 파일을 만들고 경량 출력을 생성합니다. 다시 실행하면 기존 편집 파일을 읽어 출력만 갱신합니다. QGIS에서 수정한 층수는 `floors`에 저장하고, 검증 근거는 `rev_note`, `rev_date`, `rev_status`에 남깁니다. 설정이나 원본판을 교체하려면 새 `region` 값으로 실행합니다.

새 지역은 `data/config/buildings/topo/`의 설정 하나를 복사해 `region`, `center_lnglat`(경도, 위도), `radius_m`, `source`, 출처 설명을 바꿉니다. 여러 분할 ZIP이 필요하면 `sources` 배열에도 경로를 지정합니다. 동일 UFID의 완전히 같은 레코드는 합치며, 도형·속성이 서로 다르면 검토할 수 있도록 중단합니다. [원본 ZIP 등록 방법](ngii-building-import.md)을 참고하세요.

이번 출력은 제공받은 001 파일의 지역 표본입니다. 잠실은 특정 단지 경계가 확인된 표본이 아니고, 오포는 현재 ZIP의 부분 수록 범위입니다. 넓히려면 해당 지역을 포함하는 다른 분할 ZIP이 필요합니다.

송파 운영 화면용 경량 조각도 생성하려면 송파 명령에 `--publish-compact`를 붙입니다. 로컬 `frontend/public`에 동일한 출력이 추가되며 호스팅 배포는 실행하지 않습니다. 송파는 화면용 도형과 일조 분석용 높이 표본을 분리합니다. [지역 데이터 및 동별 대응표](region-tour-pipeline.md)를 참고하세요.

## 원본 보관과 반경의 차이

001번 ZIP에 들어 있는 220만 개 도형과 원본 속성은 `data/raw/`에 모두 보관합니다. 전국 자료 전체를 확보한 상태는 아닙니다. 350m는 오포·잠실 샘플을 만들 때 선택한 추출 반경이며, 송파·가락동은 600m를 사용합니다. 반경과 교차하는 도형은 일부만 겹쳐도 도형 전체를 가져옵니다. 지역 설정의 `radius_m`을 바꾸면 다른 범위를 추출할 수 있습니다. QGIS에서 편집 중인 출력이 있다면 새 `region` 이름을 사용합니다.

광역 서비스가 필요하면 전체 원본은 그대로 두고 시군구별 또는 공간 타일별 경량 파일을 만들어 필요한 범위만 로드하는 편이 적합합니다. 현재 전처리는 지정한 반경의 조각을 만들며 전국 화면 범위를 따라 타일을 요청하는 기능은 아직 없습니다.

## 001번 ZIP 속성 사전

로컬 SHP의 15개 속성 칼럼과 실제 값을 확인했습니다. 도형은 별도의 Polygon 지오메트리(EPSG:5179)입니다. 필드 의미는 [건물 데이터 정의서 표 6-11](https://www.codil.or.kr/filebank/original/RK/OTKCRK230259/OTKCRK230259.pdf)을 참고했으며, 아래 결측은 송파·가락동 600m 표본 2,096개 기준입니다.

| 원본 칼럼 | 형식 | 의미와 현재 용도 |
|---|---|---|
| `UFID` | 문자열 | 원본 지형지물 ID. QGIS의 `bldg_id`, GeoJSON의 `id`로 사용 |
| `BJCD` | 문자열 | 법정동 코드. 지역 분류와 분할에 활용 가능 |
| `NAME` | 문자열 | 건물 명칭. QGIS의 `name`으로 복사. 표본에서 1,384개 비어 있음 |
| `DIVI` | 문자열 | 구분. 표본 전체가 비어 있음 |
| `KIND` | 문자열 | 건물 종류 코드. 코드표 확인 후 분류에 활용 가능 |
| `SERV` | 문자열 | 건물 용도 코드. 코드표 확인 후 분류에 활용 가능 |
| `ANNO` | 문자열 | 지도에 표기하는 주기. 건물 동 번호로 자동 매핑하지 않음 |
| `NMLY` | 정수 | 층수. QGIS와 GeoJSON의 `floors`로 사용 |
| `RDNM` | 문자열 | 도로명 관련 값. 표본에서는 숫자 문자열이므로 실제 도로명으로 바로 표시하지 않음 |
| `BONU` | 정수 | 건물번호 본번 |
| `BUNU` | 정수 | 건물번호 부번 |
| `POST` | 문자열 | 우편번호. 표본 전체가 비어 있음 |
| `SCLS` | 문자열 | 통합 분류 코드 |
| `FMTA` | 문자열 | 제작 정보 코드 |
| `GIDN` | 문자열 | 원본에 있는 별도 칼럼. 표본 전체가 비어 있고 정확한 정의 미확인. 조인에 사용하지 않음 |

현재 **QGIS 편집본**은 도형과 `bldg_id`, `name`, `floors`를 가져옵니다. 추가 확인용 `dong`, `address`, `height_m`, `use`는 이 전처리에서 비워두고, `rev_status`, `rev_note`, `rev_date`로 검증을 기록합니다. **경량 GeoJSON**에는 도형과 `id`, `floors`만 넣습니다. 지역별 관리에 `BJCD`, 검색에 검증된 건물명·주소, 주거·상업 구분에 `KIND`·`SERV`가 필요해지면 별도 속성으로 추가할 수 있습니다.
