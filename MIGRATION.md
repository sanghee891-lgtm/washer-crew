# 세탁기 크루: Claude 공유 페이지 → 독립 웹앱(무료) 이전 계획

이 문서는 다음 작업 세션이 이어서 진행하기 위한 인수인계 문서다. 사장님(사용자)은 비개발자이고, 휴대폰 위주로 쓰는 직원 5명(연령대 높음)이 쓴다. 안내는 쉬운 한국어로 짧게 한다.

## 왜 옮기나
지금 앱은 claude.ai Artifact(https://claude.ai/artifact/Wiyd1f9hP4hDa4E556K6C2)로 돌아간다. 이 구조로는 다음이 불가능하다.
1. **고객 예약 링크:** 고객이 이름·연락처·주소를 적으면 장부에 자동 반영되어야 한다. 그런데 Artifact는 초대된 사람만 쓸 수 있고, 공개 링크를 켜면 초대된 편집자가 쓰기 권한을 잃는다.
2. **앱을 닫아도 오는 휴대폰 알림:** 새 예약이 들어오거나 전날 확인 문자를 보낼 시간에 알림이 와야 한다.
3. **홈 화면 아이콘을 로고로**
4. **예약 전날 정해진 시간의 자동 작업**

조건은 **비용 0원**이다. 고객에게 문자를 완전 자동으로 보내는 것은 유료(건당 10~20원)라서, 무료 방식(직원 휴대폰에 알림 → 문구가 채워진 문자 화면 → 전송만 누름)으로 하고 나중에 유료 문자 API를 붙일 수 있게만 설계한다.

## 결정된 구성
- **DB·인증·파일·예약 작업:** Supabase 무료 요금제
  - 리전: Northeast Asia (Seoul)
  - 무료 요금제는 7일간 사용이 없으면 일시정지된다(매일 쓰면 문제없음). DB 500MB, Storage 1GB.
- **호스팅:** Cloudflare Pages 무료(상업 사용 가능). GitHub `sanghee891-lgtm/washer-crew` 저장소를 연결해 자동 배포한다.
  - 빌드 없이 정적 파일만 올린다. 배포 폴더는 `web/`을 권장한다.
  - Vercel Hobby는 비상업 전용이라 쓰지 않는다.
- **알림:** Web Push(VAPID)와 서비스 워커를 쓰는 PWA다. 아이폰은 iOS 16.4 이상에서 홈 화면에 추가해야 알림이 된다.

## 지금 코드(이 저장소)
- `core.js`: 순수 로직. 시간·겹침·집계·CSV·내비 링크·사진 목록·이전설치. **그대로 재사용한다.**
- `app.js`: 화면과 동작.
  - 데이터 접근은 `claude.use("db" | "user" | "downloads" | "assets")`로 한다.
  - db API는 Firestore 비슷한 형태다: `doc(path).get/set/update(중첩 병합)/delete/onSnapshot`, `collection(path).where/orderBy/limit/get/onSnapshot/doc()`.
- `test/mock-claude.js`: 위 API의 가짜 구현(localStorage 기반)이다. **어댑터를 만들 때 동작 기준으로 삼는다.**
- `test/core.test.js`(43개), `test/e2e.test.js`(52개, Playwright): 모두 통과하는 상태다. 이전 후에도 계속 통과해야 한다.
- 데이터 구조는 README.md의 "데이터 구조"를 참고한다.
  - `reservations/{id}`: workers 맵 값은 true(참여) / "maybe"(보류) / "no"(불참) / false. photos 맵 값은 {kind, by, at} 또는 null. moveTo, createdBy 등.
  - `config/staff`
  - `data/users/{uid}/me`
- 기능 목록은 README.md "기능" 절에 있다. 수정 권한(넣은 사람+사장님), 참여/불참/보류, 새 예약 알림, 뒤로가기 처리, 사진 8장 동시 업로드, 내비 연결 등이 모두 들어 있으니 **동작을 그대로 유지한다.**

## 권장 구현 방식(최소 변경)
1. **Supabase에 문서형 테이블 1개를 만들고, `claude.use("db")`와 같은 API를 흉내 내는 어댑터(`web/supa-db.js`)를 만든다.** 그러면 `app.js`는 거의 그대로 쓸 수 있다.
   - 테이블은 `docs(path text primary key, coll text not null, data jsonb not null, updated_at timestamptz default now())`이다.
     - `coll`은 path에서 마지막 세그먼트를 뺀 값이다.
     - where/orderBy는 `data->>field`로 처리한다(문서 수 수천 개 수준이라 충분하다).
   - `update`의 중첩 병합은 Postgres 함수 `docs_merge(path, patch jsonb)`로 서버에서 처리한다. 재귀 jsonb 병합이고, 배열은 통째로 교체한다. 그래야 동시 참여 체크가 서로 덮어쓰지 않는다.
   - `onSnapshot`은 Supabase Realtime(postgres_changes, `docs` 테이블)으로 구현한다.
   - RLS: 로그인한 직원만 `docs`를 읽고 쓸 수 있다. `data/users/<uid>/...`는 본인만 접근한다.
2. **사진:** Supabase Storage의 private 버킷 `photos`를 쓴다.
   - `assets` 어댑터(`upload/delete/list`)를 만든다. 화면 경로 `"/_blob/" + id` 대신 signed URL이나 인증된 다운로드 URL을 돌려주는 함수를 쓴다(app.js의 `/_blob/` 사용처 수정).
   - "자기가 올린 사진만 삭제"(사장님은 전부) 규칙을 Storage 정책으로 둔다.
3. **직원 로그인(나이 있는 분들 기준으로 쉽게):**
   - 첫 화면에서 **이름을 고르고 숫자 6자리 비밀번호**를 입력한다.
   - 내부적으로는 Supabase Auth의 이메일+비밀번호를 쓴다. 이메일은 `<staffId>@washer-crew.local` 같은 가짜 주소이고, 이메일 인증은 끈다.
   - 계정 생성과 비밀번호 초기화는 사장님 화면에서 한다(Edge Function + service role).
   - `user` 어댑터: `id()` = auth uid, `isOwner()` = 사장님 계정 여부(`config/owner` 같은 곳에 uid 저장).
4. **고객 예약 링크:** `web/book.html`은 로그인 없이 연다.
   - 입력 항목: 이름, 연락처, 주소, 이전설치면 도착지, 희망 날짜, 시간대, 기기 종류·대수, 요청사항.
   - 별도 테이블 `booking_requests`에 anon **insert만** 허용한다(select 불가).
   - 스팸 방지: honeypot 필드, 같은 연락처는 1분에 1회.
   - 장부에서 "예약 요청" 목록을 보여 준다. [확정]을 누르면 입력 화면이 채워진 채 열리고, 저장하면 `reservations`로 들어간다. [거절]도 둔다.
   - 새 요청이 들어오면 직원 전원에게 푸시 알림을 보낸다(DB 웹훅 또는 트리거 → Edge Function).
5. **푸시 알림:**
   - `push_subscriptions(uid, endpoint, keys)` 테이블과 Edge Function `send-push`를 만든다. VAPID 키는 Supabase secrets에 둔다.
   - 알림 종류:
     - 새 예약(넣은 사람 제외)
     - 새 고객 요청
     - 매일 18:00(KST) "내일 예약 n건 확인 문자 보내기"
6. **전날 확인 문자(무료):**
   - pg_cron을 매일 09:00 UTC(18:00 KST)에 돌려 Edge Function으로 직원에게 푸시를 보낸다.
   - 앱의 "내일 확인 문자" 화면은 고객별로 `sms:<번호>?body=<문구>` 링크와 [복사] 버튼을 둔다.
   - 문구 예: "[세탁기 크루] ○○ 고객님, 내일 10월 24일(토) 오전 10시 건조기 이전설치 예약 확인 드립니다. 변경 있으시면 연락 주세요."
   - 보낸 고객은 체크 표시(`reminders` 기록)한다.
   - 나중에 유료 API(솔라피 등)로 자동 발송하도록 Edge Function 한 곳만 바꾸면 되게 설계한다.
7. **PWA:**
   - `web/manifest.webmanifest`를 둔다. 이름 "세탁기 크루", 아이콘은 `assets/logo.webp`를 192·512 PNG로 변환해 쓴다. theme_color는 #00419B다.
   - `web/sw.js`는 푸시 수신과 알림 클릭 시 해당 예약 열기를 맡는다.
8. **CSV 다운로드:** Artifact `downloads` 대신 Blob과 `<a download>`를 쓴다(일반 웹이라 가능).

## 데이터 이전
- 기존 Artifact 데이터를 옮긴다.
  - `ArtifactData list`로 `reservations`, `config`를 읽는다(현재 예약 약 2건, 직원 5명).
  - 사진은 `Artifact read`의 `path`(asset id)로 받아 Storage에 올리고 photos 맵의 id를 새 경로로 바꾼다.
- 직원 id(`smvivcjg00`~`04`)는 그대로 유지한다. 예약의 workers와 createdBy가 이 id를 쓴다.
- 직원 명단: 김영우 `smvivcjg00`, 박상연 `smvivcjg01`, 신봉길 `smvivcjg02`, 신창민 `smvivcjg03`(앱 개발자로 표시), 조형일 `smvivcjg04`
- 전환 기간에는 두 장부를 같이 쓰지 않게 한다. 새 앱 확인 → 마지막 데이터 다시 옮기기 → 직원 안내 순서로 진행한다.

## 사용자가 해야 하는 일(이미 안내함)
1. Supabase 가입 → 프로젝트 `washer-crew` 생성(Seoul, Free). DB 비밀번호를 보관한다.
2. claude.ai 커넥터에서 Supabase를 연결한다.
3. Cloudflare에 가입한다.
4. 새 Claude Code 세션을 열고 이 저장소를 선택한 뒤 "MIGRATION.md 계획대로 진행해줘"라고 입력한다.
5. 코드가 준비되면 Cloudflare Pages에서 GitHub 저장소를 연결한다(클릭 안내 필요). 빌드 명령은 없고, 출력 폴더는 `web`이다.
6. 직원 안내: 새 주소 → 이름과 비밀번호 6자리 → 홈 화면에 추가 → 알림 허용

## 검증
- 기존 단위·E2E 테스트를 새 어댑터 기준으로 통과시킨다. 가짜 런타임 대신 Supabase 로컬 또는 테스트 프로젝트를 쓰거나, 어댑터 계약 테스트를 쓴다.
- 추가로 확인할 것:
  - 고객 폼 제출 → 요청 목록에 표시 → 확정 → 예약 생성
  - anon이 다른 테이블을 읽거나 쓸 수 없는지(RLS)
  - 푸시 구독과 발송(Edge Function 로그)
  - pg_cron 일정 등록
  - PWA 설치성(manifest, 서비스 워커)
- 사진 private 버킷이 다른 직원에게 보이는지, 남의 사진 삭제가 막히는지 확인한다.
