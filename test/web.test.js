// node test/web.test.js — 웹앱(Supabase 연결)을 가짜 Supabase로 브라우저에서 검증합니다.
// 1) 어댑터 계약: supa-db.js 의 db 가 예전 가짜 claude 런타임과 같은 결과를 내는지
// 2) 로그인·고객 예약 요청·내일 확인 문자·사진·알림·PWA
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "/opt/node22/lib/node_modules/playwright");
const mockClaude = require("./mock-claude.js");
const mockSupabase = require("./mock-supabase.js");

const ROOT = path.join(__dirname, "..", "web");
const blobs = new Map();
const booked = [];
const TYPES = { ".js": "text/javascript; charset=utf-8", ".html": "text/html; charset=utf-8", ".webp": "image/webp", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  const u = req.url.split("?")[0];
  if (u === "/config.js") {
    res.writeHead(200, { "content-type": TYPES[".js"] });
    return res.end('window.WC_CONFIG = { url: "", key: "test-key", vapidPublic: "BN-veQ_r2zno2rW8Zj3r32mDfxiS_3uIagUmGDtKudBtCRLPuDUFrbEf-g4k-GaWBCe5QVKyv026MBKwUfqQQeY", emailDomain: "washer-crew.local" };');
  }
  if (u === "/vendor/supabase.js") { res.writeHead(200, { "content-type": TYPES[".js"] }); return res.end("/* 테스트: 가짜 Supabase 사용 */"); }
  if (u === "/rest/v1/rpc/submit_booking" && req.method === "POST") {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      const p = JSON.parse(b).p;
      if (req.headers.apikey !== "test-key") { res.writeHead(401); return res.end("{}"); }
      if (booked.some((x) => x.phone === p.phone)) { res.writeHead(400, { "content-type": "application/json" }); return res.end(JSON.stringify({ code: "22023", message: "too_many" })); }
      booked.push(p);
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
    return;
  }
  if (u.startsWith("/_blob/")) {
    const id = u.slice(7);
    if (req.method === "PUT") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => { blobs.set(id, { type: req.headers["content-type"], buf: Buffer.concat(chunks) }); res.writeHead(200); res.end(); });
      return;
    }
    if (req.method === "DELETE") { blobs.delete(id); res.writeHead(200); return res.end(); }
    const b = blobs.get(id);
    if (!b) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": b.type });
    return res.end(b.buf);
  }
  const rel = u === "/" ? "/index.html" : u;
  const f = path.join(ROOT, path.normalize(rel));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "text/plain" });
  res.end(fs.readFileSync(f));
});

let passed = 0, failed = 0;
async function step(name, fn) {
  try { await fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; if (process.env.DEBUG) console.log(e); console.log("  FAIL " + name + "\n       " + String(e.message || e).split("\n").slice(0, 6).join("\n       ")); }
}
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || "") + " 기대값=" + JSON.stringify(b) + " 실제=" + JSON.stringify(a)); }
function ok(v, msg) { if (!v) throw new Error(msg || "조건 불충족"); }
function pad(n) { return (n < 10 ? "0" : "") + n; }
function dstr(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
const TODAY = dstr(new Date());
const TOMORROW = dstr(new Date(Date.now() + 86400000));

const STAFF = { list: [{ id: "smvivcjg00", name: "김영우" }, { id: "smvivcjg01", name: "박상연" }, { id: "smvivcjg03", name: "신창민" }] };
const ACCOUNTS = [
  { uid: "u-kim", staffId: "smvivcjg00", pin: "000000", owner: false },
  { uid: "u-park", staffId: "smvivcjg01", pin: "222222", owner: false },
  { uid: "u-shin", staffId: "smvivcjg03", pin: "333333", owner: true }
];

async function setTotalWeb(page, v) { await page.fill("[data-testid=f-total]", ""); await page.type("[data-testid=f-total]", String(v)); }

(async () => {
  await new Promise((r) => server.listen(0, r));
  const BASE = "http://127.0.0.1:" + server.address().port + "/";
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
  const errors = [];
  function watch(page, label) {
    page.on("pageerror", (e) => errors.push(label + " pageerror: " + e.message));
    page.on("console", (m) => {
      // 같은 번호 재전송 시험의 400 응답은 일부러 낸 것
      if (m.type() === "error" && !(label === "book" && /status of 400/.test(m.text()))) errors.push(label + " console: " + m.text());
    });
    page.on("response", (r) => { if (r.status() === 404) errors.push(label + " 404: " + r.url()); });
    // 글꼴(Pretendard) CDN은 시험 환경에서 막혀 있어 빈 스타일로 대신함
    page.route("**/pretendard@*/**", (r) => r.fulfill({ contentType: "text/css", body: "/* font stub */" }));
    return page;
  }
  // 가짜 Supabase 로 연 장부. seed: { docs, bookings } , session: 로그인한 uid
  async function webPage(ctx, opt) {
    opt = opt || {};
    const page = watch(await ctx.newPage(), opt.label || "web");
    await page.addInitScript(mockSupabase, { accounts: ACCOUNTS });
    await page.goto(BASE + "book.html"); // 같은 출처에서 저장소 준비
    await page.evaluate((o) => {
      if (o.seed) localStorage.setItem("fakesb", JSON.stringify(Object.assign({ accounts: o.accounts }, o.seed)));
      if (o.session) sessionStorage.setItem("fakesb.session", o.session); else sessionStorage.removeItem("fakesb.session");
    }, { seed: opt.seed, session: opt.session, accounts: ACCOUNTS });
    await page.goto(BASE + (opt.path || ""));
    return page;
  }
  const fakeDb = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("fakesb")));

  // ---------------- 1. 어댑터 계약 ----------------
  console.log("어댑터 계약(예전 런타임과 같은 동작)");
  const contract = async () => {
    const db = await window.claude.use("db");
    const out = {};
    const ids = (s) => s.docs.map((d) => d.id);
    await db.doc("reservations/a").set({ date: "2026-01-05", n: 1, w: { x: true }, arr: [1, 2] });
    await db.doc("reservations/b").set({ date: "2026-02-01", n: 2 });
    await db.doc("reservations/c").set({ date: "2025-12-31", n: 5 });
    out.get = (await db.doc("reservations/a").get()).data();
    out.frozen = Object.isFrozen(out.get) && Object.isFrozen(out.get.w);
    await db.doc("reservations/a").update({ w: { y: "maybe" }, n: 3, arr: [9] });
    await db.doc("reservations/a").update({ w: { x: false } });
    out.merged = (await db.doc("reservations/a").get()).data();
    try { await db.doc("reservations/zz").update({ n: 1 }); out.missing = "no error"; } catch (e) { out.missing = e.code; }
    out.missingGet = (await db.doc("reservations/zz").get()).exists;
    out.range = ids(await db.collection("reservations").where("date", ">=", "2026-01-01").where("date", "<", "2027-01-01").get());
    out.numEq = ids(await db.collection("reservations").where("n", "==", 2).get());
    out.ordered = ids(await db.collection("reservations").orderBy("n", "desc").limit(2).get());
    const r = db.collection("reservations").doc();
    out.newIdOk = /^[a-z0-9]{6,}$/.test(r.id);
    const added = await db.collection("notes").add({ t: 1 });
    out.added = (await added.get()).data();
    const seen = [];
    const un = db.collection("reservations").where("date", ">=", "2026-01-01").onSnapshot((s) => seen.push(ids(s).join(",")));
    await new Promise((res) => setTimeout(res, 150));
    await db.doc("reservations/d").set({ date: "2026-03-01", n: 0 });
    await new Promise((res) => setTimeout(res, 250));
    await db.doc("reservations/b").delete();
    await new Promise((res) => setTimeout(res, 250));
    un();
    out.snapshots = seen;
    const dseen = [];
    const un2 = db.doc("config/x").onSnapshot((s) => dseen.push(s.exists ? s.data().v : null));
    await new Promise((res) => setTimeout(res, 150));
    await db.doc("config/x").set({ v: 1 });
    await new Promise((res) => setTimeout(res, 250));
    un2();
    out.docSnapshots = dseen;
    out.subcol = (await db.collection("data/users/" + (await (await window.claude.use("user")).id())).doc("me").get()).exists;
    return out;
  };
  let expected, actual;
  await step("예전 가짜 런타임 기준값 만들기", async () => {
    const c = await browser.newContext();
    const p = watch(await c.newPage(), "mock");
    await p.addInitScript(mockClaude, { uid: "u-shin", owner: true });
    await p.goto(BASE + "book.html");
    expected = await p.evaluate(contract);
    await c.close();
  });
  await step("Supabase 어댑터: get/set/병합/삭제/조건/정렬/실시간이 같음", async () => {
    const c = await browser.newContext();
    const p = await webPage(c, { session: "u-shin", seed: { docs: { "config/staff": STAFF } }, path: "book.html" });
    await p.addScriptTag({ url: BASE + "supa-db.js" });
    actual = await p.evaluate(contract);
    await c.close();
    const a = Object.assign({}, actual, { subcol: null }), e = Object.assign({}, expected, { subcol: null });
    eq(a, e, "결과 다름");
    eq(actual.merged, { date: "2026-01-05", n: 3, w: { x: false, y: "maybe" }, arr: [9] }, "중첩 병합·배열 교체");
    eq(actual.missing, "invalid_argument");
  });

  // ---------------- 2. 로그인 ----------------
  console.log("로그인(이름 + 비밀번호 6자리)");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ko-KR", timezoneId: "Asia/Seoul", hasTouch: true });
  const seed = {
    docs: {
      "config/staff": STAFF,
      ["reservations/r_tmr"]: { date: TOMORROW, time: "10:00", durationMin: 120, status: "scheduled", customer: { name: "김민지", phone: "010-1234-5678", address: "수원" }, items: [{ type: "건조기", qty: 1, work: "이전설치" }], total: 150000, payment: { method: "미정", paid: false }, workers: {}, createdBy: "smvivcjg00", createdAt: "2026-01-01T00:00:00Z" },
      ["reservations/r_kim"]: { date: TODAY, time: "15:00", durationMin: 60, status: "scheduled", customer: { name: "남의고객", phone: "", address: "서울" }, items: [{ type: "통돌이", qty: 1, work: "세척" }], total: 50000, payment: { method: "미정", paid: false }, workers: {}, createdBy: "smvivcjg00", createdAt: "2026-01-01T00:00:00Z" }
    },
    bookings: [
      { id: "b1", created_at: new Date().toISOString(), status: "new", name: "이고객", phone: "010-5555-6666", phone_digits: "01055556666", address: "용인시 기흥구 1", move_to: "수원시 영통구 2", want_date: TOMORROW, time_slot: "오후", items: [{ type: "건조기", qty: 1, work: "이전설치" }], note: "엘리베이터 있음" },
      { id: "b2", created_at: new Date().toISOString(), status: "new", name: "스팸", phone: "010-0000-0000", phone_digits: "01000000000", address: "x", move_to: "", want_date: TOMORROW, time_slot: "", items: [], note: "" }
    ]
  };
  const p = await webPage(ctx, { seed, label: "owner" });

  await step("처음엔 로그인 화면: 계정 있는 직원 이름만", async () => {
    await p.waitForSelector("[data-testid=login-신창민]");
    eq(await p.locator(".login-row").count(), 3);
    eq(await p.locator(".login-row").first().innerText(), "신창민\n개발자", "개발자가 맨 위");
    ok((await p.locator(".login-row").nth(1).innerText()).includes("사장님"));
    eq(await p.innerText("#login h1"), "접속할 사용자를 선택해주세요");
    eq(await p.innerText("#login .login-head p"), "선택한 사용자로 업무를 시작합니다.");
    ok(!(await p.isVisible("#app")), "장부는 숨김");
  });
  await step("틀린 비밀번호 → 안내, 맞으면 장부 열림(이름 다시 고르지 않음)", async () => {
    await p.click("[data-testid=login-신창민]");
    for (const d of "123456") await p.click(`.pin-pad [data-key="${d}"]`);
    await p.waitForFunction(() => document.querySelector("[data-testid=login-err]").textContent.includes("맞지 않아요"));
    for (const d of "333333") await p.click(`.pin-pad [data-key="${d}"]`);
    await p.waitForSelector("#login", { state: "detached" });
    await p.waitForFunction(() => document.querySelector("#meName").textContent === "신창민님");
    await p.waitForSelector("[data-testid=card]");
    ok(!(await p.isVisible("#modal")), "이름 고르기 창 없음");
  });
  await step("새로고침해도 로그인 유지", async () => {
    await p.reload();
    await p.waitForSelector("[data-testid=card]");
    ok(!(await p.$("#login")), "로그인 화면 없음");
  });

  // ---------------- 3. 고객 예약 요청 ----------------
  console.log("고객 예약 요청");
  await step("장부 맨 위에 '고객 예약 요청 2건'", async () => {
    await p.waitForSelector("[data-testid=req-notice]");
    ok((await p.innerText("[data-testid=req-notice]")).includes("고객 예약 요청 2건"));
  });
  await step("[확정] → 입력 화면이 채워져 열림 → 저장하면 예약 생성·요청 처리", async () => {
    await p.click("[data-testid=open-reqs]");
    await p.waitForSelector("[data-testid=req-card]");
    await p.locator("[data-testid=req-card]", { hasText: "이고객" }).locator("[data-testid=req-accept]").click();
    await p.waitForSelector("#sheet:not([hidden]) [data-testid=f-name]");
    eq(await p.inputValue("[data-testid=f-name]"), "이고객");
    eq(await p.inputValue("[data-testid=f-phone]"), "010-5555-6666");
    eq(await p.inputValue("[data-testid=f-addr]"), "용인시 기흥구 1");
    eq(await p.inputValue("[data-testid=f-addr2]"), "수원시 영통구 2");
    eq(await p.inputValue("[data-testid=f-date]"), TOMORROW);
    eq(await p.inputValue("[data-testid=f-time]"), "13:00");
    eq(await p.inputValue("[data-testid=item-type]"), "건조기");
    ok((await p.inputValue("#f-note")).includes("엘리베이터 있음"));
    await p.fill("[data-testid=f-total]", "180000");
    await p.click("[data-testid=save]");
    await p.waitForSelector("#sheet", { state: "hidden" });
    await p.waitForFunction(() => JSON.parse(localStorage.getItem("fakesb")).bookings[0].status === "accepted");
    const d = await fakeDb(p);
    const b1 = d.bookings[0];
    const res = d.docs["reservations/" + b1.reservation_id];
    ok(res && res.customer.name === "이고객" && res.createdBy === "smvivcjg03" && res.total === 180000, JSON.stringify(res));
    eq(b1.handled_by, "smvivcjg03");
    await p.waitForFunction(() => document.querySelector("[data-testid=req-notice]").innerText.includes("1건"));
  });
  await step("[거절] → 확인 후 요청 목록에서 사라짐", async () => {
    await p.click("[data-testid=open-reqs]");
    await p.click("[data-testid=req-reject]");
    await p.click("[data-testid=req-reject-yes]");
    await p.waitForFunction(() => JSON.parse(localStorage.getItem("fakesb")).bookings[1].status === "rejected");
    await p.waitForFunction(() => !document.querySelector("#modal [data-testid=req-card]"));
    await p.click("[data-rqclose]");
    await p.waitForFunction(() => !document.querySelector("[data-testid=req-notice]"));
  });

  // ---------------- 4. 내일 확인 문자 ----------------
  console.log("내일 확인 문자");
  await step("배너 → 고객별 문구가 채워진 문자 링크", async () => {
    await p.waitForSelector("[data-testid=remind-notice]");
    ok((await p.innerText("[data-testid=remind-notice]")).includes("내일 예약 2건"));
    await p.click("[data-testid=open-rem]");
    await p.waitForSelector("[data-testid=rem-card]");
    const t = await p.locator("[data-testid=rem-card]", { hasText: "김민지" }).locator("[data-testid=rem-text]").innerText();
    ok(t.startsWith("[세탁기 크루] 김민지 고객님, 내일 ") && t.includes("오전 10시 건조기 이전설치 예약 확인 드립니다"), t);
    const href = await p.locator("[data-testid=rem-card]", { hasText: "김민지" }).locator("[data-testid=rem-send]").getAttribute("href");
    ok(href.startsWith("sms:01012345678?body=%5B%EC%84%B8%ED%83%81%EA%B8%B0"), href);
  });
  await step("[보냄 표시] → 기록되고 다 보내면 배너 사라짐", async () => {
    for (const name of ["김민지", "이고객"]) {
      await p.locator("[data-testid=rem-card]", { hasText: name }).locator("[data-testid=rem-mark]").click();
      await p.waitForFunction((n) => { const c = [...document.querySelectorAll("[data-testid=rem-card]")].find((x) => x.textContent.includes(n)); return c && c.querySelector("[data-testid=rem-sent]"); }, name);
    }
    const d = await fakeDb(p);
    ok(d.docs["reminders/r_tmr"] && d.docs["reminders/r_tmr"].by === "smvivcjg03", "보낸 기록");
    await p.click("[data-rmclose]");
    await p.waitForFunction(() => !document.querySelector("[data-testid=remind-notice]"));
  });

  // ---------------- 5. 설정·알림·계정 ----------------
  console.log("설정·알림·계정");
  await step("알림 꺼짐 안내 배너 → [나중에]로 숨김", async () => {
    await p.waitForSelector("[data-testid=push-notice]");
    await p.click("[data-testid=push-notice] [data-act=push-later]");
    await p.waitForFunction(() => !document.querySelector("[data-testid=push-notice]"));
  });
  await step("사장님 설정: 내 계정·알림·고객 예약 링크·직원 계정 관리", async () => {
    await p.click("[data-testid=tab-settings]");
    await p.waitForSelector("[data-testid=my-account]");
    ok((await p.innerText("[data-testid=my-account]")).includes("신창민님으로 로그인했어요 (개발자)"));
    ok((await p.innerText("[data-testid=push-panel]")).includes("꺼져 있어요"));
    eq(await p.innerText("[data-testid=book-url]"), BASE + "book.html");
    await p.waitForFunction(() => document.querySelector("[data-testid=accounts]") && document.querySelector("[data-testid=accounts]").innerText.includes("개발자 계정"));
    ok(await p.isVisible("[data-testid=staff-save]"), "사장님은 명단 수정 가능");
  });
  await step("사장님이 직원 비밀번호 바꾸기", async () => {
    await p.locator(".acct-row", { hasText: "박상연" }).locator("[data-act=acct-pin]").click();
    await p.fill("[data-testid=pin-input]", "987654");
    await p.click("[data-testid=pin-save]");
    await p.waitForFunction(() => JSON.parse(localStorage.getItem("fakesb")).accounts.find((a) => a.staffId === "smvivcjg01").pin === "987654");
  });

  // ---------------- 역할별 첫 화면·카드·진행 단계 ----------------
  console.log("역할별 첫 화면·카드·진행 단계");
  await step("개발자 계정: 새 예약 요청·인원 부족·미수금·월 매출 칸 → 누르면 그 목록", async () => {
    await p.click("[data-testid=tab-list]");
    for (const k of ["reqs", "open", "unpaid", "revenue"]) ok(await p.isVisible(`[data-testid=tile-${k}]`), "칸 " + k);
    await p.click("[data-testid=tile-open]");
    eq(await p.getAttribute("[data-testid=filter-open]", "aria-pressed"), "true");
    await p.click("[data-testid=tile-open]");
    eq(await p.getAttribute("[data-testid=filter-all]", "aria-pressed"), "true");
  });
  const kimCard = () => p.locator("[data-testid=card]", { hasText: "남의고객" });
  await step("카드는 접혀 있고, 누르면 금액·주소가 펼쳐짐", async () => {
    ok(await kimCard().locator("[data-testid=card-more]").isHidden(), "처음엔 접힘");
    for (const b of ["detail", "nav"]) ok(await kimCard().locator(`[data-testid=${b}]`).isVisible(), "앞면 버튼 " + b);
    await kimCard().locator(".c-name").click();
    await kimCard().locator("[data-testid=card-more]").waitFor();
    ok((await kimCard().locator("[data-testid=card-more]").innerText()).includes("50,000원"));
  });
  await step("진행 단계: 이동 시작 → 작업 시작 → 작업 완료, 누가·언제 기록", async () => {
    eq(await kimCard().locator("[data-testid=stage]").innerText(), "확정");
    for (const [btn, label] of [["이동 시작", "이동 중"], ["작업 시작", "작업 중"], ["작업 완료", "작업 완료"]]) {
      eq(await kimCard().locator("[data-testid=next-stage]").innerText(), btn);
      await kimCard().locator("[data-testid=next-stage]").click();
      await p.waitForFunction((l) => [...document.querySelectorAll("[data-testid=card]")].some((c) => c.textContent.includes("남의고객") && c.querySelector("[data-testid=stage]").textContent === l), label);
    }
    const log = Object.values((await fakeDb(p)).docs["reservations/r_kim"].log);
    eq(log.map((e) => e.s).sort(), ["done", "moving", "working"]);
    ok(log.every((e) => e.by === "smvivcjg03" && e.at), "변경한 사람·시각");
    await kimCard().locator("[data-testid=status-log]").waitFor();
    ok((await kimCard().locator("[data-testid=status-log]").innerText()).includes("이동 시작 · 신창민"));
  });

  // ---------------- 저장 전 점검·임시 저장·저장 상태 ----------------
  console.log("저장 전 점검·임시 저장·저장 상태");
  const openNew = async () => { await p.click("[data-testid=add]"); await p.waitForSelector("#sheet:not([hidden]) [data-testid=f-name]"); };
  const closeSheet = async () => { await p.click("#sheet [data-x] >> nth=0"); await p.waitForSelector("#sheet", { state: "hidden" }); };
  await step("입력 화면이 1 일정 → 2 작업·기기 → 3 고객·주소 → 4 금액·배정 순서", async () => {
    await openNew();
    const hs = await p.$$eval("#form .fs > h3", (h) => h.map((x) => x.textContent));
    eq(hs.slice(0, 4), ["1일정", "2작업 · 기기", "3고객 · 방문 주소", "4금액 · 배정"]);
    ok(!(await p.isVisible("#f-floor")), "현장 정보는 접혀 있음");
  });
  await step("항목 옆 확인 문구: 인원 부족·금액 0원·주소 누락, 전화번호 형식은 저장 막음", async () => {
    await p.fill("[data-testid=f-name]", "점검고객");
    await p.fill("[data-testid=f-phone]", "1234-5678");
    for (const t of ["crew-short", "total-zero", "addr-missing"]) ok(await p.isVisible(`[data-testid=${t}]`), "확인 문구 " + t);
    await p.click("[data-testid=save]");
    await p.waitForFunction(() => [...document.querySelectorAll("#sheet .err")].some((e) => e.textContent.includes("전화번호 형식")));
    eq(Object.values((await fakeDb(p)).docs).filter((d) => d.customer && d.customer.name === "점검고객").length, 0, "저장 안 됨");
  });
  await step("닫았다 다시 열면 '저장하지 않은 입력' 불러오기", async () => {
    await closeSheet();
    await openNew();
    await p.waitForSelector("[data-testid=draft-note]");
    await p.click("[data-testid=draft-load]");
    eq(await p.inputValue("[data-testid=f-name]"), "점검고객");
    await closeSheet();
  });
  await step("같은 날 같은 고객이면 한 번 더 확인 후 저장", async () => {
    await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("wb.draft.")) localStorage.removeItem(k); });
    await openNew();
    await p.fill("[data-testid=f-date]", TOMORROW);
    await p.fill("[data-testid=f-phone]", "010-1234-5678");
    await p.fill("[data-testid=f-name]", "중복고객");
    await p.fill("[data-testid=f-addr]", "수원");
    await p.waitForSelector("[data-testid=dup]");
    await p.click("[data-testid=save]");
    eq(await p.innerText("[data-testid=save]"), "그래도 저장");
    ok(await p.isVisible("#sheet:not([hidden])"), "아직 열려 있음");
    await p.click("[data-testid=save]");
    await p.waitForSelector("#sheet", { state: "hidden" });
    eq(Object.values((await fakeDb(p)).docs).filter((d) => d.customer && String(d.customer.phone).replace(/\D/g, "") === "01012345678" && d.date === TOMORROW).length, 2, "같은 번호 예약 2건");
  });
  await step("인터넷이 끊기면 '저장 실패'와 입력 유지, 다시 저장해도 한 건만", async () => {
    await openNew();
    await p.fill("[data-testid=f-name]", "끊김고객");
    await p.fill("[data-testid=f-addr]", "용인");
    await setTotalWeb(p, "90000");
    await p.evaluate(() => { window.__fakesb.cfg.offline = true; });
    await p.click("[data-testid=save]");
    await p.waitForSelector("[data-testid=save-err]");
    eq(await p.innerText("[data-testid=save]"), "다시 저장");
    eq(await p.inputValue("[data-testid=f-name]"), "끊김고객", "입력 그대로");
    await p.evaluate(() => { window.__fakesb.cfg.offline = false; });
    await p.click("[data-testid=save]");
    await p.click("[data-testid=save]").catch(() => {}); // 두 번 눌러도
    await p.waitForSelector("#sheet", { state: "hidden" });
    await p.waitForTimeout(200);
    eq(Object.values((await fakeDb(p)).docs).filter((d) => d.customer && d.customer.name === "끊김고객").length, 1, "중복 없이 한 건");
  });

  // ---------------- 6. 사진(비공개 보관함) ----------------
  console.log("사진");
  const tinyJpeg = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
  await step("사진 올리기 → 서명된 주소로 표시", async () => {
    await p.click("[data-testid=tab-list]");
    await p.waitForSelector("[data-testid=card]");
    await p.locator("[data-testid=card]", { hasText: "김민지" }).locator("[data-testid=photos-btn]").click();
    await p.setInputFiles("[data-testid=file-before]", { name: "a.jpg", mimeType: "image/jpeg", buffer: tinyJpeg });
    await p.waitForSelector("[data-testid=grid-before] .ph img[data-blob][src*='token=']");
    const d = await fakeDb(p);
    const ids = Object.keys(d.files);
    eq(ids.length, 1);
    eq(d.files[ids[0]].owner, "u-shin");
    ok(d.docs["reservations/r_tmr"].photos[ids[0]].by === "smvivcjg03");
    await p.click("[data-pclose]");
  });
  const p2 = await webPage(ctx, { session: "u-park", label: "park" }); // 같은 기기(저장소 공유), 다른 탭에서 다른 직원
  await step("직원: 오늘 일정·내 작업·미배정 칸이 먼저", async () => {
    await p2.waitForSelector("[data-testid=tile-today]");
    for (const k of ["today", "mine", "open"]) ok(await p2.isVisible(`[data-testid=tile-${k}]`), "칸 " + k);
    eq(await p2.locator("[data-testid=tile-revenue]").count(), 0, "직원에겐 매출 칸 없음");
    eq((await p2.locator("#filters .chip").first().innerText()).replace(/\s+\d+$/, ""), "오늘");
  });
  await step("다른 직원: 남이 넣은 예약은 보기만, 직원 명단은 사장님만", async () => {
    await p2.waitForSelector("[data-testid=card]");
    await p2.locator("[data-testid=card]", { hasText: "남의고객" }).locator("[data-act=detail]").click();
    await p2.waitForSelector("[data-testid=readonly-note]");
    await p2.click("[data-testid=close-view]");
    await p2.click("[data-testid=tab-settings]");
    await p2.waitForSelector("[data-testid=my-account]");
    ok(!(await p2.$("[data-testid=staff-save]")), "명단 저장 버튼 없음");
    ok(!(await p2.$("[data-testid=accounts]")), "계정 관리 없음");
    await p2.click("[data-testid=tab-list]");
  });
  await step("다른 직원: 사장님 사진은 보이지만 지울 수 없음", async () => {
    await p2.locator("[data-testid=card]", { hasText: "김민지" }).locator("[data-testid=photos-btn]").click();
    await p2.waitForSelector("[data-testid=grid-before] .ph img[src*='token=']");
    await p2.click("[data-testid=grid-before] .ph");
    await p2.click("[data-testid=photo-del]");
    await p2.click("[data-testid=photo-del-yes]");
    await p2.waitForFunction(() => document.querySelector("#toast").textContent.includes("올린 사람이나 사장님만"));
    eq(Object.keys((await fakeDb(p2)).files).length, 1);
  });
  await step("다른 직원 화면에 새 예약 실시간 반영(같은 기기 다른 탭)", async () => {
    const t2 = await webPage(p2.context(), { session: "u-park", label: "park2", path: "" });
    await t2.waitForSelector("[data-testid=card]");
    await p2.evaluate(async () => {
      const db = await window.claude.use("db");
      await db.collection("reservations").doc("r_live").set({ date: new Date().toISOString().slice(0, 10), time: "11:00", durationMin: 60, status: "scheduled", customer: { name: "실시간고객", phone: "", address: "" }, items: [{ type: "통돌이", qty: 1, work: "세척" }], total: 1, payment: { method: "미정", paid: false }, workers: {}, createdBy: "smvivcjg01", createdAt: new Date().toISOString() });
    });
    await t2.waitForFunction(() => document.body.innerText.includes("실시간고객"));
    await t2.close();
  });

  // ---------------- 7. 고객 예약 페이지 ----------------
  console.log("고객 예약 페이지(book.html)");
  const bc = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const bp = watch(await bc.newPage(), "book");
  await bp.goto(BASE + "book.html");
  await step("빈 칸·기기 미선택·동의 없음이면 안내만", async () => {
    await bp.click("[data-testid=b-send]");
    ok(await bp.isVisible("#e-items"), "기기");
    ok(await bp.isVisible("#e-name"), "이름");
    ok(await bp.isVisible("#e-form"), "동의");
    eq(booked.length, 0);
  });
  await step("이전설치 선택 → 도착지 칸, 제출하면 요청 접수", async () => {
    await bp.click("[data-work='이전설치']");
    ok(await bp.isVisible("[data-testid=b-addr2]"));
    await bp.click("[data-type='건조기']");
    await bp.click("[data-type='LG 2단']");
    await bp.click("[data-q='1'][data-t='LG 2단']");
    await bp.fill("[data-testid=b-date]", TOMORROW);
    await bp.click("[data-slot='오전 (9~12시)']");
    await bp.fill("[data-testid=b-name]", "최고객");
    await bp.fill("[data-testid=b-phone]", "01077778888");
    await bp.fill("[data-testid=b-addr]", "출발 주소");
    await bp.fill("[data-testid=b-addr2]", "도착 주소");
    await bp.fill("[data-testid=b-note]", "3층");
    await bp.check("[data-testid=b-agree]");
    await bp.click("[data-testid=b-send]");
    await bp.waitForSelector("[data-testid=b-done]");
    eq(booked[0], { name: "최고객", phone: "010-7777-8888", address: "출발 주소", moveTo: "도착 주소", date: TOMORROW, timeSlot: "오전",
      items: [{ type: "건조기", qty: 1, work: "이전설치" }, { type: "LG 2단", qty: 2, work: "이전설치" }], note: "3층", website: "" });
  });
  await step("같은 번호로 바로 다시 보내면 '1분 뒤' 안내", async () => {
    await bp.reload();
    await bp.click("[data-type='통돌이']");
    await bp.fill("[data-testid=b-date]", TOMORROW);
    await bp.fill("[data-testid=b-name]", "최고객");
    await bp.fill("[data-testid=b-phone]", "010-7777-8888");
    await bp.fill("[data-testid=b-addr]", "주소");
    await bp.check("[data-testid=b-agree]");
    await bp.click("[data-testid=b-send]");
    await bp.waitForFunction(() => !document.querySelector("#e-form").hidden && document.querySelector("#e-form").textContent.includes("1분 뒤"));
  });
  await step("고객 페이지 가로 스크롤 없음", async () => {
    const r = await bp.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    ok(r[0] <= r[1], r.join(">"));
  });

  // ---------------- 처음 비밀번호 바꾸기 안내 ----------------
  console.log("처음 비밀번호(000000) 안내");
  const kc = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const kp = await webPage(kc, { label: "kim", seed: { docs: { "config/staff": STAFF } } });
  const login = async (page, name, pin) => {
    await page.click(`[data-testid=login-${name}]`);
    for (const d of pin) await page.click(`.pin-pad [data-key="${d}"]`);
    await page.waitForSelector("#login", { state: "detached" });
  };
  await step("000000으로 들어온 직원: 바꾸기 안내 → [나중에]해도 다시 열면 또 안내", async () => {
    await login(kp, "김영우", "000000");
    await kp.waitForSelector("[data-testid=pin-input]");
    ok((await kp.innerText("#modal")).includes("김영우님, 비밀번호를 바꿔 주세요"));
    await kp.click("[data-testid=pin-later]");
    await kp.reload();
    await kp.waitForSelector("[data-testid=pin-input]");
  });
  await step("000000으로는 못 바꾸고, 새 번호로 바꾸면 안내 끝", async () => {
    await kp.fill("[data-testid=pin-input]", "000000");
    await kp.click("[data-testid=pin-save]");
    await kp.waitForFunction(() => document.querySelector("#toast").textContent.includes("000000 말고"));
    await kp.fill("[data-testid=pin-input]", "246810");
    await kp.click("[data-testid=pin-save]");
    await kp.waitForSelector("#modal", { state: "hidden" });
    eq((await fakeDb(kp)).accounts.find((a) => a.uid === "u-kim").pin, "246810");
    await kp.reload();
    await kp.waitForSelector("[data-testid=card], [data-testid=empty]");
    await kp.waitForTimeout(300);
    ok(!(await kp.isVisible("[data-testid=pin-input]")), "다시 안 뜸");
  });
  await step("사장님은 000000으로 들어와도 안내 없음", async () => {
    await kp.evaluate(() => { const d = JSON.parse(localStorage.getItem("fakesb")); d.accounts.find((a) => a.uid === "u-shin").pin = "000000"; localStorage.setItem("fakesb", JSON.stringify(d)); sessionStorage.removeItem("fakesb.session"); });
    await kp.reload();
    await login(kp, "신창민", "000000");
    await kp.waitForSelector("[data-testid=card], [data-testid=empty]");
    await kp.waitForTimeout(300);
    ok(!(await kp.isVisible("[data-testid=pin-input]")), "사장님은 안내 없음");
  });
  await kc.close();

  // ---------------- 8. PWA·로그아웃 ----------------
  console.log("PWA·로그아웃");
  await step("홈 화면 앱: manifest·아이콘·서비스 워커", async () => {
    const m = await p.evaluate(async () => {
      const link = document.querySelector("link[rel=manifest]").href;
      const j = await (await fetch(link)).json();
      const icons = await Promise.all(j.icons.map(async (i) => (await fetch(new URL(i.src, link))).status));
      const reg = await navigator.serviceWorker.getRegistration();
      return { name: j.name, theme: j.theme_color, display: j.display, sizes: j.icons.map((i) => i.sizes), icons, sw: !!reg, touch: (await fetch(document.querySelector("link[rel=apple-touch-icon]").href)).status };
    });
    eq(m.name, "세탁기 크루"); eq(m.theme, "#00419B"); eq(m.display, "standalone");
    ok(m.sizes.includes("192x192") && m.sizes.includes("512x512"), m.sizes.join());
    ok(m.icons.every((s) => s === 200) && m.touch === 200, "아이콘");
    ok(m.sw, "서비스 워커 등록");
  });
  await step("CSV 받기: 파일 내려받기", async () => {
    await p.click("[data-testid=tab-stats]");
    const [dl] = await Promise.all([p.waitForEvent("download"), p.click("[data-testid=csv]")]);
    ok(/^washer-crew_\d{4}-\d{2}\.csv$/.test(dl.suggestedFilename()), dl.suggestedFilename());
    const buf = fs.readFileSync(await dl.path());
    ok(buf.slice(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), "엑셀용 BOM");
  });
  await step("로그아웃 → 로그인 화면", async () => {
    await p.click("[data-testid=me-chip]");
    await p.click("[data-testid=logout]");
    await p.waitForSelector("[data-testid=login-신창민]");
    eq(await p.evaluate(() => sessionStorage.getItem("fakesb.session")), null);
  });
  await step("가로 스크롤 없음·콘솔 오류 0건", async () => {
    const r = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    ok(r[0] <= r[1], r.join(">"));
    eq(errors.length, 0, errors.join("\n"));
  });

  await browser.close();
  server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
