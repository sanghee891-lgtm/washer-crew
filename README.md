# 세탁기 크루

세탁기·건조기 세척과 이전설치 업체에서 직원들이 함께 쓰는 **예약 및 월별 매출 장부**입니다.
휴대폰 홈 화면에 추가해 앱처럼 쓰는 웹앱(PWA)이고, 데이터는 Supabase(서울)에 실시간으로 저장됩니다.

- 호스팅: Cloudflare Pages(이 저장소의 `web/` 폴더를 빌드 없이 그대로 배포)
- 데이터·로그인·사진·알림: Supabase 프로젝트 `washer-crew`(Seoul, Free)
- 고객 예약 링크: `<배포 주소>/book.html`
- 개발: 신창민

## 기능
- 예약 목록: 날짜·시간·소요시간·고객(전화·주소)·기기종류/모델/대수·작업·금액·결제·참여 직원을 카드(휴대폰)/표(PC)로 표시, 추가·수정·삭제
- 기기 구분: 통돌이 / 삼성 2단 / LG 2단 / 빌트인 / 건조기 / 세탁기, 작업: 세척 / 이전설치 / 철거 / 기타
- 참여 / 불참 / 보류 응답(카톡 일정처럼, 필요 인원 n/m명은 참여만 셈), 같은 직원 시간 겹침 경고, 동시 수정 경고
- 수정 권한: 예약을 넣은 사람과 사장님만 수정·삭제·입금확인, 완료·사진·참여 응답은 누구나
- **로그인**: 이름을 누르고 숫자 6자리 비밀번호. 한 번 들어오면 계속 유지. 사장님이 직원 계정·비밀번호 관리
- **고객 예약 링크**(`book.html`): 고객이 이름·연락처·주소·희망 날짜·기기를 적으면 장부 맨 위 "고객 예약 요청"에 표시 → [확정]하면 입력 화면이 채워진 채 열림, [거절]도 가능
- **휴대폰 알림**(앱을 닫아도): 새 예약(넣은 사람 제외), 새 고객 요청, 매일 18:00 "내일 예약 n건 확인 문자"
- **내일 확인 문자**(무료): 고객별로 문구가 채워진 문자 화면 열기·문구 복사·보냄 표시
- 새 예약 알림: 장부를 열어 둔 동안 즉시 알림, 나중에 열면 "새 예약 n건"과 카드 NEW 표시
- 빠른 처리: 완료, 입금확인(되돌리기 가능)
- 달력 보기, 오늘 / 내 일정 / 인원 부족 / 미수금 필터, 올해 전체 검색
- 월별 통계: 건수, 완료·예정 매출, 미수금, 기기별 대수, 작업별 건수, 직원별 참여, 12개월 그래프, CSV(엑셀) 내보내기
- 전화번호로 고객 이전 작업 이력 불러오기, 현장 정보(층수·엘리베이터·주차)
- 주소 → 티맵 / 카카오내비 / 카카오맵 / 네이버지도 열기(휴대폰마다 "내 내비 앱" 선택)
- 이전설치: 출발지(철거하는 곳)와 도착지(설치하는 곳) 주소·층수·엘리베이터
- 작업 사진: 작업 전/후 사진 여러 장 동시 업로드(긴 변 1280px JPEG로 자동 압축), 비공개 보관함, 본인 사진만 삭제(사장님은 전부)

## 파일
| 파일 | 내용 |
|---|---|
| `web/index.html` | 장부 화면 구조와 스타일(로고 색: 네이비 #00419B, 밝은 파랑 #0693F8, 폰트 Noto Sans KR) |
| `web/app.js` | 화면 렌더링·이벤트. 저장소는 `claude.use("db" / "user" / "downloads" / "assets" / "push" / "bookings")`로 받음 |
| `web/supa-db.js` | 위 `claude.use(...)`를 Supabase로 구현한 어댑터 + 로그인 화면(문서형 저장소, 실시간, 사진, 알림, 고객 요청) |
| `web/core.js` | 순수 계산 로직(시간·겹침·집계·CSV·내비 링크·확인 문자 문구), 브라우저·Node 공용 |
| `web/book.html` | 고객 예약 요청 페이지(로그인 없음) |
| `web/sw.js`, `web/manifest.webmanifest`, `web/icons/` | 홈 화면 앱·푸시 알림 |
| `web/config.js` | Supabase 주소와 공개 키(공개해도 되는 값) |
| `web/vendor/supabase.js` | supabase-js 2.118.0 UMD |
| `web/_headers` | Cloudflare Pages 응답 헤더 |
| `supabase/migrations/` | DB 구조·권한 규칙(RLS)·알림 트리거·매일 18시 예약 작업 |
| `supabase/functions/` | Edge Function: `push`(웹 푸시 발송), `staff-admin`(직원 계정·비밀번호) |
| `supabase/tests/rls_check.sql` | 실제 DB에서 권한 규칙을 점검하는 SQL(결과만 보고 모두 되돌림) |
| `test/` | 단위 테스트, 브라우저 E2E 테스트, 가짜 claude 런타임, 가짜 Supabase |

## 데이터 구조 (Supabase)
- `docs(path, coll, data jsonb)`: 예전 Artifact db와 같은 문서형 저장소
  - `reservations/{id}`: 예약 1건 (`date`, `time`, `durationMin`, `status`, `customer`, `phoneDigits`, `site`, `moveTo{address, floor, elevator}`, `items[]`, `total`, `payment`, `needed`, `workers{직원id: true(참여) | "maybe"(보류) | "no"(불참) | false}`, `photos{사진id: {kind: before|after, by, at} | null}`, `note`, `createdBy/At`, `updatedBy/At`)
  - `config/staff`: 직원 명단 `{ list: [{ id, name }] }` (사장님만 수정)
  - `reminders/{예약id}`: 전날 확인 문자 보낸 기록 `{ date, by, at }`
  - `data/users/{계정uid}/me`: 계정별 직원 번호(본인만 읽음)
  - 일부 수정은 `docs_merge(path, patch)`로 서버에서 중첩 병합(동시에 누른 참여 체크가 서로 덮어쓰지 않음)
- `staff_accounts(uid, staff_id, is_owner)`: 로그인 계정 ↔ 직원 번호. 로그인 아이디는 `<직원번호>@washer-crew.local`(메일 안 보냄)
- `booking_requests`: 고객 예약 요청. 고객은 `submit_booking()`으로 넣기만 가능(같은 번호 1분 1회, 숨은 칸 스팸 차단)
- `push_subscriptions`: 휴대폰 알림 구독
- Storage `photos`(비공개): 사진 파일. 화면에는 7일짜리 서명된 주소로 표시
- Vault: `vapid_public`, `vapid_private`, `push_hook_secret`(저장소에 올리지 않음)

## 테스트
```bash
node test/core.test.js     # 계산 로직
node test/e2e.test.js      # 장부 화면 전체(가짜 claude 런타임, Playwright)
node test/web.test.js      # 웹앱: Supabase 어댑터 계약·로그인·고객 요청·확인 문자·사진·PWA(가짜 Supabase)
```
E2E 테스트는 `PLAYWRIGHT_PATH`로 playwright 모듈 위치를, 스크린샷 폴더는 `SHOTS`로 바꿀 수 있습니다.

## 수정·배포
- 화면 수정: `web/` 아래 파일을 고쳐 GitHub `main`에 올리면 Cloudflare Pages가 1~2분 안에 자동 배포합니다.
- DB·서버 함수 수정: `supabase/` 아래 파일을 고친 뒤 Supabase에 적용합니다(Claude Code의 Supabase 커넥터 또는 Supabase 대시보드 SQL 편집기).
- 나중에 유료 문자 API(솔라피 등)로 고객 확인 문자를 자동 발송하려면 `supabase/functions/push/index.ts`의 `sendCustomerSms()`만 채우면 됩니다.
