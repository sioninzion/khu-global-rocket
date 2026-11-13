# 경희대 부수기 🚀

경희대학교 국제캠퍼스 정문에서 로켓을 발사해 캠퍼스 건물에 들이박는 모바일 3D 웹 게임.

## 조작
- **왼쪽 화면 드래그**: 조이스틱으로 로켓 조종 (상하 반전 버튼 있음)
- **오른쪽 화면 누르기**: 부스트 (게이지 소모, 자동 충전)
- PC: 방향키/WASD 조종, Space 부스트

## 특징
- OpenStreetMap 실제 건물 외곽선(553채)과 실제 지형 고도로 만든 국제캠퍼스와 주변
- 주요 캠퍼스 건물은 사진을 참고해 직접 모델링: 정문(개선문과 열주), 중앙도서관·체육대학관 열주, 예술디자인대학 고딕 탑, 선승관 벽돌 원형 경기장, 노천극장, 천문대 돔 등 (`src/models.js`)
- 창문·유리·벽돌·아치는 셰이더로 그림 (`src/facade.js`), 지형은 도로·운동장·건물 자리를 평평하게 다듬고 숲에는 가을 단풍
- 모든 건물(기둥·탑·지붕 포함)은 시작할 때 미리 격자 조각(층 × 2~5m 블록, 약 12만 개)으로 나눠 둠
- 로켓이 박힌 부위 주변 조각만 떨어져 나가고, 받칠 것이 없어진 위쪽 조각과 지붕 보는 무너져 내림
- 충돌 후 정문에서 새 로켓이 자동으로 다시 발사

## 실행
빌드 과정 없는 정적 사이트입니다 (three.js는 CDN에서 불러옴).

```bash
python3 tools/serve.py 8792   # http://localhost:8792
```

## 데이터 다시 만들기
`tools/build_data.py`가 Overpass API에서 받은 OSM 데이터와 AWS Terrain Tiles(Terrarium, z14)를 `data/campus.json`으로 굽습니다.

## 출처
- 지도 데이터 © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL)
- 지형: Mapzen / AWS Terrain Tiles
- 3D 렌더링: [three.js](https://threejs.org)
