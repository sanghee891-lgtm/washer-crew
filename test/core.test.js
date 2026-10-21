// node test/core.test.js
const assert = require("assert");
const C = require("../core.js");

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
t("Android: intent 링크(패키지·대체 주소)", () => {
  const l = C.navLinks(ADDR, "android");
  const by = Object.fromEntries(l.apps.map(a => [a.key, a]));
  assert.ok(by.tmap.href.startsWith("intent://search?name=" + ENC + "#Intent;scheme=tmap;package=com.skt.tmap.ku;S.browser_fallback_url="), by.tmap.href);
  assert.ok(by.tmap.href.endsWith(";end"));
  assert.ok(by.kakaonavi.href.includes("package=com.locnall.KimGiSa"));
  assert.ok(by.kakaonavi.href.includes(encodeURIComponent("https://play.google.com/store/apps/details?id=com.locnall.KimGiSa")));
  assert.ok(by.kakaomap.href.includes(encodeURIComponent("https://map.kakao.com/link/search/" + ENC)));
  assert.ok(!/[ ,]/.test(by.tmap.href.split("#")[0]), "주소가 인코딩되지 않음");
});
t("PC: 앱 버튼 없이 웹 지도만", () => {
  const l = C.navLinks(ADDR, "other");
  assert.strictEqual(l.apps.length, 0);
  assert.deepStrictEqual(l.web.map(w => w.href), ["https://map.kakao.com/link/search/" + ENC, "https://map.naver.com/p/search/" + ENC]);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
