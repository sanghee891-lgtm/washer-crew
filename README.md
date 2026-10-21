# 세탁기 크루

세탁기·건조기 세척과 이전설치 업체에서 직원들이 함께 쓰는 **예약 및 월별 매출 관리 장부**입니다.
claude.ai 공유 페이지(Artifact)로 동작하며, 데이터는 Artifact의 공유 저장소(`db`)에 실시간으로 저장됩니다.

- 배포 주소: https://claude.ai/artifact/Wiyd1f9hP4hDa4E556K6C2
- 개발: 신창민

## 기능
- 예약 목록: 날짜·시간·소요시간·고객(전화·주소)·기기종류/모델/대수·작업·금액·결제·참여 직원을 카드(휴대폰)/표(PC)로 표시, 추가·수정·삭제
- 기기 구분: 통돌이 / 삼성 2단 / LG 2단 / 빌트인 / 건조기 / 세탁기, 작업: 세척 / 이전설치 / 철거 / 기타
- 직원 참여 체크(필요 인원 n/m명), 같은 직원 시간 겹침 경고, 동시 수정 경고
- 빠른 처리: 완료, 입금확인(되돌리기 가능)
- 달력 보기, 오늘 / 내 일정 / 인원 부족 / 미수금 필터, 올해 전체 검색
- 월별 통계: 건수, 완료·예정 매출, 미수금, 기기별 대수, 작업별 건수, 직원별 참여, 12개월 그래프, CSV(엑셀) 내보내기
- 전화번호로 고객 이전 작업 이력 불러오기, 현장 정보(층수·엘리베이터·주차)
- 주소 → 티맵 / 카카오내비 / 카카오맵 / 네이버지도 열기(휴대폰마다 "내 내비 앱" 선택)

## 파일
| 파일 | 내용 |
|---|---|
| `index.html` | 화면 구조와 스타일(로고 색: 네이비 #00419B, 밝은 파랑 #0693F8, 폰트 Noto Sans KR) |
| `app.js` | 화면 렌더링·이벤트·공유 저장소 연동(`claude.use("db" / "user" / "downloads")`) |
| `core.js` | 순수 계산 로직(시간·겹침·집계·CSV·내비 링크), 브라우저·Node 공용 |
| `assets/` | 로고 이미지 |
| `test/` | 단위 테스트, 브라우저 E2E 테스트, 가짜 claude 런타임 |

## 데이터 구조 (Artifact db)
- `reservations/{id}`: 예약 1건 (`date`, `time`, `durationMin`, `status`, `customer`, `phoneDigits`, `site`, `items[]`, `total`, `payment`, `needed`, `workers{직원id: true}`, `note`, `createdBy/At`, `updatedBy/At`)
- `config/staff`: 직원 명단 `{ list: [{ id, name }] }`
- `data/users/{계정id}/me`: 계정별 "내 이름"(본인만 읽음)

## 테스트
```bash
node test/core.test.js     # 계산 로직
node test/e2e.test.js      # Playwright로 휴대폰·PC 화면 조작 (playwright 필요)
```
E2E 테스트는 `PLAYWRIGHT_PATH`로 playwright 모듈 위치를, 스크린샷 폴더는 `SHOTS`로 바꿀 수 있습니다.

## 수정·배포
Artifact 편집자 권한이 있는 사람이 Claude 대화에 배포 주소를 주고 수정을 요청하면, 같은 주소로 다시 게시됩니다.
게시할 때 `core.js`, `app.js`, `assets/*`를 함께 올리고 capabilities는 `{ db: {}, user: {}, downloads: true }`입니다.
