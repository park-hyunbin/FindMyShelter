# FindMyShelter

우리 집 작은 숲 · Feng Shui Lab

## 현재 구현 상태

- `frontend/`: Next.js + React + TypeScript 기반 반응형 디자인 시안.
- 직접 그린 SVG 마을·안내 캐릭터, 산/물/집 설명 탭, 숲/물길 표시 전환, 실내 요소 강조, 리포트 소개 팝업.
- 주소 검색은 미연결 안내만 표시합니다. 실제 지도·측정값·점수·배치 분석·신청·결제는 제공하지 않습니다.
- `backend/`: 실제 데이터가 없을 때 측정값과 점수를 null로 반환하는 FastAPI 골격. 프론트와 아직 연결하지 않았습니다.
- 원래 목업 소스는 제공되지 않았으며, 첨부 스크린샷의 정보 구성을 참고해 신규 제작했습니다.

## 프론트엔드

```sh
cd frontend
npm install
npm run dev
```

정적 내보내기: `npm run build` → `frontend/out/`.
스타일은 `app/globals.css`, 화면과 SVG 일러스트는 `app/page.tsx`에 있습니다.
Google Fonts가 차단되면 시스템 글꼴로 표시됩니다. Tailwind는 아직 도입하지 않았습니다.

## 백엔드

Python 3.10 이상:

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

문서: http://127.0.0.1:8000/docs

```sh
curl -X POST http://127.0.0.1:8000/api/v1/analyses \
  -H 'Content-Type: application/json' \
  -d '{"address":"서울특별시 테스트 주소"}'
```

응답은 `status=unavailable`, 모든 측정값과 점수는 `null`입니다.

```sh
cd backend
python3 -m unittest discover -s tests -v
```
