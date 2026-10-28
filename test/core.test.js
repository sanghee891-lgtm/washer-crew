// node test/core.test.js
const assert = require("assert");
const C = require("../web/core.js");

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + e.message); }
}

const R = (o) => Object.assign({
  id: "x", date: "2026-10-21", time: "09:00", durationMin: 120, status: "scheduled",
  customer: { name: "김고객", phone: "010-1111-2222", address: "서울" },
  items: [{ type: "통돌이", model: "WA16", qty: 1, work: "세척" }],
  total: 100000, payment: { method: "미정", paid: false }, workers: {}
}, o);

console.log("시간 계산");
t("종료시간", () => assert.strictEqual(C.endTime("09:00", 120), "11:00"));
t("종료시간 30분 단위", () => assert.strictEqual(C.endTime("13:30", 90), "15:00"));
t("자정 넘김", () => assert.strictEqual(C.endTime("23:00", 120), "01:00 (다음날)"));
t("잘못된 시간", () => assert.strictEqual(C.endTime("", 60), ""));
t("소요시간 표기", () => {
  assert.strictEqual(C.durationLabel(30), "30분");
  assert.strictEqual(C.durationLabel(60), "1시간");
  assert.strictEqual(C.durationLabel(150), "2시간 30분");
});

console.log("겹침 검사");
t("겹침", () => assert.ok(C.overlaps(R({ id: "a" }), R({ id: "b", time: "10:00" }))));
t("끝=시작은 안 겹침", () => assert.ok(!C.overlaps(R({ id: "a" }), R({ id: "b", time: "11:00" }))));
t("다른 날짜 안 겹침", () => assert.ok(!C.overlaps(R({ id: "a" }), R({ id: "b", date: "2026-10-22" }))));
t("취소 건 제외", () => assert.ok(!C.overlaps(R({ id: "a", status: "canceled" }), R({ id: "b" }))));
t("같은 직원 겹침만 충돌", () => {
  const list = [
    R({ id: "a", workers: { s1: true, s2: true } }),
    R({ id: "b", time: "10:00", workers: { s2: true, s3: true } }),
    R({ id: "c", time: "10:00", workers: { s4: true } }),
    R({ id: "d", time: "10:00", workers: { s1: false } })
  ];
  const c = C.findConflicts(list);
  assert.deepStrictEqual(Object.keys(c).sort(), ["a", "b"]);
  assert.deepStrictEqual(c.a[0].staffIds, ["s2"]);
});
t("폼 후보와 충돌 검사(자기 자신 제외)", () => {
  const list = [R({ id: "a", workers: { s1: true } })];
  const cand = R({ id: "a", time: "10:00", workers: { s1: true } });
  assert.deepStrictEqual(C.findConflicts(list, cand), {});
  const cand2 = R({ id: "new", time: "10:30", workers: { s1: true } });
  assert.ok(C.findConflicts(list, cand2).new);
});

console.log("날짜");
t("월 이동", () => {
  assert.strictEqual(C.addMonths("2026-12", 1), "2027-01");
  assert.strictEqual(C.addMonths("2026-01", -1), "2025-12");
  assert.strictEqual(C.addMonths("2026-10", -13), "2025-09");
});
t("월 범위", () => assert.deepStrictEqual(C.monthRange("2026-12"), { start: "2026-12-01", end: "2027-01-01" }));
t("말일", () => { assert.strictEqual(C.daysInMonth("2026-02"), 28); assert.strictEqual(C.daysInMonth("2028-02"), 29); });
t("요일 라벨", () => assert.strictEqual(C.dayLabel("2026-10-21"), "10월 21일 (수)"));

console.log("금액·전화");
t("금액 파싱", () => {
  assert.strictEqual(C.parseWon("1,234,000원"), 1234000);
  assert.strictEqual(C.parseWon(""), 0);
  assert.strictEqual(C.parseWon(85000), 85000);
});
t("금액 표기", () => { assert.strictEqual(C.formatWon(1234567), "1,234,567"); assert.strictEqual(C.formatWon(0), "0"); });
t("짧은 금액", () => { assert.strictEqual(C.shortWon(245000), "24.5만"); assert.strictEqual(C.shortWon(1000000), "100만"); });
t("전화 표기", () => {
  assert.strictEqual(C.formatPhone("01012345678"), "010-1234-5678");
  assert.strictEqual(C.formatPhone("0212345678"), "02-1234-5678");
  assert.strictEqual(C.formatPhone("021234567"), "02-123-4567");
  assert.strictEqual(C.formatPhone("0311234567"), "031-123-4567");
});

console.log("집계");
const month = [
  R({ id: "1", status: "done", total: 80000, payment: { method: "카드", paid: true },
      items: [{ type: "통돌이", qty: 1, work: "세척" }, { type: "건조기", qty: 1, work: "세척" }], workers: { s1: true, s2: true } }),
  R({ id: "2", status: "done", total: 150000, payment: { method: "현금", paid: false },
      items: [{ type: "LG 2단", qty: 1, work: "이전설치" }], workers: { s1: true } }),
  R({ id: "3", status: "scheduled", total: 120000, items: [{ type: "삼성 2단", qty: 2, work: "세척" }] }),
  R({ id: "4", status: "canceled", total: 999999, items: [{ type: "빌트인", qty: 1, work: "세척" }], workers: { s1: true } }),
  R({ id: "5", date: "2026-11-02", status: "done", total: 50000 })
];
t("월 필터", () => assert.strictEqual(C.filterMonth(month, "2026-10").length, 4));
t("건수·매출(취소 제외, 완료/예정 분리)", () => {
  const s = C.summarize(C.filterMonth(month, "2026-10"));
  assert.strictEqual(s.count, 3);
  assert.strictEqual(s.canceled, 1);
  assert.strictEqual(s.done, 2);
  assert.strictEqual(s.scheduled, 1);
  assert.strictEqual(s.doneRevenue, 230000);
  assert.strictEqual(s.scheduledRevenue, 120000);
  assert.strictEqual(s.totalRevenue, 350000);
});
t("미수금", () => {
  const s = C.summarize(C.filterMonth(month, "2026-10"));
  assert.strictEqual(s.unpaid, 150000);
  assert.strictEqual(s.unpaidCount, 1);
});
t("기기별 대수", () => {
  const s = C.summarize(C.filterMonth(month, "2026-10"));
  assert.strictEqual(s.byType["통돌이"], 1);
  assert.strictEqual(s.byType["건조기"], 1);
  assert.strictEqual(s.byType["삼성 2단"], 2);
  assert.strictEqual(s.byType["LG 2단"], 1);
  assert.strictEqual(s.byType["빌트인"], 0);
  assert.strictEqual(s.units, 5);
});
t("작업별 건수(예약 단위)", () => {
  const s = C.summarize(C.filterMonth(month, "2026-10"));
  assert.strictEqual(s.byWork["세척"], 2);
  assert.strictEqual(s.byWork["이전설치"], 1);
});
t("직원별(취소 제외)", () => {
  const s = C.summarize(C.filterMonth(month, "2026-10"));
  assert.deepStrictEqual(s.byStaff.s1, { count: 2, done: 2, revenue: 230000 });
  assert.deepStrictEqual(s.byStaff.s2, { count: 1, done: 1, revenue: 80000 });
});
t("연간 12개월", () => {
  const y = C.summarizeYear(month, 2026);
  assert.strictEqual(y.length, 12);
  assert.strictEqual(y[9].totalRevenue, 350000);
  assert.strictEqual(y[10].doneRevenue, 50000);
  assert.strictEqual(y[0].count, 0);
});
t("문자열 금액도 합산", () => assert.strictEqual(C.summarize([R({ total: "70,000" })]).scheduledRevenue, 70000));

console.log("정렬·검색·검사");
t("날짜·시간 정렬", () => {
  const s = C.sortReservations([R({ id: "b", time: "14:00" }), R({ id: "a", time: "09:30" }), R({ id: "c", date: "2026-10-01" })]);
  assert.deepStrictEqual(s.map(r => r.id), ["c", "a", "b"]);
});
t("검색(이름/전화 일부/모델)", () => {
  const r = R({});
  assert.ok(C.searchMatch(r, "김고"));
  assert.ok(C.searchMatch(r, "2222"));
  assert.ok(C.searchMatch(r, "wa16"));
  assert.ok(!C.searchMatch(r, "부산"));
});
t("입력 검사", () => {
  assert.deepStrictEqual(C.validateReservation(R({})), {});
  const e = C.validateReservation(R({ date: "", time: "", customer: {}, items: [], status: "x" }));
  assert.ok(e.date && e.time && e.customer && e.items && e.status);
});
t("대수 정리(0·빈값 → 1)", () => {
  assert.deepStrictEqual(C.cleanItems([{ type: "통돌이", qty: "0" }, { type: "" }]).map(i => i.qty), [1]);
});

console.log("CSV");
t("BOM·이스케이프", () => {
  const csv = C.toCSV([R({ customer: { name: '홍"길동', phone: "01012345678", address: "서울, 강남구\n101동" }, workers: { s1: true } })],
    [{ id: "s1", name: "김철수" }]);
  assert.ok(csv.startsWith("﻿예약일자,"));
  assert.ok(csv.includes('"홍""길동"'));
  assert.ok(csv.includes('"서울, 강남구\n101동"'));
  assert.ok(csv.includes("010-1234-5678"));
  assert.ok(csv.includes("김철수"));
  assert.strictEqual(csv.trim().split("\r\n").length, 2);
});

t("CSV: 명단에 없는 직원은 빼고 표시", () => {
  const csv = C.toCSV([R({ workers: { s1: true, old9: true } })], [{ id: "s1", name: "김철수" }]);
  assert.ok(csv.includes(",김철수,"));
  assert.ok(!csv.includes("삭제된"));
});

console.log("이전설치 출발지·도착지");
const MV = R({ items: [{ type: "LG 2단", qty: 1, work: "이전설치" }], customer: { name: "이사고객", phone: "", address: "수원시 영통구 1" }, moveTo: { address: "용인시 기흥구 2", floor: "7", elevator: "있음" } });
t("이전설치 여부", () => {
  assert.ok(C.isMove(MV));
  assert.ok(!C.isMove(R({})));
});
t("도착지 주소로 검색", () => assert.ok(C.searchMatch(MV, "기흥구")));
t("CSV 도착지 열", () => {
  const rows = C.toCSV([MV, R({ moveTo: { address: "무시됨" } })], []).split("\r\n");
  assert.ok(rows[0].includes("주소(출발지),도착지 주소"));
  assert.ok(rows[1].includes("수원시 영통구 1,용인시 기흥구 2"));
  assert.ok(!rows[2].includes("무시됨"), "이전설치가 아니면 도착지 비움");
});

console.log("작업 사진");
const PR = R({ photos: {
  a1: { kind: "after", by: "s1", at: "2026-10-21T03:00:00Z" },
  b1: { kind: "before", by: "s2", at: "2026-10-21T01:00:00Z" },
  b2: { kind: "before", by: "s1", at: "2026-10-21T02:00:00Z" },
  gone: null
} });
t("전/후 목록(삭제 제외, 시간순)", () => {
  assert.deepStrictEqual(C.photoList(PR, "before").map(p => p.id), ["b1", "b2"]);
  assert.deepStrictEqual(C.photoList(PR, "after").map(p => p.id), ["a1"]);
  assert.deepStrictEqual(C.photoList(PR).map(p => p.id), ["b1", "b2", "a1"]);
});
t("사진 수", () => {
  assert.deepStrictEqual(C.photoCounts(PR), { before: 2, after: 1, total: 3 });
  assert.deepStrictEqual(C.photoCounts(R({})), { before: 0, after: 0, total: 0 });
});
t("CSV 사진 수 열", () => {
  const csv = C.toCSV([PR], []);
  assert.ok(csv.split("\r\n")[0].endsWith(",사진(전/후)"));
  assert.ok(csv.split("\r\n")[1].endsWith(",2/1"));
});

console.log("내비 링크");
const ADDR = "서울 강남구 테헤란로 1, 101동 1203호";
const ENC = encodeURIComponent(ADDR);
t("플랫폼 감지", () => {
  assert.strictEqual(C.detectPlatform("Mozilla/5.0 (Linux; Android 14; SM-S918N)"), "android");
  assert.strictEqual(C.detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), "ios");
  assert.strictEqual(C.detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "other");
});
t("iOS: 티맵·카카오맵·네이버 앱 주소 검색 링크", () => {
  const l = C.navLinks(ADDR, "ios");
  const by = Object.fromEntries(l.apps.map(a => [a.key, a]));
  assert.strictEqual(by.tmap.href, "tmap://search?name=" + ENC);
  assert.strictEqual(by.kakaomap.href, "kakaomap://search?q=" + ENC);
  assert.ok(by.navermap.href.startsWith("nmap://search?query=" + ENC + "&appname="));
  assert.strictEqual(by.kakaonavi.copyFirst, true);
  assert.ok(!by.tmap.copyFirst);
});
t("Android: intent 링크(패키지, 대체 주소 없음)", () => {
  const l = C.navLinks(ADDR, "android");
  const by = Object.fromEntries(l.apps.map(a => [a.key, a]));
  assert.strictEqual(by.tmap.href, "intent://search?name=" + ENC + "#Intent;scheme=tmap;package=com.skt.tmap.ku;end");
  assert.strictEqual(by.kakaomap.href, "intent://search?q=" + ENC + "#Intent;scheme=kakaomap;package=net.daum.android.map;end");
  assert.ok(by.kakaonavi.href.includes("package=com.locnall.KimGiSa"));
  assert.ok(l.apps.every(a => !a.href.includes("browser_fallback_url")), "앱이 없으면 플레이스토어(장부 화면은 그대로)");
  assert.ok(!/[ ,]/.test(by.tmap.href.split("#")[0]), "주소가 인코딩되지 않음");
});
t("PC: 앱 버튼 없이 웹 지도만", () => {
  const l = C.navLinks(ADDR, "other");
  assert.strictEqual(l.apps.length, 0);
  assert.deepStrictEqual(l.web.map(w => w.href), ["https://map.kakao.com/link/search/" + ENC, "https://map.naver.com/p/search/" + ENC]);
});

console.log("전날 확인 문자");
t("다음날 날짜(월말·연말 넘김)", () => {
  assert.strictEqual(C.addDays("2026-10-31", 1), "2026-11-01");
  assert.strictEqual(C.addDays("2026-12-31", 1), "2027-01-01");
});
t("오전·오후 시간 표기", () => {
  assert.strictEqual(C.timeKo("10:00"), "오전 10시");
  assert.strictEqual(C.timeKo("13:30"), "오후 1시 30분");
  assert.strictEqual(C.timeKo("12:00"), "오후 12시");
  assert.strictEqual(C.timeKo("00:10"), "오전 12시 10분");
  assert.strictEqual(C.timeKo(""), "");
});
t("확인 문자 문구", () => {
  const r = R({ date: "2026-10-24", time: "10:00", customer: { name: "김민지", phone: "010-1234-5678" }, items: [{ type: "건조기", qty: 1, work: "이전설치" }] });
  assert.strictEqual(C.reminderText(r), "[세탁기 크루] 김민지 고객님, 내일 10월 24일(토) 오전 10시 건조기 이전설치 예약 확인 드립니다. 변경 있으시면 연락 주세요.");
});
t("확인 문자: 이름 없음·기기 여러 개", () => {
  const r = R({ date: "2026-10-29", time: "09:30", customer: { name: "", phone: "010" }, items: [{ type: "통돌이", qty: 1, work: "세척" }, { type: "건조기", qty: 1, work: "세척" }] });
  assert.strictEqual(C.reminderText(r), "[세탁기 크루] 고객님, 내일 10월 29일(목) 오전 9시 30분 통돌이·건조기 세척 예약 확인 드립니다. 변경 있으시면 연락 주세요.");
});
t("문자 링크: 아이폰 &body, 안드로이드 ?body", () => {
  assert.strictEqual(C.smsHref("010-1234-5678", "안녕 하세요", "ios"), "sms:01012345678&body=%EC%95%88%EB%85%95%20%ED%95%98%EC%84%B8%EC%9A%94");
  assert.strictEqual(C.smsHref("010-1234-5678", "a&b", "android"), "sms:01012345678?body=a%26b");
});

console.log("진행 단계");
t("확정 → 직원 배정(인원 충족) → 이동·작업 → 완료 → 입금", () => {
  assert.strictEqual(C.stageOf(R({ needed: 2, workers: { a: true } })).label, "확정");
  assert.strictEqual(C.stageOf(R({ needed: 2, workers: { a: true, b: true } })).label, "직원 배정");
  assert.strictEqual(C.stageOf(R({ needed: 2, workers: { a: true, b: true } }), 1).key, "confirmed", "명단에 있는 직원 수 기준");
  assert.strictEqual(C.stageOf(R({ status: "moving" })).label, "이동 중");
  assert.strictEqual(C.stageOf(R({ status: "working" })).label, "작업 중");
  assert.strictEqual(C.stageOf(R({ status: "done" })).label, "작업 완료");
  assert.strictEqual(C.stageOf(R({ status: "done", payment: { paid: true } })).label, "입금 완료");
  assert.strictEqual(C.stageOf(R({ status: "canceled" })).key, "canceled");
});
t("다음 단계 버튼", () => {
  assert.deepStrictEqual(C.nextStatus(R({ status: "scheduled" })), { s: "moving", label: "이동 시작" });
  assert.strictEqual(C.nextStatus(R({ status: "working" })).s, "done");
  assert.strictEqual(C.nextStatus(R({ status: "done" })), null);
});
t("상태 기록은 시간순", () => {
  const l = C.statusLog(R({ log: { b: { s: "working", by: "x", at: "2026-10-22T02:00:00Z" }, a: { s: "moving", by: "x", at: "2026-10-22T01:00:00Z" }, z: null } }));
  assert.deepStrictEqual(l.map((e) => e.s), ["moving", "working"]);
});
t("이동 중·작업 중은 예정 매출로 집계", () => {
  const s = C.summarize([R({ status: "moving", total: 10000 }), R({ status: "working", total: 20000 }), R({ status: "done", total: 5000 })]);
  assert.strictEqual(s.scheduledRevenue, 30000);
  assert.strictEqual(s.doneRevenue, 5000);
});

t("전화번호 형식 검사", () => {
  assert.strictEqual(C.validateReservation(R({ customer: { name: "a", phone: "010-1234-5678" } })).phone, undefined);
  assert.strictEqual(C.validateReservation(R({ customer: { name: "a", phone: "02-123-4567" } })).phone, undefined);
  assert.ok(C.validateReservation(R({ customer: { name: "a", phone: "1234-5678" } })).phone, "0으로 시작");
  assert.ok(C.validateReservation(R({ customer: { name: "a", phone: "010-1234" } })).phone, "자리수");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
