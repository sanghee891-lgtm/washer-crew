// node test/e2e.test.js  — 실제 화면을 브라우저로 조작해 주요 기능을 검증합니다.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "/opt/node22/lib/node_modules/playwright");
const mockClaude = require("./mock-claude.js");

const ROOT = path.join(__dirname, "..");
const SHOTS = process.env.SHOTS || path.join(__dirname, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

// 게시할 때 붙는 문서 골격을 흉내 냅니다.
function skeleton(body) {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    "<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>" +
    body + "</body></html>";
}
const blobs = new Map(); // 가짜 asset 저장소 (/_blob/<id>)
const server = http.createServer((req, res) => {
  const u = req.url.split("?")[0];
  if (u === "/__blobcount") { res.writeHead(200); return res.end(String(blobs.size)); }
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
  if (u === "/" || u === "/index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(skeleton(fs.readFileSync(path.join(ROOT, "index.html"), "utf8")));
  }
  if (u === "/favicon.ico") { res.writeHead(204); return res.end(); }
  const f = path.join(ROOT, path.normalize(u));
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": f.endsWith(".js") ? "text/javascript; charset=utf-8" : f.endsWith(".webp") ? "image/webp" : "text/plain" });
  res.end(fs.readFileSync(f));
});

let passed = 0, failed = 0;
const failures = [];
async function step(name, fn) {
  try { await fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; failures.push(name); console.log("  FAIL " + name + "\n       " + String(e.message || e).split("\n").slice(0, 4).join("\n       ")); }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || "") + " 기대값=" + JSON.stringify(b) + " 실제=" + JSON.stringify(a)); }
function ok(v, msg) { if (!v) throw new Error(msg || "조건 불충족"); }

function pad(n) { return (n < 10 ? "0" : "") + n; }
const now = new Date();
const TODAY = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
const YM = TODAY.slice(0, 7);
const nm = new Date(now.getFullYear(), now.getMonth() + 1, 5);
const NEXT_DAY = nm.getFullYear() + "-" + pad(nm.getMonth() + 1) + "-05";
const NEXT_YM = NEXT_DAY.slice(0, 7);

async function newPage(ctx, cfg, errors) {
  const page = await ctx.newPage();
  await page.addInitScript(mockClaude, cfg);
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  return page;
}
async function txt(page, sel) { return (await page.locator(sel).first().innerText()).trim(); }
async function noHScroll(page) {
  const r = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  ok(r[0] <= r[1], "가로 스크롤 발생: " + r[0] + " > " + r[1]);
}
async function setTotal(page, v) { await page.fill("[data-testid=f-total]", ""); await page.type("[data-testid=f-total]", String(v)); }

(async () => {
  await new Promise((r) => server.listen(0, r));
  const BASE = "http://127.0.0.1:" + server.address().port + "/";
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
  const errors = [];

  // ---------------- 모바일 ----------------
  console.log("모바일(390×844)");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, locale: "ko-KR", timezoneId: "Asia/Seoul" });
  const p1 = await newPage(ctx, { uid: "u_kim" }, errors);
  await p1.goto(BASE);

  await step("처음 접속 시 직원 명단 입력 → 이름 선택", async () => {
    await p1.waitForSelector("[data-testid=setup-input]");
    const names = ["김철수", "이영희", "박민수", "최지훈", "정수진"];
    const inputs = p1.locator("[data-testid=setup-input]");
    for (let i = 0; i < 5; i++) await inputs.nth(i).fill(names[i]);
    await p1.click("[data-testid=setup-save]");
    await p1.click("[data-testid=pick-김철수]");
    await p1.waitForFunction(() => document.querySelector("#meName").textContent === "김철수님");
  });

  await step("빈 달 안내 문구", async () => {
    await p1.waitForSelector("[data-testid=empty]");
    ok((await txt(p1, "[data-testid=empty]")).includes("예약이 아직 없어요"));
  });

  await step("예약 등록(기기 2줄·대수·소요시간·금액)", async () => {
    await p1.click("[data-testid=add]");
    await p1.fill("[data-testid=f-phone]", "01012345678");
    await p1.fill("[data-testid=f-name]", "홍길동");
    await p1.fill("[data-testid=f-addr]", "서울 강남구 테헤란로 1, 101동 1203호");
    await p1.fill("[data-testid=f-time]", "10:00");
    await p1.click("button[data-f=dur][data-v='120']");
    eq(await txt(p1, "[data-testid=end-time]"), "12:00", "종료시간");
    await p1.selectOption("[data-testid=item] >> nth=0 >> [data-testid=item-type]", "통돌이");
    await p1.fill("[data-testid=item] >> nth=0 >> [data-testid=item-model]", "WA16T6A10");
    await p1.click("[data-testid=add-item]");
    await p1.selectOption("[data-testid=item] >> nth=1 >> [data-testid=item-type]", "건조기");
    await p1.click("[data-testid=item] >> nth=1 >> [data-testid=item-plus]");
    eq(await p1.inputValue("[data-testid=item] >> nth=1 >> [data-testid=item-qty]"), "2", "대수 +");
    await setTotal(p1, "150000");
    eq(await p1.inputValue("[data-testid=f-total]"), "150,000", "금액 콤마");
    const sw = await p1.evaluate(() => document.querySelector("[data-testid=save]").getBoundingClientRect().width);
    ok(sw > 200, "저장 버튼이 너무 좁음: " + sw);
    await p1.screenshot({ path: path.join(SHOTS, "m-form.png") });
    await p1.click("[data-testid=save]");
    await p1.waitForSelector("#sheet[hidden]", { state: "attached" });
    await p1.waitForSelector("[data-testid=card]");
  });

  await step("목록 카드에 시간·고객·기기·금액·참여자 표시", async () => {
    const card = p1.locator("[data-testid=card]").first();
    const t = await card.innerText();
    for (const s of ["10:00", "~12:00", "2시간", "홍길동", "통돌이 1대", "건조기 2대", "세척", "WA16T6A10", "150,000원", "010-1234-5678", "테헤란로", "김철수", "1/2명"]) ok(t.includes(s), "카드에 '" + s + "' 없음:\n" + t);
  });

  await step("상단 요약: 1건 · 150,000원", async () => {
    eq(await txt(p1, "[data-testid=top-count]"), "1건");
    eq(await txt(p1, "[data-testid=top-revenue]"), "150,000원");
  });

  await step("통계 반영(예정 매출·기기별 대수)", async () => {
    await p1.click("[data-testid=tab-stats]");
    eq(await txt(p1, "[data-testid=st-count]"), "1건");
    eq(await txt(p1, "[data-testid=st-total]"), "150,000원");
    eq(await txt(p1, "[data-testid=st-done]"), "0원");
    eq(await txt(p1, "[data-testid=by-type] [data-type='통돌이']"), "1대");
    eq(await txt(p1, "[data-testid=by-type] [data-type='건조기']"), "2대");
    ok(await p1.locator("[data-testid=year-chart] svg path").count() >= 1, "그래프 막대 없음");
    const fillW = await p1.evaluate(() => document.querySelector("[data-testid=by-type] .fill").getBoundingClientRect().width);
    ok(fillW > 20, "기기별 막대가 채워지지 않음: " + fillW);
    const ticks = await p1.$$eval("[data-testid=year-chart] svg text", (ts) => ts.map((t) => t.textContent).filter((x) => /만$|^0$/.test(x)));
    ok(ticks.every((x) => /^(0|\d+(\.5)?만)$/.test(x)), "눈금 값: " + ticks.join(","));
  });

  await step("예약 수정(금액·완료·입금) → 통계 재반영", async () => {
    await p1.click("[data-testid=tab-list]");
    await p1.click("[data-testid=card] .c-name");
    await setTotal(p1, "180000");
    await p1.click("button[data-f=status][data-v=done]");
    await p1.click("button[data-f=method][data-v='카드']");
    await p1.check("[data-testid=f-paid]");
    await p1.click("[data-testid=save]");
    await p1.waitForSelector("#sheet[hidden]", { state: "attached" });
    await p1.waitForFunction(() => document.querySelector("[data-testid=card-amt]").textContent === "180,000원");
    await p1.click("[data-testid=tab-stats]");
    eq(await txt(p1, "[data-testid=st-done]"), "180,000원");
    eq(await txt(p1, "[data-testid=st-total]"), "180,000원");
    eq(await txt(p1, "[data-testid=st-unpaid]"), "0원");
  });

  await step("시간 겹침 경고(같은 직원·겹치는 시간)", async () => {
    await p1.click("[data-testid=tab-list]");
    await p1.click("[data-testid=add]");
    await p1.fill("[data-testid=f-phone]", "010-9876-5432");
    await p1.fill("[data-testid=f-name]", "이순신");
    await p1.fill("[data-testid=f-addr]", "수원시 영통구 1");
    await p1.fill("[data-testid=f-time]", "11:00");
    await p1.click("button[data-f=dur][data-v='60']");
    await p1.selectOption("[data-testid=item] >> nth=0 >> [data-testid=item-type]", "LG 2단");
    await p1.selectOption("[data-testid=item] >> nth=0 >> [data-testid=item-work]", "이전설치");
    await setTotal(p1, "120000");
    await p1.click("button[data-f=needed][data-v='3']");
    await p1.waitForSelector("[data-testid=form-conflict]");
    ok((await txt(p1, "[data-testid=form-conflict]")).includes("김철수"), "겹침 문구에 직원 이름");
    await p1.click("[data-testid=save]");
    await p1.waitForSelector("#sheet[hidden]", { state: "attached" });
    await p1.waitForFunction(() => document.querySelectorAll("[data-testid=card]").length === 2);
    eq(await p1.locator(".card [data-testid=conflict]").count(), 2, "두 카드 모두 경고");
  });

  await step("여러 직원이 동시에 참여 체크해도 모두 남음(실시간 공유)", async () => {
    const p2 = await newPage(ctx, { uid: "u_lee" }, errors);
    const p3 = await newPage(ctx, { uid: "u_park" }, errors);
    for (const [p, n] of [[p2, "이영희"], [p3, "박민수"]]) {
      await p.goto(BASE);
      await p.click("[data-testid=pick-" + n + "]");
      await p.waitForSelector("[data-testid=card]");
    }
    // 이순신(11:00, 예약 상태) 카드의 참여하기 동시 클릭
    const sel = ".card:has(.c-name:text-is('이순신')) [data-testid=join]";
    await Promise.all([p2.click(sel), p3.click(sel)]);
    await p1.waitForFunction(() => {
      const c = [...document.querySelectorAll(".card")].find((x) => x.querySelector(".c-name").textContent === "이순신");
      return c && c.textContent.includes("이영희") && c.textContent.includes("박민수") && c.textContent.includes("3/3명");
    }, null, { timeout: 4000 });
    // 참여 취소
    await p2.click(sel);
    await p1.waitForFunction(() => {
      const c = [...document.querySelectorAll(".card")].find((x) => x.querySelector(".c-name").textContent === "이순신");
      return c && !c.textContent.includes("이영희") && c.textContent.includes("2/3명");
    }, null, { timeout: 4000 });
    // 이영희 '내 일정'
    await p3.click("[data-testid=filter-mine]");
    eq(await p3.locator("[data-testid=card]").count(), 1, "박민수 내 일정");
    await p2.close(); await p3.close();
  });

  await step("빠른 완료·입금확인 → 미수금 집계", async () => {
    const card = ".card:has(.c-name:text-is('이순신'))";
    await p1.click(card + " [data-testid=quick-done]");
    await p1.waitForSelector(card + " [data-testid=quick-paid]");
    await p1.click("[data-testid=tab-stats]");
    eq(await txt(p1, "[data-testid=st-unpaid]"), "120,000원");
    eq(await txt(p1, "[data-testid=st-done]"), "300,000원");
    await p1.click("[data-testid=tab-list]");
    await p1.click("[data-testid=filter-unpaid]");
    eq(await p1.locator("[data-testid=card]").count(), 1);
    await p1.click(card + " [data-testid=quick-paid]");
    await p1.waitForSelector("[data-testid=empty]");
    await p1.click("[data-testid=filter-all]");
    await p1.click("[data-testid=tab-stats]");
    eq(await txt(p1, "[data-testid=st-unpaid]"), "0원");
    eq(await txt(p1, "[data-testid=by-staff]").then((t) => /김철수\s+2건/.test(t)), true, "직원별 참여 2건");
  });

  await step("다른 달 예약은 그 달에만 집계", async () => {
    await p1.click("[data-testid=tab-list]");
    await p1.click("[data-testid=add]");
    await p1.fill("[data-testid=f-date]", NEXT_DAY);
    await p1.fill("[data-testid=f-name]", "강감찬");
    await p1.fill("[data-testid=f-phone]", "01055556666");
    await p1.selectOption("[data-testid=item] >> nth=0 >> [data-testid=item-type]", "빌트인");
    await setTotal(p1, "90000");
    await p1.click("[data-testid=save]");
    await p1.waitForSelector("#sheet[hidden]", { state: "attached" });
    await p1.waitForFunction((ym) => document.querySelector("[data-testid=month-label]").textContent.includes(+ym.slice(5) + "월"), NEXT_YM);
    await p1.waitForFunction(() => document.querySelector("[data-testid=top-count]").textContent === "1건");
    eq(await txt(p1, "[data-testid=top-revenue]"), "90,000원");
    await p1.click("[data-testid=prev-month]");
    await p1.waitForFunction(() => document.querySelector("[data-testid=top-count]").textContent === "2건");
    eq(await txt(p1, "[data-testid=top-revenue]"), "300,000원");
  });

  await step("달력: 오늘 칸 건수 → 누르면 그날 예약", async () => {
    await p1.click("[data-testid=tab-cal]");
    const cell = "[data-testid=day-" + TODAY + "]";
    ok((await txt(p1, cell)).includes("2건"), "오늘 칸 2건");
    await p1.click(cell);
    eq(await p1.locator("[data-testid=cal-day-list] [data-testid=card]").count(), 2);
    await noHScroll(p1);
    await p1.screenshot({ path: path.join(SHOTS, "m-cal.png") });
  });

  await step("고객 이력: 전화번호로 이전 작업 불러오기", async () => {
    await p1.click("[data-testid=tab-list]");
    await p1.click("[data-testid=add]");
    await p1.fill("[data-testid=f-phone]", "010-1234-5678");
    await p1.waitForSelector("[data-testid=history]");
    ok((await txt(p1, "[data-testid=history]")).includes("이전 작업 1건"));
    await p1.click("[data-testid=fill-history]");
    eq(await p1.inputValue("[data-testid=f-name]"), "홍길동");
    ok((await p1.inputValue("[data-testid=f-addr]")).includes("테헤란로"));
    await p1.click("#sheet [data-x] >> nth=0");
    await p1.waitForSelector("#sheet[hidden]", { state: "attached" });
  });

  await step("입력 검사: 고객 정보 없으면 저장 안 됨", async () => {
    const before = await p1.locator("[data-testid=card]").count();
    await p1.click("[data-testid=add]");
    await p1.click("[data-testid=save]");
    ok((await p1.locator("#sheet .err").innerText()).includes("고객 이름이나 전화번호"));
    await p1.click("#sheet [data-x] >> nth=0");
    eq(await p1.locator("[data-testid=card]").count(), before);
  });

  await step("검색(올해 전체)", async () => {
    await p1.fill("[data-testid=search]", "강감찬");
    eq(await p1.locator("[data-testid=card]").count(), 1);
    await p1.fill("[data-testid=search]", "5432");
    eq(await p1.locator("[data-testid=card]").count(), 1);
    await p1.fill("[data-testid=search]", "");
  });

  await step("엑셀(CSV) 내보내기 내용", async () => {
    await p1.click("[data-testid=tab-stats]");
    await p1.click("[data-testid=csv]");
    await p1.waitForFunction(() => window.__saved.length === 1);
    const f = await p1.evaluate(() => window.__saved[0]);
    eq(f.filename, "예약내역_" + YM + ".csv");
    ok(f.data.startsWith("﻿예약일자"), "BOM/헤더");
    ok(f.data.includes("홍길동") && f.data.includes("180000") && f.data.includes("이순신"), "행 내용");
    ok(!f.data.includes("강감찬"), "다른 달 제외");
    eq(f.data.trim().split("\r\n").length, 3, "헤더+2행");
  });

  await step("모바일 화면 가로 스크롤 없음(모든 탭)", async () => {
    for (const t of ["list", "cal", "stats", "settings"]) { await p1.click("[data-testid=tab-" + t + "]"); await noHScroll(p1); }
    await p1.click("[data-testid=tab-stats]");
    await p1.screenshot({ path: path.join(SHOTS, "m-stats.png"), fullPage: true });
    await p1.click("[data-testid=tab-list]");
    await p1.screenshot({ path: path.join(SHOTS, "m-list.png") });
  });

  await step("로고·앱 이름·개발자 표시, 이미지 로드", async () => {
    eq(await p1.title(), "세탁기 크루");
    eq((await txt(p1, ".word")).replace(/\s+/g, " "), "세탁기 크루");
    await p1.click("[data-testid=tab-settings]");
    ok((await txt(p1, "[data-testid=about]")).includes("개발 · 신창민"));
    const imgs = await p1.$$eval("img", (xs) => xs.map((i) => [i.getAttribute("src"), i.complete && i.naturalWidth > 0]));
    ok(imgs.length >= 2 && imgs.every((x) => x[1]), "이미지 로드 실패: " + JSON.stringify(imgs));
    const font = await p1.evaluate(() => getComputedStyle(document.body).fontFamily);
    ok(font.startsWith('"Noto Sans KR"'), font);
    await p1.screenshot({ path: path.join(SHOTS, "m-settings.png"), fullPage: true });
  });

  await step("직원 명단 수정 → 카드 이름 반영", async () => {
    await p1.click("[data-testid=tab-settings]");
    await p1.locator("[data-testid=staff-input]").nth(2).fill("박민호");
    await p1.click("[data-testid=staff-save]");
    await p1.click("[data-testid=tab-list]");
    await p1.waitForFunction(() => document.body.innerText.includes("박민호"));
  });

  await step("예약 삭제 → 목록·통계 감소", async () => {
    await p1.click(".card:has(.c-name:text-is('홍길동')) .c-name");
    await p1.click("[data-testid=del]");
    await p1.click("[data-testid=del-yes]");
    await p1.waitForFunction(() => document.querySelectorAll("[data-testid=card]").length === 1);
    eq(await txt(p1, "[data-testid=top-count]"), "1건");
    eq(await txt(p1, "[data-testid=top-revenue]"), "120,000원");
    await p1.click("[data-testid=tab-stats]");
    eq(await txt(p1, "[data-testid=st-done]"), "120,000원");
    eq(await txt(p1, "[data-testid=by-type] [data-type='통돌이']"), "0대");
  });

  await step("다른 사람이 먼저 고친 예약은 덮어쓰기 전에 경고", async () => {
    await p1.click("[data-testid=tab-list]");
    await p1.click(".card:has(.c-name:text-is('이순신')) .c-name");
    const p2 = await newPage(ctx, { uid: "u_lee" }, errors);
    await p2.goto(BASE);
    await p2.waitForSelector(".card:has(.c-name:text-is('이순신'))");
    await p2.click(".card:has(.c-name:text-is('이순신')) .c-name");
    await setTotal(p2, "130000");
    await p2.click("[data-testid=save]");
    await p2.waitForSelector("#sheet[hidden]", { state: "attached" });
    await p1.waitForSelector("[data-testid=stale]");
    ok((await txt(p1, "[data-testid=stale]")).includes("이영희"), "누가 고쳤는지 표시");
    await p1.click("[data-testid=save]");      // 첫 클릭: 경고만
    ok(await p1.isVisible("#sheet .sheet-in"), "첫 저장은 막힘");
    await p1.click("[data-testid=save]");      // 두 번째: 저장
    await p1.waitForSelector("#sheet[hidden]", { state: "attached" });
    await p2.close();
  });

  await step("자정 넘김·직접 입력 소요시간", async () => {
    await p1.click("[data-testid=add]");
    await p1.fill("[data-testid=f-time]", "22:00");
    await p1.click("button[data-f=dur][data-v=custom]");
    await p1.fill("[data-testid=f-durmin]", "150");
    eq(await txt(p1, "[data-testid=end-time]"), "00:30 (다음날)");
    await p1.click("#sheet [data-x] >> nth=0");
  });
  await ctx.close();

  // ---------------- PC ----------------
  console.log("PC(1280×800)");
  const ctxD = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ko-KR", timezoneId: "Asia/Seoul" });
  const d1 = await newPage(ctxD, { uid: "u_kim" }, errors);
  await d1.goto(BASE);
  await step("PC 첫 설정 후 표 형태 목록", async () => {
    await d1.waitForSelector("[data-testid=setup-input]");
    await d1.locator("[data-testid=setup-input]").nth(0).fill("김철수");
    await d1.locator("[data-testid=setup-input]").nth(1).fill("이영희");
    await d1.click("[data-testid=setup-save]");
    await d1.click("[data-testid=pick-김철수]");
    await d1.click("[data-testid=add]");
    await d1.fill("[data-testid=f-name]", "PC고객");
    await d1.fill("[data-testid=f-phone]", "0212345678");
    await d1.fill("[data-testid=f-addr]", "서울 중구 세종대로 110");
    await setTotal(d1, "95000");
    await d1.click("[data-testid=save]");
    await d1.waitForSelector("table.tbl tr.row");
    const t = await d1.locator("table.tbl tr.row").first().innerText();
    ok(t.includes("PC고객") && t.includes("02-1234-5678") && t.includes("95,000원"), t);
    await noHScroll(d1);
    await d1.screenshot({ path: path.join(SHOTS, "d-list.png") });
    await d1.click("[data-testid=tab-stats]");
    await noHScroll(d1);
    await d1.screenshot({ path: path.join(SHOTS, "d-stats.png"), fullPage: true });
    await d1.click("[data-testid=tab-cal]");
    await d1.screenshot({ path: path.join(SHOTS, "d-cal.png") });
  });
  await ctxD.close();

  // ---------------- 권한·연결 ----------------
  console.log("권한·연결 상태");
  await step("보기 전용: 안내 표시, 추가 버튼 숨김, 버튼 없음", async () => {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await newPage(c, { uid: "u_view", readOnly: true }, errors);
    await p.goto(BASE);
    await p.evaluate(() => {
      localStorage.setItem("mockdb", JSON.stringify({
        "config/staff": { list: [{ id: "s1", name: "김철수" }] },
        "reservations/r1": { date: new Date().toISOString().slice(0, 8) + "15", time: "09:00", durationMin: 60, status: "scheduled", customer: { name: "보기고객", phone: "", address: "" }, items: [{ type: "통돌이", qty: 1, work: "세척" }], total: 50000, payment: { method: "미정", paid: false }, workers: {} }
      }));
      localStorage.setItem("wb.staffId.u_view", "s1");
    });
    await p.reload();
    await p.waitForSelector(".banner");
    ok((await txt(p, ".banner")).includes("보기 전용"));
    ok(!(await p.isVisible("[data-testid=add]")), "추가 버튼 숨김");
    await p.waitForSelector("[data-testid=card]");
    eq(await p.locator("[data-testid=join]").count(), 0, "참여 버튼 숨김");
    await c.close();
  });
  await step("공유 저장소 없음: 안내 표시, 오류 없이 동작", async () => {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await newPage(c, { noClaude: true }, errors);
    await p.goto(BASE);
    await p.waitForSelector(".banner");
    ok((await txt(p, ".banner")).includes("연결되지 않았어요"));
    await p.click("[data-testid=tab-stats]");
    eq(await txt(p, "[data-testid=st-count]"), "0건");
    await c.close();
  });

  // ---------------- 내비 ----------------
  console.log("주소 → 내비 앱");
  const NAV_ADDR = "서울 강남구 테헤란로 1, 101동 1203호";
  const NAV_ENC = encodeURIComponent(NAV_ADDR);
  async function navPage(ua, viewport) {
    const c = await browser.newContext({ viewport: viewport || { width: 390, height: 844 }, userAgent: ua, hasTouch: !!ua, permissions: ["clipboard-read", "clipboard-write"] });
    const p = await newPage(c, { uid: "u_nav" }, errors);
    await p.goto(BASE);
    await p.evaluate((addr) => {
      localStorage.setItem("mockdb", JSON.stringify({
        "config/staff": { list: [{ id: "s1", name: "김철수" }] },
        "reservations/r1": { date: new Date().toISOString().slice(0, 10), time: "09:00", durationMin: 60, status: "scheduled", customer: { name: "내비고객", phone: "01011112222", address: addr }, site: { floor: "12", elevator: "있음", parking: "", memo: "" }, items: [{ type: "통돌이", qty: 1, work: "세척" }], total: 50000, payment: { method: "미정", paid: false }, workers: { s1: true } }
      }));
      localStorage.setItem("wb.staffId.u_nav", "s1");
    }, NAV_ADDR);
    await p.reload();
    // 테스트 중 실제 앱 링크로 이동하지 않도록(앱 쪽 클릭 처리는 그대로 실행)
    await p.evaluate(() => document.addEventListener("click", (e) => { if (e.target.closest("[data-nav]")) e.preventDefault(); }));
    await p.waitForSelector("[data-testid=card]");
    return { c, p };
  }
  const openAddr = async (p) => { await p.click("[data-testid=card] [data-act=addr]"); await p.waitForSelector("#modal .modal-in"); };

  await step("Android: 티맵이 맨 위, intent 링크에 주소 포함", async () => {
    const { c, p } = await navPage("Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36");
    await openAddr(p);
    eq(await p.getAttribute("#modal .nav-main", "data-nav"), "tmap", "맨 위 버튼");
    const href = await p.getAttribute("[data-testid=nav-tmap]", "href");
    ok(href.startsWith("intent://search?name=" + NAV_ENC + "#Intent;scheme=tmap;package=com.skt.tmap.ku"), href);
    ok((await txt(p, "#modal")).includes("12층 · 엘리베이터 있음"), "현장 정보 표시");
    await p.click("[data-testid=nav-kakaonavi]");
    await p.waitForFunction(() => document.querySelector("#toast").textContent.includes("카카오내비 검색창"));
    eq(await p.evaluate(() => navigator.clipboard.readText()), NAV_ADDR, "클립보드에 주소");
    await p.screenshot({ path: path.join(SHOTS, "m-nav.png") });
    // 설정에서 내 내비 앱을 카카오내비로 바꾸면 맨 위가 바뀜
    await p.click("#modal", { position: { x: 10, y: 10 } });
    await p.click("[data-testid=tab-settings]");
    await p.click("[data-navpref=kakaonavi]");
    eq(await p.getAttribute("[data-navpref=kakaonavi]", "aria-pressed"), "true");
    await p.click("[data-testid=tab-list]");
    await openAddr(p);
    eq(await p.getAttribute("#modal .nav-main", "data-nav"), "kakaonavi", "설정 후 맨 위 버튼");
    await noHScroll(p);
    await c.close();
  });
  await step("iPhone: tmap:// 주소 검색 링크", async () => {
    const { c, p } = await navPage("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1");
    await openAddr(p);
    eq(await p.getAttribute("#modal .nav-main", "href"), "tmap://search?name=" + NAV_ENC);
    eq(await p.getAttribute("[data-testid=nav-kakaomap]", "href"), "kakaomap://search?q=" + NAV_ENC);
    await c.close();
  });
  await step("PC: 웹 지도 버튼만", async () => {
    const { c, p } = await navPage(undefined, { width: 1280, height: 800 });
    await openAddr(p);
    eq(await p.locator("[data-testid=nav-tmap]").count(), 0);
    eq(await p.getAttribute("[data-testid=web-kakaomap]", "href"), "https://map.kakao.com/link/search/" + NAV_ENC);
    await c.close();
  });

  // ---------------- 작업 사진 · 이전설치 ----------------
  console.log("작업 사진 · 이전설치");
  {
    const ctxP = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const owner = await newPage(ctxP, { uid: "u_owner", owner: true }, errors);
    await owner.goto(BASE);
    await owner.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("mockdb", JSON.stringify({
        "config/staff": { list: [{ id: "s1", name: "김철수" }, { id: "s2", name: "이영희" }] },
        "reservations/rp": { date: new Date().toISOString().slice(0, 10), time: "13:00", durationMin: 120, status: "scheduled", customer: { name: "사진고객", phone: "01033334444", address: "수원시 영통구 1" }, site: {}, items: [{ type: "통돌이", qty: 1, work: "세척" }], total: 80000, payment: { method: "미정", paid: false }, workers: { s1: true } }
      }));
      localStorage.setItem("wb.staffId.u_owner", "s1");
      localStorage.setItem("wb.staffId.u_lee", "s2");
      localStorage.setItem("wb.staffId.u_view", "s2");
    });
    await owner.reload();
    await owner.waitForSelector("[data-testid=card]");
    const mkPng = (w, h, color) => owner.evaluate(([w, h, color]) => {
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const x = c.getContext("2d"); x.fillStyle = color; x.fillRect(0, 0, w, h); x.fillStyle = "#fff"; x.fillRect(w / 4, h / 4, w / 2, h / 2);
      return c.toDataURL("image/png").split(",")[1];
    }, [w, h, color]).then((b64) => Buffer.from(b64, "base64"));
    const big = await mkPng(3000, 2000, "#0693f8");
    const small1 = await mkPng(800, 600, "#00419b");
    const small2 = await mkPng(600, 800, "#17784a");
    const imgsLoaded = (p, sel) => p.waitForFunction((sel) => { const xs = [...document.querySelectorAll(sel)]; return xs.length && xs.every((i) => i.complete && i.naturalWidth > 0); }, sel);

    await step("사진 추가: 큰 사진은 1600px JPEG로 줄여서 올림", async () => {
      ok((await txt(owner, "[data-testid=photos-btn]")).includes("사진 추가"));
      await owner.click("[data-testid=photos-btn]");
      await owner.setInputFiles("[data-testid=file-before]", { name: "before.png", mimeType: "image/png", buffer: big });
      await owner.waitForFunction(() => document.querySelectorAll("[data-testid=grid-before] img").length === 1);
      await imgsLoaded(owner, "[data-testid=grid-before] img");
      await owner.click("[data-testid=grid-before] .ph");
      await imgsLoaded(owner, "[data-testid=photo-big]");
      const dim = await owner.evaluate(() => { const i = document.querySelector("[data-testid=photo-big]"); return [i.naturalWidth, i.naturalHeight]; });
      eq(dim.join("x"), "1600x1067", "줄인 크기");
      const type = await owner.evaluate(() => fetch(document.querySelector("[data-testid=photo-big]").src).then((r) => r.headers.get("content-type")));
      eq(type, "image/jpeg");
      ok((await txt(owner, "#modal")).includes("김철수"), "올린 사람 표시");
      await owner.click("[data-pback]");
    });
    await step("작업 후 사진 2장 한 번에 → 카드에 '사진 3'", async () => {
      await owner.setInputFiles("[data-testid=file-after]", [
        { name: "a1.png", mimeType: "image/png", buffer: small1 }, { name: "a2.png", mimeType: "image/png", buffer: small2 }]);
      await owner.waitForFunction(() => document.querySelectorAll("[data-testid=grid-after] img").length === 2);
      await imgsLoaded(owner, "[data-testid=grid-after] img");
      await noHScroll(owner);
      await owner.screenshot({ path: path.join(SHOTS, "m-photos.png") });
      await owner.click("[data-pclose]");
      await owner.waitForFunction(() => document.querySelector("[data-testid=photos-btn]").textContent.includes("사진 3"));
    });
    const staff = await newPage(ctxP, { uid: "u_lee" }, errors);
    await staff.goto(BASE);
    await step("다른 직원 화면에도 사진이 보이고, 남의 사진은 못 지움", async () => {
      await staff.waitForFunction(() => (document.querySelector("[data-testid=photos-btn]") || {}).textContent === "사진 3");
      await staff.click("[data-testid=photos-btn]");
      await imgsLoaded(staff, "#modal .ph img");
      await staff.click("[data-testid=grid-before] .ph");
      await staff.click("[data-testid=photo-del]");
      await staff.click("[data-testid=photo-del-yes]");
      await staff.waitForFunction(() => document.querySelector("#toast").textContent.includes("올린 사람이나 사장님만"));
      await staff.click("[data-pback]");
      eq(await staff.locator("[data-testid=grid-before] img").count(), 1, "사진 남아 있음");
    });
    await step("직원이 올린 사진: 사장님 화면에 실시간 반영, 본인은 삭제 가능", async () => {
      await staff.setInputFiles("[data-testid=file-after]", { name: "s.png", mimeType: "image/png", buffer: small1 });
      await staff.waitForFunction(() => document.querySelectorAll("[data-testid=grid-after] img").length === 3);
      await owner.waitForFunction(() => document.querySelector("[data-testid=photos-btn]").textContent.includes("사진 4"));
      await staff.click("[data-testid=grid-after] .ph >> nth=2");
      await staff.click("[data-testid=photo-del]");
      await staff.click("[data-testid=photo-del-yes]");
      await staff.waitForFunction(() => document.querySelectorAll("[data-testid=grid-after] img").length === 2);
      await owner.waitForFunction(() => document.querySelector("[data-testid=photos-btn]").textContent.includes("사진 3"));
      await staff.click("[data-pclose]");
    });
    await step("보기 전용은 사진 보기만(추가 버튼 없음)", async () => {
      const v = await newPage(ctxP, { uid: "u_view", readOnly: true }, errors);
      await v.goto(BASE);
      await v.waitForSelector("[data-testid=photos-btn]");
      await v.click("[data-testid=photos-btn]");
      await imgsLoaded(v, "#modal .ph img");
      eq(await v.locator("[data-testid=add-before]").count(), 0);
      await v.close();
    });
    await step("폼에 사진 수 표시, 사장님 저장 공간 표시", async () => {
      await owner.click("[data-testid=card] .c-name");
      ok((await txt(owner, "#photoLine")).includes("작업 전 1장 · 작업 후 2장"));
      await owner.click("#sheet [data-x] >> nth=0");
      await owner.click("[data-testid=tab-settings]");
      await owner.waitForFunction(() => /사진 3장/.test(document.querySelector("[data-testid=usage]").textContent));
      await owner.click("[data-testid=tab-list]");
    });
    await step("이전설치 선택 시 출발지·도착지 입력 → 카드·내비에 반영", async () => {
      await owner.click("[data-testid=card] .c-name");
      ok(await owner.isHidden("[data-testid=move-block]"), "세척만일 땐 숨김");
      eq(await txt(owner, "#addrLabel"), "주소");
      await owner.selectOption("[data-testid=item] >> nth=0 >> [data-testid=item-work]", "이전설치");
      await owner.waitForSelector("[data-testid=move-block]", { state: "visible" });
      eq(await txt(owner, "#addrLabel"), "출발지 주소 (철거하는 곳)");
      await owner.fill("[data-testid=f-addr2]", "용인시 기흥구 2, 105동 701호");
      await owner.fill("#f-floor2", "7");
      await owner.click("button[data-f=elevator2][data-v='있음']");
      await owner.click("[data-testid=save]");
      await owner.waitForSelector("[data-testid=addr-to]");
      ok((await txt(owner, "[data-testid=addr-from]")).includes("수원시 영통구 1"));
      ok((await txt(owner, "[data-testid=addr-to]")).includes("용인시 기흥구 2"));
      await owner.click("[data-testid=addr-to]");
      ok((await txt(owner, "#modal h2")).includes("도착지"));
      ok((await txt(owner, "#modal")).includes("7층 · 엘리베이터 있음"));
      eq(await owner.getAttribute("[data-testid=web-kakaomap]", "href"), "https://map.kakao.com/link/search/" + encodeURIComponent("용인시 기흥구 2, 105동 701호"));
      await owner.click("#modal", { position: { x: 10, y: 10 } });
      await owner.screenshot({ path: path.join(SHOTS, "m-move.png") });
      // 다시 열면 값 유지, 세척으로 바꾸면 도착지 숨김
      await owner.click("[data-testid=card] .c-name");
      eq(await owner.inputValue("[data-testid=f-addr2]"), "용인시 기흥구 2, 105동 701호");
      await owner.selectOption("[data-testid=item] >> nth=0 >> [data-testid=item-work]", "세척");
      ok(await owner.isHidden("[data-testid=move-block]"));
      await owner.click("#sheet [data-x] >> nth=0");
    });
    await step("예약 삭제 시 사진 파일도 정리", async () => {
      const before = +(await (await fetch(BASE + "__blobcount")).text());
      eq(before, 3, "삭제 전 파일 수");
      await owner.click("[data-testid=card] .c-name");
      await owner.click("[data-testid=del]");
      await owner.click("[data-testid=del-yes]");
      await owner.waitForSelector("[data-testid=empty]");
      await owner.waitForFunction(() => true);
      for (let i = 0; i < 20 && +(await (await fetch(BASE + "__blobcount")).text()) > 0; i++) await owner.waitForTimeout(100);
      eq(+(await (await fetch(BASE + "__blobcount")).text()), 0, "삭제 후 파일 수");
    });
    await ctxP.close();
  }

  await step("콘솔·스크립트 오류 0건", async () => { eq(errors.length, 0, errors.join("\n")); });

  await browser.close();
  server.close();
  console.log(`\n${passed} passed, ${failed} failed` + (failed ? "\n실패: " + failures.join(", ") : ""));
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
