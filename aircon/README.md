# 굿디클린 (에어컨 분해세척)

에어컨 분해세척 직원들이 함께 쓰는 **예약 및 월별 매출 장부**입니다.
저장소 맨 위의 세탁기 크루 앱(`web/`)을 복사해 만든 **별도 앱**이에요. 데이터·직원 계정·고객 예약 링크·배포 주소가 모두 따로입니다.

## 세탁기 크루와 다른 점
- 이름·아이콘: **굿디클린**, GD 로고(`brand/goodd-logo-original.png`를 잘라 `web/icons`, `web/assets`에 사용)
- 기기 종류: 벽걸이 / 스탠드 / 2in1 / 천장형 1way / 천장형 4way / 업소용 (`web/core.js`의 `TYPES`)
- 작업: **분해세척** 하나 (`WORKS`). 하나뿐이라 입력 화면·고객 예약 페이지에서 작업 고르는 칸, 통계의 작업별 건수는 숨김
  - 나중에 `WORKS`에 작업을 더 넣으면 고르는 칸이 다시 보이고, `"이전설치"`를 넣으면 출발지·도착지 입력도 다시 켜짐
- 고객 예약 페이지: "에어컨(실내기) 앞면 사진" 1장 필수
- 확인 문자: `[굿디클린] 김민지 고객님, 내일 10월 24일(토) 오전 10시 벽걸이·스탠드 분해세척 예약 확인 드립니다. …`
- 플레이스토어용 파일(`.well-known`, `store/`), 블로그 이미지는 빼 둠

그 밖의 기능·구조는 저장소 맨 위 `README.md`와 같습니다.

## 아직 남은 일 (처음 한 번)
> 서버 비용: 지금 Supabase 조직은 Pro라 프로젝트를 하나 더 켜면 월 약 $10이 붙음.
> 비용 없이 하려면 대시보드에서 **Free 요금제 조직을 새로 만들고** 그 안에 만듦(무료 프로젝트 2개까지, 7일 안 쓰면 일시정지 → keepalive로 방지, DB 500MB·사진 1GB).
> 처음 계정은 **신창민(관리자) 1명**만, 직원은 나중에 앱의 직원 관리에서 추가.

1. **새 Supabase 프로젝트**(서울) 만들기 → `supabase/migrations/0001~0009`를 순서대로 적용, `supabase/functions/` 3개 배포
2. Vault에 `vapid_public`·`vapid_private`·`push_hook_secret` 저장, 직원 계정 만들기(아이디 `<직원번호>@goodclean-aircon.local`)
3. `web/config.js`에 새 프로젝트 주소·공개 키·VAPID 공개 키 넣기 (지금은 비어 있어서 세탁기 서버와 섞이지 않음)
4. **Cloudflare Pages 새 프로젝트**: 같은 저장소 연결, 빌드 명령 없음, 출력 폴더 `aircon/web`
5. (선택) `.github/workflows/`에 새 서버용 keepalive 추가

## 테스트
```bash
cd aircon
node test/core.test.js     # 계산 로직
node test/e2e.test.js      # 장부 화면 전체(Playwright)
node test/web.test.js      # 웹앱(가짜 Supabase)
```
