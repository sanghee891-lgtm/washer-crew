/* 예약장부 화면·동작. 데이터는 공유 저장소(db)의 reservations/*, config/staff, reminders/* 에 둡니다.
   저장소는 claude.use(...) 로 받습니다(웹앱: supa-db.js 가 Supabase로 연결, 테스트: 가짜 런타임). */
(function () {
  "use strict";
  var C = window.Core;

  // ---------------- 상태 ----------------
  var S = {
    db: null, user: null, downloads: null, push: null, bookings: null,
    uid: null, myStaffId: null, fixedStaff: null, staff: [], staffLoaded: false,
    reqs: [], sent: {}, pushState: null, accounts: null,
    all: {}, loading: true, subYear: null, unsubYear: null,
    ym: C.ymOf(C.todayStr()), tab: "list", filter: "all", q: "", calDay: null,
    readOnly: false, conn: "connecting", // connecting | ok | nodb
    renderedTab: null, wide: false, statsTable: false
  };
  var F = null; // 열린 입력 폼 상태
  var P = null; // 열린 사진 창 상태 {id, view, confirmDel, busy}

  // ---------------- 유틸 ----------------
  function $(sel, el) { return (el || document).querySelector(sel); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function clone(o) { return JSON.parse(JSON.stringify(o || {})); }
  function nowIso() { return new Date().toISOString(); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem("wb." + k); localStorage.setItem("wb." + k, v); } catch (e) { return null; } }
  function staffName(id) {
    for (var i = 0; i < S.staff.length; i++) if (S.staff[i].id === id) return S.staff[i].name;
    return "";
  }
  function meKey() { return "staffId." + (S.uid || "local"); }
  // 지금 직원 명단에 있는 참여자만(예전 명단의 id는 화면에 안 보임)
  function crew(r) { return C.assignedWorkers(r).filter(function (id) { return !!staffName(id); }); }
  function withCrew(r) {
    var w = {};
    crew(r).forEach(function (id) { w[id] = true; });
    return Object.assign({}, r, { workers: w });
  }
  function conflictsOf(candidate) {
    return C.findConflicts(list().map(withCrew), candidate && withCrew(candidate));
  }
  function list() { return Object.keys(S.all).map(function (k) { return S.all[k]; }); }
  function monthList() { return C.sortReservations(C.filterMonth(list(), S.ym)); }
  function canWrite() { return S.conn === "ok" && !S.readOnly; }
  // 예약 수정·삭제·입금확인은 예약을 넣은 사람과 사장님(장부 주인)만
  function canEditRes(r) {
    if (!canWrite()) return false;
    if (S.isOwner) return true;
    return !!(r && r.createdBy && S.myStaffId && r.createdBy === S.myStaffId);
  }
  function fmtStamp(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return (d.getMonth() + 1) + "/" + d.getDate() + " " + C.pad(d.getHours()) + ":" + C.pad(d.getMinutes());
  }

  // 장부 위쪽 알림 카드의 둥근 아이콘
  var ICON_NT = {
    new: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/></svg>',
    req: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="8" r="3.5"/><path d="M3.5 20c.8-3.5 3.4-5.5 6.5-5.5 1.6 0 3 .5 4.1 1.4M18 14v6M15 17h6"/></svg>',
    remind: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z"/><path d="M8 10h8M8 13h5"/></svg>',
    push: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>'
  };
  function ntIc(k) { return '<span class="nt-ic" aria-hidden="true">' + ICON_NT[k] + "</span>"; }
  var ICON = {
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg>',
    gallery: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="15" height="13" rx="2"/><path d="M6 21h13a2 2 0 0 0 2-2V8"/><path d="M3 15l4-4 4 4 2-2 5 5"/><circle cx="13.5" cy="9" r="1.5"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M9 13h7M9 17h5"/></svg>',
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>'
  };

  // ---------------- 토스트·모달 ----------------
  var toastTimer = null;
  function toast(msg, action) {
    var el = $("#toast");
    el.innerHTML = "<span></span>";
    el.firstChild.textContent = msg;
    if (action) {
      var b = document.createElement("button");
      b.textContent = action.label;
      b.onclick = function () { el.hidden = true; action.run(); };
      el.appendChild(b);
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, action ? 6000 : 2600);
  }
  // ---------------- 뒤로가기 ----------------
  // 창(사진 크게 보기 > 사진·주소 창 > 입력 화면 > 다른 탭)이 열려 있는 동안 기록을 하나 두어
  // 휴대폰 뒤로가기가 장부를 벗어나지 않고 맨 위 창부터 닫게 함
  var NAV = { depth: 0, ignore: 0, releaseTimer: null };
  function anyOpen() {
    return !$("#modal").hidden || !$("#sheet").hidden || S.tab !== "list";
  }
  // 창을 열 때(누를 때) 기록 한 칸 추가
  function pushLayer() {
    try { history.pushState({ wb: NAV.depth + 1 }, ""); NAV.depth++; } catch (e) { /* 막힌 환경 */ }
  }
  // 다 닫혔는데 남은 기록이 있으면 한 번에 정리(다음 뒤로가기가 헛돌지 않게)
  function dropLeftovers() {
    if (NAV.depth > 0 && !anyOpen()) {
      var n = NAV.depth;
      NAV.depth = 0; NAV.ignore++;
      try { history.go(-n); } catch (e) { NAV.ignore--; }
    }
  }
  function releaseGuardSoon() {
    clearTimeout(NAV.releaseTimer);
    NAV.releaseTimer = setTimeout(dropLeftovers, 250);
  }
  function closeTop() {
    if (P && P.view && !$("#modal").hidden) { P.view = null; P.confirmDel = false; renderPhotos(); }
    else if (!$("#modal").hidden) closeModal();
    else if (!$("#sheet").hidden) closeForm();
    else if (S.tab !== "list") setTab("list");
  }
  window.addEventListener("popstate", function () {
    if (NAV.ignore) { NAV.ignore--; return; }
    NAV.depth = Math.max(0, NAV.depth - 1);
    clearTimeout(NAV.releaseTimer);
    closeTop();
    if (!anyOpen()) dropLeftovers();
    else if (NAV.depth === 0) pushLayer(); // 아직 열린 창이 있는데 기록이 없으면 하나 보충
  });

  function openModal(html, onClick) {
    var m = $("#modal");
    if (m.hidden) pushLayer();
    m.innerHTML = '<div class="modal-in" role="dialog" aria-modal="true">' + html + "</div>";
    m.hidden = false;
    m.onclick = function (e) {
      if (e.target === m) { closeModal(); return; }
      if (onClick) onClick(e);
    };
  }
  function closeModal() { var m = $("#modal"); m.hidden = true; m.innerHTML = ""; m.onchange = null; P = null; REQ.open = false; REM.open = false; if (F) refreshFormLive(); releaseGuardSoon(); }

  function writeError(e) {
    var code = e && e.code;
    if (code === "invalid_argument") {
      return S.fixedStaff ? "저장 권한이 없어요. 사장님께 문의해 주세요." : "저장 권한이 없어요. 장부 주인에게 '편집자'로 초대해 달라고 요청하세요.";
    }
    if (code === "quota_exceeded") return "저장 공간이 가득 찼어요. 오래된 예약을 정리해 주세요.";
    return "저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.";
  }

  // ---------------- 연결 ----------------
  async function boot() {
    S.tab = "list"; // 항상 예약목록에서 시작(뒤로가기 순서가 단순해짐)
    S.myStaffId = store(meKey()) || null;
    // 표는 옆으로 밀지 않고 한 화면에 들어오는 넓은 화면(1100px~)에서만, 그보다 좁으면 카드
    var mq = window.matchMedia("(min-width: 1100px)");
    S.wide = mq.matches;
    var onMq = function () { S.wide = mq.matches; S.renderedTab = null; render(); };
    if (mq.addEventListener) mq.addEventListener("change", onMq); else mq.addListener(onMq);
    window.addEventListener("resize", debounce(function () { measureTop(); if (S.tab === "stats") renderBody(); }, 150));
    bindStatic();
    // 불러오지 못한 사진은 빈 칸으로(권한·삭제된 파일)
    document.addEventListener("error", function (e) {
      var t = e.target;
      if (t && t.tagName === "IMG" && (t.hasAttribute("data-blob") || /\/_blob\//.test(t.getAttribute("src") || ""))) {
        t.classList.add("broken");
        if (t.parentNode) t.parentNode.title = "사진을 불러올 수 없어요";
      }
    }, true);
    render();

    var cl = window.claude;
    if (!cl || typeof cl.use !== "function") { S.conn = "nodb"; S.loading = false; render(); return; }
    var got = await Promise.all([cl.use("db"), cl.use("user"), cl.use("downloads"), cl.use("assets"), cl.use("push"), cl.use("bookings")].map(function (p) {
      return Promise.resolve(p).catch(function () { return null; });
    }));
    S.db = got[0]; S.user = got[1]; S.downloads = got[2]; S.assets = got[3]; S.push = got[4]; S.bookings = got[5];
    if (!S.db) { S.conn = "nodb"; S.loading = false; render(); return; }
    S.conn = "ok";
    if (S.user) {
      try { S.uid = await S.user.id(); } catch (e) { S.uid = null; }
      S.myStaffId = store(meKey()) || null; // 한 기기를 여러 계정이 쓰면 계정별로 따로 기억
      try { if ((await S.user.can("data.write")) === false) S.readOnly = true; } catch (e) { /* 모름 → 쓰기 시도 */ }
      try { S.isOwner = await S.user.isOwner(); } catch (e) { S.isOwner = false; }
      // 웹앱은 로그인한 직원이 곧 '나'(이름을 따로 고르지 않음)
      if (S.user.staffId) {
        try { S.fixedStaff = await S.user.staffId(); } catch (e) { S.fixedStaff = null; }
        if (S.fixedStaff) { S.myStaffId = S.fixedStaff; store(meKey(), S.fixedStaff); }
      }
    }
    loadSeen();
    S.db.doc("config/staff").onSnapshot(function (snap) {
      var d = snap.exists ? snap.data() : null;
      S.staff = (d && Array.isArray(d.list)) ? d.list.filter(function (p) { return p && p.id && p.name; }) : [];
      S.staffLoaded = true;
      if (S.myStaffId && !staffName(S.myStaffId)) S.myStaffId = null;
      render();
      maybeAskIdentity();
    }, function () { S.staffLoaded = true; render(); });
    if (S.uid && !S.fixedStaff) {
      S.db.collection("data/users/" + S.uid).doc("me").get().then(function (snap) {
        if (snap.exists && snap.data().staffId) {
          S.myStaffId = snap.data().staffId;
          store(meKey(), S.myStaffId);
          render();
        }
        maybeAskIdentity();
      }).catch(function () { /* 로컬 값 사용 */ });
    }
    subscribeYear(S.ym.slice(0, 4));
    // 전날 확인 문자 보낸 기록(오늘 이후 예약)
    S.db.collection("reminders").where("date", ">=", C.todayStr()).onSnapshot(function (snap) {
      var m = {};
      snap.docs.forEach(function (d) { m[d.id] = d.data(); });
      S.sent = m;
      renderBanner();
      if (REM.open) renderReminders();
    }, function () { /* 보조 기능 */ });
    var reqFirst = true;
    if (S.bookings) S.bookings.onSnapshot(function (list) {
      var prev = S.reqs.map(function (q) { return q.id; });
      S.reqs = list || [];
      // 처음 불러온 목록은 위 안내로 보여 주고, 열어 둔 동안 새로 들어온 요청만 바로 알림
      var fresh = !reqFirst && S.reqs.some(function (q) { return prev.indexOf(q.id) < 0; });
      reqFirst = false;
      if (fresh) toast("고객 예약 요청이 들어왔어요.", { label: "보기", run: openRequests });
      renderTop(); renderBanner();
      if (REQ.open) renderRequests();
    });
    if (S.push) refreshPushState();
    if (I) I.onChange(function () { renderBanner(); if (S.tab === "settings") renderBody(); });
    if (navigator.serviceWorker) navigator.serviceWorker.addEventListener("message", function (e) {
      if (e.data && e.data.url) handleLink(e.data.url);
    });
  }

  // 알림·링크로 열었을 때: ?open=<예약id> | ?requests=1 | ?reminders=1
  var linkHandled = false;
  function handleLink(url) {
    var q;
    try { q = new URL(url, location.href).searchParams; } catch (e) { return; }
    var id = q.get("open");
    if (id && S.all[id]) { if (C.ymOf(S.all[id].date) !== S.ym) setMonth(C.ymOf(S.all[id].date)); openForm(id); }
    else if (q.get("requests")) openRequests();
    else if (q.get("reminders")) openReminders();
  }
  function handleStartLink() {
    if (linkHandled) return;
    linkHandled = true;
    if (!/[?&](open|requests|reminders)=/.test(location.search)) return;
    var url = location.href;
    try { history.replaceState(history.state, "", location.pathname); } catch (e) { /* 무시 */ }
    setTimeout(function () { handleLink(url); }, 0);
  }

  function subscribeYear(y) {
    if (!S.db || S.subYear === y) return;
    if (S.unsubYear) S.unsubYear();
    S.subYear = y;
    S.loading = true;
    S.all = {};
    var r = C.yearRange(y);
    S.unsubYear = S.db.collection("reservations").where("date", ">=", r.start).where("date", "<", r.end)
      .onSnapshot(function (snap) {
        var next = {};
        snap.docs.forEach(function (d) { next[d.id] = Object.assign({}, d.data(), { id: d.id }); });
        var prev = S.all;
        S.all = next;
        if (!S.loading) announceNew(prev, next);
        if (S.loading && NOTE.at) NOTE.ready = true;
        S.loading = false;
        render();
        handleStartLink();
        if (F) refreshFormLive();
        if (P) renderPhotos();
      }, function (e) {
        S.loading = false;
        if (e && e.code === "revoked") { S.conn = "nodb"; }
        render();
        toast("예약을 불러오지 못했어요. 화면을 새로고침해 주세요.");
      });
  }

  var identityAsked = false;
  function maybeAskIdentity() {
    if (S.fixedStaff) { maybeAskPin(); return; }
    if (identityAsked || S.conn !== "ok" || !S.staffLoaded) return;
    if (S.myStaffId && staffName(S.myStaffId)) return;
    if (!$("#sheet").hidden || !$("#modal").hidden) return;
    identityAsked = true;
    if (!S.staff.length) { openStaffSetup(); return; }
    askIdentity();
  }

  function askIdentity(after) {
    if (S.fixedStaff) { openAccount(); return; }
    openModal(
      "<h2>누구세요?</h2><p>이름을 고르면 '참여하기'와 '내 일정'에 이 이름이 쓰여요. 이 기기에서 한 번만 고르면 돼요.</p>" +
      '<div class="big-choices">' + S.staff.map(function (p) {
        return '<button class="btn' + (p.id === S.myStaffId ? " primary" : "") + '" data-pick="' + esc(p.id) + '" data-testid="pick-' + esc(p.name) + '">' + esc(p.name) + "</button>";
      }).join("") + "</div>" +
      '<button class="linkish" data-goto="settings">직원 명단 고치기</button>',
      function (e) {
        var b = e.target.closest("[data-pick]");
        if (b) { setMe(b.getAttribute("data-pick")); closeModal(); if (after) after(); return; }
        if (e.target.closest("[data-goto]")) { closeModal(); setTab("settings"); }
      }
    );
  }

  function setMe(id) {
    if (S.fixedStaff) return;
    S.myStaffId = id;
    store(meKey(), id);
    if (S.db && S.uid) {
      S.db.collection("data/users/" + S.uid).doc("me").set({ staffId: id }).catch(function () { /* 이 기기에는 저장됨 */ });
    }
    toast((staffName(id) || "") + "님으로 설정했어요.");
    render();
  }

  // ---------------- 새 예약 알림 ----------------
  // 기기마다 '마지막으로 확인한 시각'을 기억해, 그 뒤에 다른 사람이 넣은 예약을 새 예약으로 표시
  var NOTE = { at: null, ids: {}, ready: false };
  function noteKey() { return "seen." + (S.uid || "local"); }
  function loadSeen() {
    var v = null;
    try { v = JSON.parse(store(noteKey()) || "null"); } catch (e) { v = null; }
    if (v && v.at) { NOTE.at = v.at; NOTE.ids = v.ids || {}; }
    else { NOTE.at = nowIso(); NOTE.ids = {}; saveSeen(); } // 처음 연 기기는 지난 예약을 새 예약으로 쏟아내지 않음
  }
  function saveSeen() { store(noteKey(), JSON.stringify({ at: NOTE.at, ids: NOTE.ids })); }
  function isNew(r) {
    if (!NOTE.at || !r || !r.createdAt) return false;
    if (r.createdBy && r.createdBy === S.myStaffId) return false;
    return r.createdAt > NOTE.at && !NOTE.ids[r.id];
  }
  function newList() { return C.sortReservations(list().filter(isNew)); }
  function markSeen(id) { if (NOTE.at && !NOTE.ids[id]) { NOTE.ids[id] = true; saveSeen(); render(); } }
  function markAllSeen() { NOTE.at = nowIso(); NOTE.ids = {}; saveSeen(); }
  function noteLine(r) {
    var c = r.customer || {};
    return C.dayLabel(r.date) + " " + r.time + " · " + (c.name || C.itemsSummary(r.items) || "") +
      (staffName(r.createdBy) ? " · " + staffName(r.createdBy) + "님 등록" : "");
  }
  // 장부를 열어 둔 동안 다른 직원이 예약을 넣으면 바로 알림
  function announceNew(prev, next) {
    if (!NOTE.ready) return;
    var fresh = Object.keys(next).filter(function (id) { return !prev[id] && isNew(next[id]); });
    if (!fresh.length) return;
    var r = next[fresh[0]];
    try { if (navigator.vibrate) navigator.vibrate(200); } catch (e) { /* 지원 안 함 */ }
    toast((fresh.length > 1 ? "새 예약 " + fresh.length + "건 · " : "새 예약 · ") + noteLine(r),
      { label: "보기", run: function () { if (C.ymOf(r.date) !== S.ym) setMonth(C.ymOf(r.date)); openForm(r.id); } });
  }


  // ---------------- 고객 예약 요청 ----------------
  // 고객이 예약 링크(book.html)로 넣은 요청 → [확정]하면 입력 화면이 채워진 채 열리고, 저장하면 예약이 됨
  var REQ = { open: false, confirmRej: null };
  function reqLine(q) {
    return C.dayLabel(q.date) + (q.timeSlot ? " " + q.timeSlot : "") + " · " + q.name + (C.itemsSummary(q.items) ? " · " + C.itemsSummary(q.items) : "");
  }
  function reqNoticeHtml() {
    if (!S.reqs.length) return "";
    return '<div class="notice req" data-testid="req-notice"><div class="notice-h">' + ntIc("req") + '<b>고객 예약 요청 ' + S.reqs.length + "건</b>" +
      '<button class="btn primary" data-act="open-reqs" data-testid="open-reqs">보기</button></div>' +
      S.reqs.slice(0, 3).map(function (q) { return '<div class="notice-line">' + esc(reqLine(q)) + "</div>"; }).join("") + "</div>";
  }
  function openRequests() {
    if (!S.bookings || S.conn !== "ok") return;
    REQ.open = true; REQ.confirmRej = null;
    renderRequests();
  }
  function renderRequests() {
    if (!REQ.open) return;
    var html = "<h2>고객 예약 요청</h2>" + (S.reqs.length ? "" : '<p class="muted">새 요청이 없어요.</p>');
    html += S.reqs.map(function (q) {
      var it = C.cleanItems(q.items);
      return '<div class="req-card" data-rq="' + esc(q.id) + '" data-testid="req-card">' +
        '<div class="req-h"><b>' + esc(q.name) + '</b><a class="num" href="tel:' + esc(C.normalizePhone(q.phone)) + '">' + esc(C.formatPhone(q.phone)) + "</a></div>" +
        "<div>희망 <b>" + esc(C.dayLabel(q.date)) + "</b> " + esc(q.timeSlot || "") + "</div>" +
        (it.length ? "<div>" + esc(C.itemsSummary(it)) + " · " + esc(C.worksSummary(it)) + "</div>" : "") +
        "<div>" + (q.moveTo ? '<em class="tag-from">출발</em> ' : "") + esc(q.address) + "</div>" +
        (q.moveTo ? '<div><em class="tag-to">도착</em> ' + esc(q.moveTo) + "</div>" : "") +
        (q.note ? '<div class="req-note">' + esc(q.note) + "</div>" : "") +
        '<div class="muted" style="font-size:12px">' + esc(fmtStamp(q.createdAt)) + " 접수</div>" +
        '<div class="req-acts">' + (REQ.confirmRej === q.id
          ? '<span class="grow">거절할까요?</span><button class="btn" data-rqno>아니요</button><button class="btn danger solid" data-rqrejyes data-testid="req-reject-yes">거절</button>'
          : '<button class="btn danger" data-rqrej data-testid="req-reject">거절</button><button class="btn primary grow" data-rqok data-testid="req-accept">확정 (예약 넣기)</button>') +
        "</div></div>";
    }).join("");
    html += '<button class="btn wide" data-rqclose>닫기</button>';
    var m = $("#modal"), scroll = !m.hidden && m.firstChild ? m.firstChild.scrollTop : 0;
    openModal(html, onReqClick);
    m.firstChild.scrollTop = scroll;
  }
  function onReqClick(e) {
    var t = e.target, card = t.closest("[data-rq]"), id = card && card.getAttribute("data-rq");
    if (t.closest("[data-rqclose]")) { closeModal(); return; }
    if (t.closest("[data-rqrej]")) { REQ.confirmRej = id; renderRequests(); return; }
    if (t.closest("[data-rqno]")) { REQ.confirmRej = null; renderRequests(); return; }
    if (t.closest("[data-rqrejyes]")) {
      REQ.confirmRej = null;
      S.bookings.reject(id).then(function () { toast("요청을 거절했어요. 필요하면 고객에게 전화해 주세요."); }, function (err) { toast(writeError(err)); });
      return;
    }
    if (t.closest("[data-rqok]")) {
      var q = S.reqs.filter(function (x) { return x.id === id; })[0];
      if (!q) return;
      closeModal();
      openForm(null, q.date, reqToForm(q));
    }
  }
  function reqToForm(q) {
    var items = C.cleanItems(q.items).map(function (it) { return { type: it.type, model: "", qty: it.qty, work: it.work }; });
    return {
      // 고객이 고른 시각(예: 14:30)을 그대로, 예전 요청의 오전/오후는 9시/13시로
      time: /^\d{1,2}:\d{2}$/.test(q.timeSlot || "") ? q.timeSlot : /오후/.test(q.timeSlot || "") ? "13:00" : "09:00",
      customer: { name: q.name, phone: C.formatPhone(q.phone), address: q.address },
      moveTo: { address: q.moveTo || "", floor: "", elevator: "" },
      items: items.length ? items : undefined,
      note: ["고객 예약 요청", q.timeSlot ? "희망 시간: " + q.timeSlot : "", q.note].filter(Boolean).join("\n"),
      requestedAt: q.createdAt,
      fromRequest: q.id
    };
  }

  // ---------------- 내일 확인 문자 ----------------
  // 무료: 문구가 채워진 문자 화면을 열고 직원이 전송만 누름. 보낸 고객은 reminders/<예약id> 에 기록
  var REM = { open: false };
  function tomorrowList() {
    var t = C.addDays(C.todayStr(), 1);
    return C.sortReservations(list().filter(function (r) {
      return r.date === t && r.status === "scheduled" && C.normalizePhone((r.customer || {}).phone).length >= 9;
    }));
  }
  function remindNoticeHtml() {
    var l = tomorrowList();
    var done = l.filter(function (r) { return S.sent[r.id]; }).length;
    if (!l.length || done >= l.length) return "";
    return '<div class="notice remind" data-testid="remind-notice"><div class="notice-h">' + ntIc("remind") + '<b>내일 예약 ' + l.length + "건 확인 문자</b>" +
      (done ? '<span class="muted num">' + done + "/" + l.length + " 보냄</span>" : "") +
      '<button class="btn primary" data-act="open-rem" data-testid="open-rem">보내기</button></div></div>';
  }
  function openReminders() { if (S.conn !== "ok") return; REM.open = true; renderReminders(); }
  function renderReminders() {
    if (!REM.open) return;
    var l = tomorrowList(), plat = C.detectPlatform(navigator.userAgent);
    var html = "<h2>내일 예약 확인 문자</h2><p>[문자 보내기]를 누르면 문구가 채워진 문자 화면이 열려요. 전송만 누르세요.</p>" +
      (l.length ? "" : '<p class="muted">내일 예약이 없어요.</p>');
    html += l.map(function (r) {
      var c = r.customer || {}, text = C.reminderText(r), sent = S.sent[r.id];
      return '<div class="req-card' + (sent ? " sent" : "") + '" data-rm="' + esc(r.id) + '" data-testid="rem-card">' +
        '<div class="req-h"><b>' + esc(r.time) + " " + esc(c.name || "이름 없음") + '</b><span class="num">' + esc(C.formatPhone(c.phone)) + "</span>" +
        (sent ? '<span class="pill paid" data-testid="rem-sent">보냄' + (staffName(sent.by) ? " · " + esc(staffName(sent.by)) : "") + "</span>" : "") + "</div>" +
        '<div class="sms-text" data-testid="rem-text">' + esc(text) + "</div>" +
        '<div class="req-acts"><a class="btn primary grow" href="' + esc(C.smsHref(c.phone, text, plat)) + '" data-rmsend data-testid="rem-send">문자 보내기</a>' +
        '<button class="btn" data-rmcopy>문구 복사</button>' +
        '<button class="btn" data-rmmark data-testid="rem-mark">' + (sent ? "보냄 취소" : "보냄 표시") + "</button></div></div>";
    }).join("");
    html += '<button class="btn wide" data-rmclose>닫기</button>';
    var m = $("#modal"), scroll = !m.hidden && m.firstChild ? m.firstChild.scrollTop : 0;
    openModal(html, onRemClick);
    m.firstChild.scrollTop = scroll;
  }
  function onRemClick(e) {
    var t = e.target, card = t.closest("[data-rm]"), r = card ? S.all[card.getAttribute("data-rm")] : null;
    if (t.closest("[data-rmclose]")) { closeModal(); return; }
    if (!r) return;
    // 문자 앱 열기는 막지 않고 같은 클릭에서 '보냄' 기록
    if (t.closest("[data-rmsend]")) { if (!S.sent[r.id]) markSent(r, true); return; }
    if (t.closest("[data-rmcopy]")) { copyText(C.reminderText(r), "문구를 복사했어요. 문자에 붙여넣으세요."); return; }
    if (t.closest("[data-rmmark]")) markSent(r, !S.sent[r.id]);
  }
  function markSent(r, on) {
    var ref = S.db.doc("reminders/" + r.id);
    (on ? ref.set({ date: r.date, by: S.myStaffId || "", at: nowIso() }) : ref.delete()).catch(function (e) { toast(writeError(e)); });
  }

  // ---------------- 휴대폰 알림·계정 ----------------
  async function refreshPushState() {
    if (!S.push) return;
    try { S.pushState = await S.push.state(); } catch (e) { S.pushState = "unsupported"; }
    renderBanner();
    if (S.tab === "settings") renderBody();
  }
  // ---------------- 홈 화면 앱 설치 ----------------
  var I = window.WCInstall || null;
  function installNoticeHtml() {
    if (!I || !I.needed()) return "";
    if (I.inApp()) return I.inAppBoxHtml(); // 카톡 안: 나중에 없이 항상(설치·알림 둘 다 안 되므로)
    if (Date.now() < +(store("installLater") || 0)) return "";
    return '<div class="notice" data-testid="install-notice"><div class="notice-h">' + ntIc("push") + "<b>홈 화면에 앱을 설치하세요</b></div>" +
      '<div class="notice-line">아이콘을 누르면 바로 열리고, 휴대폰 알림도 받을 수 있어요.</div>' +
      '<div class="notice-acts"><button class="btn" data-act="install-later">나중에</button>' +
      '<button class="btn primary" data-act="install" data-testid="install-btn">홈 화면에 앱 설치</button></div></div>';
  }
  async function doInstall() {
    if (!I) return;
    var res = await I.prompt();
    if (res === "installed") { toast("홈 화면에 설치했어요. 이제 아이콘으로 여세요."); renderBanner(); return; }
    if (res === "dismissed") return;
    openModal("<h2>홈 화면에 앱 설치</h2>" + I.stepsHtml() +
      '<p class="muted" style="font-size:14px">설치한 뒤에는 홈 화면의 <b>세탁기 크루</b> 아이콘으로 여세요. 알림도 그때 켤 수 있어요.</p>' +
      '<button class="btn primary wide" data-close-modal>알겠어요</button>', function (e) { if (e.target.closest("[data-close-modal]")) closeModal(); });
  }
  function installStateHtml() {
    if (!I) return "";
    if (!I.needed()) return '<p style="margin:0"><b>홈 화면 앱으로 열었어요.</b></p>';
    if (I.inApp()) return I.inAppBoxHtml();
    return '<p style="margin:0 0 8px">아직 설치하지 않았어요.</p><button class="btn primary" data-act="install" data-testid="install-settings">홈 화면에 앱 설치</button>';
  }

  function pushNoticeHtml() {
    if (I && I.inApp()) return ""; // 앱 안 브라우저는 위 안내로 대신
    if (!S.push || (S.pushState !== "off" && S.pushState !== "need-install")) return "";
    if (Date.now() < +(store("pushLater") || 0)) return "";
    var later = '<button class="btn" data-act="push-later">나중에</button>';
    if (S.pushState === "need-install") {
      return '<div class="notice" data-testid="push-notice"><div class="notice-h">' + ntIc("push") + '<b>아이폰은 홈 화면에 추가해야 알림이 와요</b></div>' +
        '<div class="notice-line">아래 <b>공유</b> 버튼 → <b>홈 화면에 추가</b>를 누른 뒤, 홈 화면의 세탁기 크루 아이콘으로 열어 주세요.</div>' +
        '<div class="notice-acts">' + later + "</div></div>";
    }
    return '<div class="notice" data-testid="push-notice"><div class="notice-h">' + ntIc("push") + '<b>알림을 켜 주세요</b></div>' +
      '<div class="notice-line">새 예약·고객 요청·내일 확인 문자를 앱을 닫아 두어도 알려 드려요.</div>' +
      '<div class="notice-acts">' + later + '<button class="btn primary" data-act="push-on" data-testid="push-on">알림 켜기</button></div></div>';
  }
  async function pushOn() {
    try { await S.push.enable(); toast("알림을 켰어요."); }
    catch (e) { toast(e && e.code === "denied" ? "알림이 막혀 있어요. 휴대폰 설정에서 이 앱의 알림을 허용해 주세요." : "알림을 켜지 못했어요. 다시 눌러 주세요."); }
    refreshPushState();
  }
  function pushStateHtml() {
    var st = S.pushState;
    if (st === "on") return '<p style="margin:0 0 8px"><b>켜져 있어요.</b> 새 예약·고객 요청·내일 확인 문자를 알려 드려요.</p>' +
      '<div class="chips"><button class="btn" data-act="push-test" data-testid="push-test">시험 알림 보내기</button><button class="btn" data-act="push-off">알림 끄기</button></div>';
    if (st === "off") return '<p style="margin:0 0 8px">꺼져 있어요.</p><button class="btn primary" data-act="push-on">알림 켜기</button>';
    if (st === "denied") return '<p style="margin:0">알림이 막혀 있어요. 휴대폰 <b>설정 → 알림</b>에서 이 앱(또는 크롬)의 알림을 허용한 뒤 다시 열어 주세요.</p>';
    if (st === "need-install") return '<p style="margin:0">아이폰은 사파리 아래 <b>공유</b> 버튼 → <b>홈 화면에 추가</b>를 누른 뒤, 홈 화면 아이콘으로 열어야 알림을 받을 수 있어요(iOS 16.4 이상).</p>';
    if (st === "unsupported") return I && I.inApp() ? I.inAppBoxHtml() : '<p style="margin:0">이 브라우저는 알림을 지원하지 않아요. 크롬(안드로이드)이나 사파리(아이폰)로 열어 주세요.</p>';
    return '<p class="muted" style="margin:0">확인 중…</p>';
  }

  function openAccount() {
    var name = staffName(S.fixedStaff) || "";
    openModal("<h2>" + esc(name) + "님</h2><p>이 기기에 로그인되어 있어요." + (S.isOwner ? " (개발자)" : "") + "</p>" +
      '<button class="btn wide" data-switch data-testid="switch-user">다른 사용자로 전환</button>' +
      (S.user.lockNow ? '<button class="btn wide" data-locknow data-testid="lock-now">지금 잠그기</button>' : "") +
      '<button class="btn wide" data-mypin>내 비밀번호 바꾸기</button>' +
      '<button class="btn wide danger" data-logout data-testid="logout">로그아웃</button>',
      function (e) {
        if (e.target.closest("[data-mypin]")) { myPin(); return; }
        if (e.target.closest("[data-switch]")) { S.user.switchUser(); return; }
        if (e.target.closest("[data-locknow]")) { closeModal(); S.user.lockNow(); return; }
        if (e.target.closest("[data-logout]")) S.user.signOut();
      });
  }
  // 처음 비밀번호(000000)로 들어온 직원: 장부를 열 때마다 바꾸기 안내(나중에 누르면 다음에 다시)
  var pinAsked = false;
  function maybeAskPin() {
    if (pinAsked || !S.staffLoaded || !(S.user && S.user.needsPinChange)) return;
    pinAsked = true;
    S.user.needsPinChange().then(function (need) {
      if (!need || !$("#modal").hidden || !$("#sheet").hidden) return;
      pinDialog((staffName(S.fixedStaff) || "") + "님, 비밀번호를 바꿔 주세요", function (pin) { return S.user.changePin(pin); },
        "지금은 처음 번호(000000)예요. 다른 사람이 내 이름으로 들어오지 못하게 나만 아는 숫자 6자리로 바꿔 주세요.", "나중에");
    });
  }
  function myPin() {
    pinDialog((staffName(S.fixedStaff) || "") + "님 새 비밀번호", function (pin) { return S.user.changePin(pin); });
  }
  function pinDialog(title, run, desc, noLabel) {
    openModal("<h2>" + esc(title) + "</h2><p>" + esc(desc || "숫자 6자리를 넣어 주세요. 로그인할 때 써요.") + "</p>" +
      '<input class="inp num pin-inp" id="pinInp" type="text" inputmode="numeric" autocomplete="off" maxlength="6" data-testid="pin-input">' +
      '<button class="btn primary wide" data-pinsave data-testid="pin-save">저장</button><button class="btn wide" data-pinno data-testid="pin-later">' + esc(noLabel || "취소") + "</button>",
      async function (e) {
        if (e.target.closest("[data-pinno]")) { closeModal(); return; }
        if (!e.target.closest("[data-pinsave]")) return;
        var pin = $("#pinInp").value.replace(/\D/g, "");
        if (pin.length !== 6) { toast("숫자 6자리를 넣어 주세요."); return; }
        try { await run(pin); closeModal(); toast("비밀번호를 저장했어요."); }
        catch (err) {
          toast(err && err.code === "same_pin" ? "지금과 다른 번호를 넣어 주세요." : err && err.code === "default_pin" ? "000000 말고 다른 번호를 넣어 주세요." : "저장하지 못했어요. 다시 눌러 주세요.");
        }
      });
    setTimeout(function () { var i = $("#pinInp"); if (i) i.focus(); }, 50);
  }
  // 사장님: 직원별 로그인 계정
  function loadAccounts() {
    if (!(S.isOwner && S.fixedStaff && S.user && S.user.accounts) || S.accLoading) return;
    S.accLoading = true;
    S.user.accounts().then(function (a) { S.accLoading = false; S.accounts = a; if (S.tab === "settings") renderBody(); },
      function () { S.accLoading = false; });
  }
  function accountsHtml() {
    if (!(S.isOwner && S.fixedStaff && S.user && S.user.setPin)) return "";
    if (!S.accounts) loadAccounts();
    var a = S.accounts || {};
    return '<div class="section-title">직원 로그인 계정</div><div class="panel" data-testid="accounts">' +
      S.staff.map(function (p) {
        var has = !!a[p.id];
        return '<div class="acct-row"><b>' + esc(p.name) + '</b><span class="muted">' + (!S.accounts ? "" : has ? (a[p.id].isOwner ? "개발자 계정" : "계정 있음") : "계정 없음") + "</span>" +
          '<button class="btn" data-act="acct-pin" data-sid="' + esc(p.id) + '">' + (has ? "비밀번호 바꾸기" : "계정 만들기") + "</button>" +
          (has && !a[p.id].isOwner ? '<button class="btn danger" data-act="acct-rm" data-sid="' + esc(p.id) + '">로그인 막기</button>' : "") + "</div>";
      }).join("") +
      '<p class="muted" style="margin:8px 0 0;font-size:13px">새 직원은 위 명단에 이름을 넣고 저장한 뒤 [계정 만들기]로 비밀번호 6자리를 정해 알려 주세요. 그만둔 직원은 [로그인 막기]를 누르세요.</p></div>';
  }
  function acctPin(sid) {
    pinDialog(staffName(sid) + "님 비밀번호", async function (pin) {
      await S.user.setPin(sid, pin);
      S.accounts = null; loadAccounts();
    });
  }
  function acctRemove(sid) {
    openModal("<h2>" + esc(staffName(sid)) + "님 로그인 막기</h2><p>이 직원은 더 이상 장부에 들어올 수 없어요. 예약 기록은 그대로 남아요.</p>" +
      '<button class="btn danger solid wide" data-yes>로그인 막기</button><button class="btn wide" data-no>취소</button>',
      async function (e) {
        if (e.target.closest("[data-no]")) { closeModal(); return; }
        if (!e.target.closest("[data-yes]")) return;
        try { await S.user.removeAccount(sid); closeModal(); toast("로그인을 막았어요."); S.accounts = null; loadAccounts(); }
        catch (err) { toast("처리하지 못했어요. 다시 눌러 주세요."); }
      });
  }

  // ---------------- 렌더 ----------------
  function render() {
    renderTop();
    if (S.renderedTab !== S.tab) buildTab();
    renderBody();
    measureTop();
  }

  function measureTop() {
    var h = $("#top").offsetHeight;
    document.documentElement.style.setProperty("--top-h", h + "px");
  }

  // 목록 필터별 건수(이번 달 기준). 위쪽 요약 칸과 필터 칩이 같은 숫자를 씀
  function counts() {
    var ml = monthList(), today = C.todayStr();
    return {
      all: ml.length,
      today: ml.filter(function (r) { return r.date === today; }).length,
      mine: ml.filter(function (r) { return S.myStaffId && r.workers && r.workers[S.myStaffId] === true && r.status !== "canceled"; }).length,
      open: ml.filter(function (r) { return r.status === "scheduled" && crew(r).length < (r.needed || 2); }).length,
      unpaid: ml.filter(function (r) { return r.status === "done" && !C.isPaid(r) && C.parseWon(r.total) > 0; }).length
    };
  }
  // 로그인한 웹앱: 직원은 오늘·내 작업·미배정, 관리 계정(신창민)은 새 요청·인원 부족·미수금·월 매출을 먼저
  function roleTiles(s) {
    var n = counts();
    var tile = function (key, label, val, act, warn) {
      return '<span class="s' + (warn ? " warn" : "") + (S.tab === "list" && S.filter === key ? " on" : "") + '" role="button" tabindex="0" data-tile="' + act + '" data-testid="tile-' + key + '"><small>' + label + '</small><b class="num">' + val + "</b></span>";
    };
    if (S.isOwner) {
      return tile("reqs", "새 예약 요청", S.reqs.length + "건", "reqs", S.reqs.length > 0) +
        tile("open", "인원 부족", n.open + "건", "open", n.open > 0) +
        tile("unpaid", "미수금", C.formatWon(s.unpaid) + "원", "unpaid", s.unpaid > 0) +
        tile("revenue", "월 매출", C.formatWon(s.totalRevenue) + "원", "stats");
    }
    return tile("today", "오늘 일정", n.today + "건", "today") + tile("mine", "내 작업", n.mine + "건", "mine") + tile("open", "미배정", n.open + "건", "open", n.open > 0);
  }
  function renderTop() {
    $("#monthLabel").textContent = C.ymLabel(S.ym);
    var s = C.summarize(C.filterMonth(list(), S.ym));
    var html;
    if (S.fixedStaff) html = roleTiles(s);
    else {
      html = '<span class="s"><small>예약</small><b class="num" data-testid="top-count">' + s.count + "건</b></span>" +
        '<span class="s"><small>매출(완료+예정)</small><b class="num" data-testid="top-revenue">' + C.formatWon(s.totalRevenue) + "원</b></span>";
      if (s.unpaid > 0) html += '<span class="s warn"><small>미수금</small><b class="num">' + C.formatWon(s.unpaid) + "원</b></span>";
    }
    $("#sumStrip").innerHTML = html;
    $("#sumStrip").classList.toggle("tiles-" + (S.isOwner ? 4 : 3), !!S.fixedStaff);
    var me = staffName(S.myStaffId);
    $("#meName").textContent = me ? me + "님" : "이름 선택";
    $("#meChip").classList.toggle("none", !me);
    document.querySelectorAll(".tab").forEach(function (b) {
      if (b.getAttribute("data-tab") === S.tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    $("#fab").hidden = !canWrite();
    $("#todayBtn").hidden = S.ym === C.ymOf(C.todayStr());
  }

  function buildTab() {
    S.renderedTab = S.tab;
    var v = $("#view");
    var banner = '<div id="banner"></div>';
    if (S.tab === "list") {
      v.innerHTML = banner +
        '<div class="toolbar"><div class="chips" id="filters" role="group" aria-label="보기"></div>' +
        '<input class="search" id="q" type="search" placeholder="고객·전화·주소·모델 검색 (올해)" data-testid="search" value="' + esc(S.q) + '"></div>' +
        '<div id="body"></div>';
      $("#q").addEventListener("input", function (e) { S.q = e.target.value; renderBody(); });
    } else {
      v.innerHTML = banner + '<div id="body"></div>';
    }
  }

  function renderBanner() {
    var b = $("#banner");
    if (!b) return;
    var msg = "", nt = "";
    var nl = S.conn === "ok" ? newList() : [];
    if (nl.length) {
      nt += '<div class="notice" data-testid="new-notice"><div class="notice-h">' + ntIc("new") + '<b>새 예약 ' + nl.length + "건</b>" +
        '<button class="btn" data-act="seen-all" data-testid="seen-all">모두 확인</button></div>' +
        nl.slice(0, 5).map(function (r) { return '<button class="notice-row" data-open="' + esc(r.id) + '">' + esc(noteLine(r)) + "</button>"; }).join("") +
        (nl.length > 5 ? '<div class="muted" style="font-size:13px">외 ' + (nl.length - 5) + "건</div>" : "") + "</div>";
    }
    if (S.conn === "ok" && S.tab === "list") nt += installNoticeHtml() + reqNoticeHtml() + remindNoticeHtml() + pushNoticeHtml();
    // 알림 여러 개는 카드 하나에 줄로 묶어 보여 줌
    if (nt) msg += '<div class="notice-list">' + nt + "</div>";
    if (S.conn === "nodb") msg += '<div class="banner">공유 장부에 연결되지 않았어요. 인터넷 연결을 확인하고 화면을 새로고침해 주세요.</div>';
    else if (S.readOnly) msg += '<div class="banner">보기 전용이에요. 예약을 넣거나 고치려면 장부 주인에게 \'편집자\'로 초대해 달라고 요청하세요.</div>';
    b.innerHTML = msg;
  }

  function renderBody() {
    renderBanner();
    if (S.tab === "list") renderList();
    else if (S.tab === "cal") renderCal();
    else if (S.tab === "stats") renderStats();
    else renderSettings();
  }

  // ---- 예약 목록 ----
  function filtered() {
    var me = S.myStaffId, today = C.todayStr();
    var src = S.q.trim() ? C.sortReservations(list()) : monthList();
    return src.filter(function (r) {
      if (!C.searchMatch(r, S.q)) return false;
      if (S.filter === "today") return r.date === today;
      if (S.filter === "mine") return me && r.workers && r.workers[me] === true && r.status !== "canceled";
      if (S.filter === "unpaid") return r.status === "done" && !C.isPaid(r) && C.parseWon(r.total) > 0;
      if (S.filter === "open") return r.status === "scheduled" && crew(r).length < (r.needed || 2);
      return true;
    });
  }

  function renderList() {
    var cnt = counts();
    var fs = [["all", "전체"], ["today", "오늘"], ["mine", "내 일정"], ["open", "인원 부족"], ["unpaid", "미수금"]];
    if (S.fixedStaff) fs = S.isOwner
      ? [["all", "전체"], ["open", "인원 부족"], ["unpaid", "미수금"], ["today", "오늘"], ["mine", "내 작업"]]
      : [["today", "오늘"], ["mine", "내 작업"], ["open", "미배정"], ["all", "전체"], ["unpaid", "미수금"]];
    $("#filters").innerHTML = fs.map(function (f) {
      return '<button class="chip" data-filter="' + f[0] + '" aria-pressed="' + (S.filter === f[0]) + '" data-testid="filter-' + f[0] + '">' +
        f[1] + ' <span class="n num">' + cnt[f[0]] + "</span></button>";
    }).join("");

    var body = $("#body");
    if (S.loading && S.conn === "ok") { body.innerHTML = '<div class="empty">예약을 불러오는 중…</div>'; return; }
    var rows = filtered();
    if (!rows.length) {
      var msg = S.q.trim() ? "<b>검색 결과가 없어요</b>올해 예약 중에서 찾았어요. 다른 단어로 찾아보세요."
        : S.filter === "all" ? "<b>" + C.ymLabel(S.ym) + " 예약이 아직 없어요</b>" + (canWrite() ? "[예약 추가] 버튼으로 첫 예약을 넣어 보세요." : "")
        : S.filter === "today" ? "<b>오늘 예약이 없어요</b>"
        : S.filter === "mine" ? (S.myStaffId ? "<b>이번 달 내가 참여하는 예약이 없어요</b>예약 카드의 [참여하기]를 누르면 여기에 모여요." : "<b>이름을 먼저 골라 주세요</b>오른쪽 위 '이름 선택'을 누르세요.")
        : S.filter === "open" ? "<b>인원이 부족한 예약이 없어요</b>"
        : "<b>미수금이 없어요</b>";
      body.innerHTML = '<div class="empty" data-testid="empty"><img class="mk" src="assets/mark.webp" alt="">' + msg + "</div>";
      return;
    }
    var conflicts = conflictsOf();
    body.innerHTML = S.wide ? tableHtml(rows, conflicts) : groupsHtml(rows, conflicts);
  }

  function groupsHtml(rows, conflicts) {
    var today = C.todayStr();
    var groups = [], cur = null;
    rows.forEach(function (r) {
      if (!cur || cur.date !== r.date) { cur = { date: r.date, rows: [] }; groups.push(cur); }
      cur.rows.push(r);
    });
    return groups.map(function (g) {
      var s = C.summarize(g.rows);
      var wd = C.weekdayOf(g.date);
      return '<section class="day" data-date="' + g.date + '"><div class="day-h"><span class="d' + (wd === 0 ? " sun" : "") + '">' + C.dayLabel(g.date) + "</span>" +
        (g.date === today ? '<span class="tag">오늘</span>' : "") +
        '<span class="meta num">' + s.count + "건 · " + C.formatWon(s.totalRevenue) + "원</span></div>" +
        '<div class="cards">' + g.rows.map(function (r) { return cardHtml(r, conflicts[r.id]); }).join("") + "</div></section>";
    }).join("");
  }

  // 참여(true) / 불참("no") / 보류("maybe") — 카톡 일정처럼 각자 응답
  var RSVP = { yes: "참여", no: "불참", maybe: "보류" };
  function rsvpOf(r, id) {
    var v = ((r && r.workers) || {})[id];
    return v === true ? "yes" : v === "no" ? "no" : v === "maybe" ? "maybe" : "";
  }
  function rsvpIds(r, kind) {
    return S.staff.map(function (p) { return p.id; }).filter(function (id) { return rsvpOf(r, id) === kind; });
  }
  function crewHtml(r) {
    var ids = crew(r);
    var need = r.needed || 2;
    var chip = function (id, kind) {
      return '<span class="who' + (kind !== "yes" ? " " + kind : "") + (id === S.myStaffId ? " me" : "") + '">' + esc(staffName(id)) + (kind !== "yes" ? " " + RSVP[kind] : "") + "</span>";
    };
    return ids.map(function (id) { return chip(id, "yes"); }).join("") +
      rsvpIds(r, "maybe").map(function (id) { return chip(id, "maybe"); }).join("") +
      rsvpIds(r, "no").map(function (id) { return chip(id, "no"); }).join("") +
      '<span class="need num' + (ids.length < need && r.status === "scheduled" ? " short" : "") + '">' + ids.length + "/" + need + "명</span>";
  }
  function rsvpHtml(r) {
    if (!canWrite() || r.status !== "scheduled") return "";
    var mine = rsvpOf(r, S.myStaffId);
    return '<div class="c-rsvp" role="group" aria-label="내 참여 여부">' + ["yes", "no", "maybe"].map(function (k) {
      return '<button class="rs rs-' + k + '" data-act="rsvp" data-v="' + k + '" aria-pressed="' + (mine === k) + '" data-testid="rsvp-' + k + '">' + RSVP[k] + "</button>";
    }).join("") + "</div>";
  }

  function conflictText(r, cf) {
    if (!cf || !cf.length) return "";
    return cf.map(function (c) {
      var o = S.all[c.otherId] || {};
      return c.staffIds.map(staffName).filter(Boolean).join("·") + "님이 " + (o.time || "") + " " + ((o.customer || {}).name || "다른") + " 예약과 시간이 겹쳐요";
    }).join(" / ");
  }

  // 휴대폰 카드: 앞면은 시간·고객·작업·기기·인원·단계와 전화/길 안내/예약 상세, 주소·금액·메모는 눌러서 펼침
  var OPEN = {};
  function stageOf(r) { return C.stageOf(r, crew(r).length); }
  function stagePill(r) {
    var st = stageOf(r);
    return '<span class="pill stg-' + st.key + '" data-testid="stage">' + esc(st.label) + "</span>";
  }
  function cardHtml(r, cf) {
    var c = r.customer || {};
    var p = r.payment || {};
    var today = C.todayStr();
    var open = !!OPEN[r.id];
    var pay = "";
    if (r.status !== "canceled") {
      var paid = C.isPaid(r);
      pay = '<span class="pill ' + (paid ? "paid" : r.status === "done" ? "unpaid" : "scheduled") + '">' + (paid ? "입금완료" : r.status === "done" ? "미수금" : "입금 전") + "</span>" +
        "<span>" + esc(p.method && p.method !== "미정" ? p.method : "결제방법 미정") + "</span>";
    }
    var models = C.modelsSummary(r.items);
    var hasAddr = !!(c.address || (r.moveTo || {}).address);
    var quick = '<div class="c-quick">' +
      (c.phone ? '<button class="qb" data-act="phone" data-testid="call">' + ICON.phone + "전화</button>" : "") +
      (hasAddr ? '<button class="qb" data-act="nav" data-testid="nav">' + ICON.pin + "길 안내</button>" : "") +
      photoBtn(r, "qb") +
      '<button class="qb" data-act="detail" data-testid="detail">' + ICON.doc + "예약 상세</button></div>";
    return '<article class="card st-' + esc(r.status) + (open ? " open" : "") + '" data-id="' + esc(r.id) + '" data-testid="card" tabindex="0" aria-expanded="' + open + '">' +
      '<div class="c-time num"><b>' + esc(r.time) + "</b><span>~" + esc(C.endTime(r.time, r.durationMin).replace(" (다음날)", "+1")) + '</span><span class="dur">' + C.durationLabel(r.durationMin) + "</span></div>" +
      '<div class="c-main">' +
        '<div class="c-r1"><span class="c-name">' + esc(c.name || C.formatPhone(c.phone) || "이름 없음") + "</span>" + (isNew(r) ? '<span class="pill new" data-testid="new-badge">NEW</span>' : "") +
          stagePill(r) + '<span class="c-chev" aria-hidden="true">' + ICON.chev + "</span></div>" +
        '<div class="c-items"><span class="w">' + esc(C.worksSummary(r.items)) + "</span> · " + esc(C.itemsSummary(r.items)) + "</div>" +
        '<div class="c-crew">' + crewHtml(r) + "</div>" +
        (cf ? '<div class="c-warn" data-testid="conflict">' + esc(conflictText(r, cf)) + "</div>" : "") +
        quick + stepActs(r, today) + rsvpHtml(r) +
        '<div class="c-more"' + (open ? "" : " hidden") + ' data-testid="card-more">' +
          '<div class="c-moneyrow"><span class="c-amt num" data-testid="card-amt">' + C.formatWon(r.total) + "원</span>" + (pay ? '<span class="c-pay">' + pay + "</span>" : "") + "</div>" +
          '<div class="c-links">' +
            (c.phone ? '<button class="lk" data-act="phone">' + ICON.phone + '<span class="num">' + esc(C.formatPhone(c.phone)) + "</span></button>" : "") +
            addrLinks(r) +
          "</div>" +
          (models ? '<div class="c-note"><b>모델</b> ' + esc(models) + "</div>" : "") +
          (r.note ? '<div class="c-note"><b>메모</b> ' + esc(r.note) + "</div>" : "") +
          ((r.site || {}).memo ? '<div class="c-note"><b>현장</b> ' + esc(r.site.memo) + "</div>" : "") +
          stepperHtml(r) + logHtml(r) +
        "</div>" +
      "</div></article>";
  }

  // 진행 단계 표시(확정 › 직원 배정 › 이동 중 › 작업 중 › 작업 완료 › 입금 완료)
  function stepperHtml(r) {
    var st = stageOf(r);
    if (st.key === "canceled") return '<div class="stepper canceled">취소된 예약</div>';
    return '<ol class="stepper" aria-label="진행 단계">' + C.STAGES.slice(1).filter(function (g) {
      return (g.key !== "moving" && g.key !== "working") || g.key === st.key;
    }).map(function (g) {
      var i = C.STAGES.indexOf(g);
      return '<li class="' + (i < st.step ? "past" : i === st.step ? "now" : "") + '">' + esc(g.label) + "</li>";
    }).join("") + "</ol>";
  }
  // 누가 언제 단계를 바꿨는지(전화 확인·인계용)
  function logHtml(r) {
    var rows = [];
    if (r.createdAt) rows.push({ s: "created", by: r.createdBy, at: r.createdAt });
    rows = rows.concat(C.statusLog(r));
    if (!rows.length) return "";
    return '<ul class="c-log" data-testid="status-log">' + rows.map(function (e) {
      return "<li><span class=\"num\">" + esc(fmtStamp(e.at)) + "</span> " + esc(e.s === "created" ? "등록" : C.LOG_LABEL[e.s] || e.s) + (staffName(e.by) ? " · " + esc(staffName(e.by)) : "") + "</li>";
    }).join("") + "</ul>";
  }

  // 이전설치면 출발지 → 도착지 두 개, 아니면 주소 하나
  function addrLinks(r) {
    var c = r.customer || {}, to = r.moveTo || {};
    if (C.isMove(r)) {
      return (c.address ? '<button class="lk" data-act="addr" data-testid="addr-from">' + ICON.pin + '<em class="tag-from">출발</em><span>' + esc(c.address) + "</span></button>" : "") +
        (to.address ? '<button class="lk" data-act="addr2" data-testid="addr-to">' + ICON.pin + '<em class="tag-to">도착</em><span>' + esc(to.address) + "</span></button>" : "");
    }
    return c.address ? '<button class="lk" data-act="addr">' + ICON.pin + "<span>" + esc(c.address) + "</span></button>" : "";
  }
  function photoBtn(r, cls) {
    var n = C.photoCounts(r).total;
    if (!n && !(S.assets && canWrite())) return "";
    return '<button class="' + (cls || "lk") + '" data-act="photos" data-testid="photos-btn">' + ICON.camera + '<span class="num">' + (n ? "사진 " + n : cls ? "사진" : "사진 추가") + "</span></button>";
  }

  // 카드 아래 버튼: 완료(누구나)·입금확인(넣은 사람·사장님). 이동 시작·작업 시작 단계 버튼은 쓰지 않음
  function stepActs(r, today) {
    if (!canWrite() || r.status === "canceled") return "";
    var out = quickActs(r, today);
    return out ? '<div class="c-steps">' + out + "</div>" : "";
  }
  // 완료는 누구나, 입금확인은 예약을 넣은 사람·사장님만
  function quickActs(r, today) {
    var acts = "";
    if (!canWrite() || r.status === "canceled") return acts;
    if ((r.status === "scheduled" || r.status === "moving" || r.status === "working") && r.date <= today) acts += '<button class="btn good" data-act="done" data-testid="quick-done">완료</button>';
    if (r.status === "done" && !C.isPaid(r) && canEditRes(r)) acts += '<button class="btn good" data-act="paid" data-testid="quick-paid">입금확인</button>';
    return acts;
  }

  // PC 표: 옆으로 밀지 않아도 한 화면에 들어오게 전화는 고객 아래, 작업은 기기 아래, 결제는 금액 아래에 둠
  function itemsCell(r) {
    var items = C.cleanItems(r.items);
    if (!items.length) return "";
    return items.map(function (it) {
      return '<div class="it"><b>' + esc(it.type) + '</b><span class="sub">' + it.qty + "대 · " + esc(it.work) + (it.model ? " · " + esc(it.model) : "") + "</span></div>";
    }).join("");
  }
  function tableHtml(rows, conflicts) {
    var today = C.todayStr();
    var out = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>시간</th><th>고객</th><th>주소</th><th>기기 · 작업</th><th class="r">금액 · 결제</th><th>상태</th><th>참여 직원</th><th></th></tr></thead><tbody>';
    var lastDate = null;
    rows.forEach(function (r) {
      if (r.date !== lastDate) {
        lastDate = r.date;
        var s = C.summarize(rows.filter(function (x) { return x.date === r.date; }));
        out += '<tr class="dayrow"><td colspan="8">' + C.dayLabel(r.date) + (r.date === today ? " · 오늘" : "") + ' <span class="muted num">' + s.count + "건 · " + C.formatWon(s.totalRevenue) + "원</span></td></tr>";
      }
      var c = r.customer || {}, p = r.payment || {};
      var cf = conflicts[r.id];
      var acts = rsvpHtml(r) + stepActs(r, today);
      out += '<tr class="row st-' + esc(r.status) + '" data-id="' + esc(r.id) + '" data-testid="card">' +
        '<td class="nowrap num"><b>' + esc(r.time) + "</b>~" + esc(C.endTime(r.time, r.durationMin)) + '<span class="sub">' + C.durationLabel(r.durationMin) + "</span></td>" +
        '<td class="cust"><b>' + esc(c.name || "") + "</b>" +
          (c.phone ? '<button class="lk" data-act="phone"><span class="num">' + esc(C.formatPhone(c.phone)) + "</span></button>" : "") +
          (cf ? '<span class="sub" style="color:var(--bad)" data-testid="conflict">' + esc(conflictText(r, cf)) + "</span>" : "") + "</td>" +
        '<td><div class="c-links addr-box">' + addrLinks(r) + photoBtn(r) + "</div></td>" +
        "<td>" + itemsCell(r) + "</td>" +
        '<td class="r nowrap num"><b data-testid="card-amt">' + C.formatWon(r.total) + '원</b><span class="sub">' + esc(p.method || "미정") + " · " +
          (r.status === "canceled" ? "" : C.isPaid(r) ? "입금완료" : r.status === "done" ? '<span style="color:var(--warn)">미수금</span>' : "입금 전") + "</span></td>" +
        "<td>" + stagePill(r) + "</td>" +
        '<td><div class="chips">' + crewHtml(r) + "</div></td>" +
        '<td class="acts">' + acts + "</td></tr>";
    });
    return out + "</tbody></table></div>";
  }

  // ---- 달력 ----
  function renderCal() {
    var ml = monthList();
    var today = C.todayStr();
    var byDay = {};
    ml.forEach(function (r) {
      if (r.status === "canceled") return;
      var d = byDay[r.date] = byDay[r.date] || { n: 0, won: 0 };
      d.n++; d.won += C.parseWon(r.total);
    });
    if (!S.calDay || C.ymOf(S.calDay) !== S.ym) S.calDay = C.ymOf(today) === S.ym ? today : null;
    var first = C.weekdayOf(S.ym + "-01"), n = C.daysInMonth(S.ym);
    var cells = "";
    for (var i = 0; i < first; i++) cells += '<div class="cell blank"></div>';
    for (var d = 1; d <= n; d++) {
      var ds = S.ym + "-" + C.pad(d), info = byDay[ds];
      var cls = "cell" + ((first + d - 1) % 7 === 0 ? " sun" : "") + (ds === today ? " today" : "") + (ds === S.calDay ? " sel" : "");
      cells += '<button class="' + cls + '" data-day="' + ds + '" data-testid="day-' + ds + '"><span class="dn">' + d + "</span>" +
        (info ? '<span class="cnt num">' + info.n + '건</span><span class="won num">' + C.shortWon(info.won) + "</span>" : "") + "</button>";
    }
    var tail = (7 - ((first + n) % 7)) % 7;
    for (var j = 0; j < tail; j++) cells += '<div class="cell blank"></div>';
    var html = '<div class="cal"><div class="cal-head">' + C.WEEKDAYS.map(function (w) { return "<div>" + w + "</div>"; }).join("") +
      '</div><div class="cal-grid">' + cells + "</div></div>";
    if (S.calDay) {
      var dayRows = ml.filter(function (r) { return r.date === S.calDay; });
      var conflicts = conflictsOf();
      html += '<div class="section-title">' + C.dayLabel(S.calDay) + " 예약 " + dayRows.length + "건</div>";
      html += dayRows.length ? '<div class="cards" data-testid="cal-day-list">' + dayRows.map(function (r) { return cardHtml(r, conflicts[r.id]); }).join("") + "</div>"
        : '<div class="empty">이날은 예약이 없어요.' + (canWrite() ? ' <button class="linkish" data-act="add-on-day">이날 예약 추가</button>' : "") + "</div>";
    } else {
      html += '<p class="muted" style="margin-top:12px">날짜를 누르면 그날 예약이 아래에 나와요.</p>';
    }
    $("#body").innerHTML = html;
  }

  // ---- 통계 ----
  function renderStats() {
    var ml = C.filterMonth(list(), S.ym);
    var s = C.summarize(ml);
    var y = S.ym.slice(0, 4);
    var html = '<div class="tiles" data-testid="stats-tiles">' +
      '<div class="tile"><small>예약 건수</small><div class="big num" data-testid="st-count">' + s.count + '<span class="u">건</span></div><div class="sub num">완료 ' + s.done + " · 예정 " + s.scheduled + (s.canceled ? " · 취소 " + s.canceled : "") + "</div></div>" +
      '<div class="tile"><small>총매출 (완료+예정)</small><div class="big num" data-testid="st-total">' + C.formatWon(s.totalRevenue) + '<span class="u">원</span></div><div class="sub num">기기 ' + s.units + "대</div></div>" +
      '<div class="tile"><small>완료 매출 (확정)</small><div class="big num" data-testid="st-done">' + C.formatWon(s.doneRevenue) + '<span class="u">원</span></div><div class="sub num">예정 ' + C.formatWon(s.scheduledRevenue) + "원</div></div>" +
      '<div class="tile' + (s.unpaid > 0 ? " warn" : "") + '"><small>미수금</small><div class="big num" data-testid="st-unpaid">' + C.formatWon(s.unpaid) + '<span class="u">원</span></div><div class="sub num">' + (s.unpaidCount ? s.unpaidCount + "건 입금 확인 필요" : "모두 입금됨") + "</div></div>" +
      "</div>";

    html += '<div class="section-title">' + y + "년 월별 매출</div>" +
      '<div class="panel"><div class="legend"><span><i style="background:var(--accent)"></i>완료 매출</span><span><i style="background:var(--bar-plan)"></i>예정 매출</span>' +
      '<button class="linkish" data-act="toggle-table" style="margin-left:auto">' + (S.statsTable ? "그래프로 보기" : "표로 보기") + "</button></div>" +
      '<div class="chart-box" id="chart" data-testid="year-chart"></div></div>';

    var maxT = Math.max.apply(null, C.TYPES.map(function (t) { return s.byType[t]; }).concat([1]));
    var maxW = Math.max.apply(null, C.WORKS.map(function (w) { return s.byWork[w]; }).concat([1]));
    html += '<div class="grid2"><div><div class="section-title">기기 종류별 대수</div><div class="panel hbars" data-testid="by-type">' +
      C.TYPES.map(function (t) {
        return '<div class="hbar"><span class="lab">' + esc(t) + '</span><span class="track"><span class="fill" style="width:' + (s.byType[t] / maxT * 100) + '%"></span></span><span class="val num" data-type="' + esc(t) + '">' + s.byType[t] + "대</span></div>";
      }).join("") + "</div></div>" +
      '<div><div class="section-title">작업 종류별 건수</div><div class="panel hbars" data-testid="by-work">' +
      C.WORKS.map(function (w) {
        return '<div class="hbar"><span class="lab">' + esc(w) + '</span><span class="track"><span class="fill" style="width:' + (s.byWork[w] / maxW * 100) + '%"></span></span><span class="val num">' + s.byWork[w] + "건</span></div>";
      }).join("") + "</div></div></div>";

    var staffIds = S.staff.map(function (p) { return p.id; });
    html += '<div class="section-title">직원별 참여</div><div class="tbl-wrap"><table class="tbl" data-testid="by-staff"><thead><tr><th>직원</th><th class="r">참여</th><th class="r">완료</th><th class="r">완료 매출(참여 건)</th></tr></thead><tbody>' +
      (staffIds.length ? staffIds.map(function (id) {
        var b = s.byStaff[id] || { count: 0, done: 0, revenue: 0 };
        return "<tr><td><b>" + esc(staffName(id)) + '</b></td><td class="r num">' + b.count + '건</td><td class="r num">' + b.done + '건</td><td class="r num">' + C.formatWon(b.revenue) + "원</td></tr>";
      }).join("") : '<tr><td colspan="4" class="muted">직원 명단이 비어 있어요.</td></tr>') +
      "</tbody></table></div>";

    var methods = C.PAY_METHODS.filter(function (m) { return s.byMethod[m]; });
    if (methods.length) {
      html += '<div class="section-title">결제방법별 완료 매출</div><div class="panel"><div class="chips">' +
        methods.map(function (m) { return '<span class="who">' + esc(m) + ' <span class="num">' + C.formatWon(s.byMethod[m]) + "원</span></span>"; }).join("") + "</div></div>";
    }
    html += '<div class="section-title">내보내기</div><div class="panel" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      '<button class="btn primary" data-act="csv" data-testid="csv">' + esc(C.ymLabel(S.ym)) + " 엑셀(CSV) 받기</button>" +
      '<button class="btn" data-act="csv-year" data-testid="csv-year">' + y + "년 전체 받기</button>" +
      '<span class="muted" style="font-size:13px">엑셀에서 바로 열려요.</span></div>';
    $("#body").innerHTML = html;
    drawChart(C.summarizeYear(list(), y));
  }

  // 눈금 4칸 안팎이 되도록 1·2·5 단위 간격을 고름 (0, 10만, 20만, 30만 …)
  function niceStep(v) {
    var raw = Math.max(v, 40000) / 4;
    var p = Math.pow(10, Math.floor(Math.log10(raw)));
    var steps = [1, 2, 5, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * p >= raw) return steps[i] * p;
    return 10 * p;
  }
  function axisWon(v) {
    if (v === 0) return "0";
    if (v >= 10000) { var m = v / 10000; return (m % 1 ? m.toFixed(1) : C.formatWon(m)) + "만"; }
    return C.formatWon(v);
  }

  function drawChart(months) {
    var box = $("#chart");
    if (!box) return;
    if (S.statsTable) {
      box.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>월</th><th class="r">건수</th><th class="r">완료</th><th class="r">예정</th><th class="r">합계</th><th class="r">미수금</th></tr></thead><tbody>' +
        months.map(function (m) {
          return '<tr><td>' + (+m.ym.slice(5)) + '월</td><td class="r num">' + m.count + '</td><td class="r num">' + C.formatWon(m.doneRevenue) + '</td><td class="r num">' + C.formatWon(m.scheduledRevenue) + '</td><td class="r num"><b>' + C.formatWon(m.totalRevenue) + '</b></td><td class="r num">' + C.formatWon(m.unpaid) + "</td></tr>";
        }).join("") + "</tbody></table></div>";
      return;
    }
    var W = Math.max(280, box.clientWidth || 600), H = 210;
    var padL = 44, padR = 6, padT = 12, padB = 26;
    var top = Math.max.apply(null, months.map(function (m) { return m.totalRevenue; }));
    var step = niceStep(top), ticks = Math.max(1, Math.ceil(top / step)), max = step * ticks;
    var iw = W - padL - padR, ih = H - padT - padB;
    var bw = iw / 12, barW = Math.min(30, bw * 0.62);
    var yOf = function (v) { return padT + ih - (v / max) * ih; };
    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="월별 매출 막대그래프">';
    for (var g = 0; g <= ticks; g++) {
      var v = step * g, yy = yOf(v);
      svg += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + yy + '" y2="' + yy + '" stroke="var(--line)" stroke-width="1"' + (g ? ' stroke-dasharray="2 3"' : "") + "/>";
      svg += '<text x="' + (padL - 6) + '" y="' + (yy + 4) + '" text-anchor="end">' + axisWon(v) + "</text>";
    }
    months.forEach(function (m, i) {
      var cx = padL + bw * i + bw / 2, x = cx - barW / 2;
      var base = yOf(0);
      var hDone = (m.doneRevenue / max) * ih, hPlan = (m.scheduledRevenue / max) * ih;
      var gap = hDone > 0 && hPlan > 0 ? 2 : 0;
      if (hDone > 0) svg += barPath(x, base - hDone, barW, hDone, hPlan > 0 ? 0 : 4, "var(--accent)");
      if (hPlan > 0) svg += barPath(x, base - hDone - hPlan, barW, Math.max(0, hPlan - gap), 4, "var(--bar-plan)");
      svg += '<text x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle"' + (m.ym === S.ym ? ' class="cur"' : "") + ">" + (+m.ym.slice(5)) + (bw >= 36 ? "월" : "") + "</text>";
      svg += '<rect x="' + (padL + bw * i) + '" y="' + padT + '" width="' + bw + '" height="' + (ih + padB) + '" fill="transparent" data-m="' + i + '" style="cursor:pointer"/>';
    });
    svg += "</svg>";
    box.innerHTML = svg + '<div class="tip" hidden></div>';
    var tip = box.querySelector(".tip");
    var show = function (e) {
      var t = e.target.closest("[data-m]");
      if (!t) { tip.hidden = true; return; }
      var m = months[+t.getAttribute("data-m")];
      var i = +t.getAttribute("data-m");
      var scale = box.clientWidth / W;
      tip.innerHTML = "<b>" + (+m.ym.slice(5)) + "월</b> · " + m.count + "건<br>완료 " + C.formatWon(m.doneRevenue) + "원<br>예정 " + C.formatWon(m.scheduledRevenue) + "원";
      tip.hidden = false;
      var left = (padL + bw * i + bw / 2) * scale;
      left = Math.max(70, Math.min(box.clientWidth - 70, left));
      tip.style.left = left + "px";
      tip.style.top = Math.max(56, yOf(m.totalRevenue) * scale - 6) + "px";
    };
    box.onmousemove = show;
    box.onmouseleave = function () { tip.hidden = true; };
    box.onclick = function (e) {
      var t = e.target.closest("[data-m]");
      if (!t) return;
      var ym = months[+t.getAttribute("data-m")].ym;
      if (ym !== S.ym) { setMonth(ym); } else { show(e); }
    };
  }
  function barPath(x, y, w, h, r, fill) {
    if (h <= 0) return "";
    r = Math.min(r, w / 2, h);
    var d = "M" + x + "," + (y + h) + " V" + (y + r) + " Q" + x + "," + y + " " + (x + r) + "," + y +
      " H" + (x + w - r) + " Q" + (x + w) + "," + y + " " + (x + w) + "," + (y + r) + " V" + (y + h) + " Z";
    return '<path d="' + d + '" fill="' + fill + '"/>';
  }

  // ---- 설정 ----
  var staffDraft = null;
  function renderSettings() {
    if (!staffDraft) staffDraft = S.staff.map(function (p) { return { id: p.id, name: p.name }; });
    var html = S.fixedStaff
      ? '<div class="section-title" style="margin-top:4px">내 계정</div><div class="panel" data-testid="my-account"><p style="margin:0 0 8px"><b>' + esc(staffName(S.fixedStaff)) + "님</b>으로 로그인했어요" + (S.isOwner ? " (개발자)" : "") + ".</p>" +
        '<div class="chips"><button class="btn" data-act="switch-user">다른 사용자로 전환</button><button class="btn" data-act="my-pin">비밀번호 바꾸기</button><button class="btn danger" data-act="logout">로그아웃</button></div></div>' +
        (S.user.lockMinutes ? '<div class="section-title">이 기기 자동 잠금</div><div class="panel" data-testid="lock-panel"><div class="chips">' +
          [[0, "사용 안 함"], [10, "10분"], [30, "30분"], [120, "2시간"]].map(function (o) {
            return '<button class="chip" data-lockmin="' + o[0] + '" aria-pressed="' + (S.user.lockMinutes() === o[0]) + '" data-testid="lock-' + o[0] + '">' + o[1] + "</button>";
          }).join("") + '</div><p class="muted" style="margin:8px 0 0;font-size:13px">여러 사람이 같이 쓰는 휴대폰·태블릿이면 켜 두세요. 정한 시간 동안 쓰지 않으면 잠기고, 비밀번호 6자리를 다시 넣어야 열려요. 개인 휴대폰은 "사용 안 함"이면 돼요.</p></div>' : "")
      : '<div class="section-title" style="margin-top:4px">내 이름</div><div class="panel">' +
      (S.staff.length ? '<div class="chips">' + S.staff.map(function (p) {
        return '<button class="chip" data-pick="' + esc(p.id) + '" aria-pressed="' + (p.id === S.myStaffId) + '">' + esc(p.name) + "</button>";
      }).join("") + '</div><p class="muted" style="margin:8px 0 0;font-size:13px">이 기기에서 쓰는 사람을 고르세요. 참여하기·내 일정에 쓰여요.</p>'
        : '<p class="muted" style="margin:0">아래에 직원 명단을 먼저 넣어 주세요.</p>') + "</div>";

    if (I) html += '<div class="section-title">홈 화면 앱</div><div class="panel" data-testid="install-panel">' + installStateHtml() + "</div>";
    if (S.push) html += '<div class="section-title">휴대폰 알림</div><div class="panel" data-testid="push-panel">' + pushStateHtml() + "</div>";
    if (S.bookings) {
      var bookUrl = new URL("book.html", location.href).href;
      html += '<div class="section-title">고객 예약 링크</div><div class="panel"><div class="sel-text" data-testid="book-url">' + esc(bookUrl) + "</div>" +
        '<div class="chips"><button class="btn primary" data-act="copy-book">링크 복사</button><a class="btn" href="' + esc(bookUrl) + '" target="_blank" rel="noopener">열어 보기</a></div>' +
        '<p class="muted" style="margin:8px 0 0;font-size:13px">카톡·문자·블로그에 붙여 주세요. 고객이 이름·연락처·주소·희망 날짜를 적으면 장부 맨 위 "고객 예약 요청"에 나와요.</p></div>';
    }

    html += '<div class="section-title">내 내비 앱</div><div class="panel"><div class="chips" data-testid="nav-pref">' +
      C.NAV_APPS.map(function (a) {
        return '<button class="chip" data-navpref="' + a.key + '" aria-pressed="' + (a.key === myNavApp()) + '">' + esc(a.label) + "</button>";
      }).join("") + '</div><p class="muted" style="margin:8px 0 0;font-size:13px">예약 주소를 누르면 이 앱 버튼이 맨 위에 크게 나와요. 휴대폰마다 따로 정해요.</p></div>';

    if (S.fixedStaff && !S.isOwner) {
      html += '<div class="section-title">직원 명단</div><div class="panel"><div class="chips">' + S.staff.map(function (p) { return '<span class="who">' + esc(p.name) + "</span>"; }).join("") +
        '</div><p class="muted" style="margin:8px 0 0;font-size:13px">직원 명단은 사장님만 고칠 수 있어요.</p></div>';
    } else html += '<div class="section-title">직원 명단</div><div class="panel staff-edit" id="staffEdit">' +
      staffDraft.map(function (p, i) {
        return '<div class="row"><input class="inp" id="staff-' + i + '" data-si="' + i + '" value="' + esc(p.name) + '" placeholder="이름" maxlength="20" data-testid="staff-input">' +
          '<button class="btn danger" data-act="staff-rm" data-si="' + i + '" aria-label="' + esc(p.name || "빈 칸") + ' 삭제">삭제</button></div>';
      }).join("") +
      '<div class="row"><button class="btn" data-act="staff-add" data-testid="staff-add">+ 직원 추가</button>' +
      '<button class="btn primary" data-act="staff-save" data-testid="staff-save" style="margin-left:auto"' + (canWrite() ? "" : " disabled") + ">명단 저장</button></div></div>";
    html += accountsHtml();

    if (S.assets && S.isOwner) {
      html += '<div class="section-title">사진 저장 공간</div><div class="panel" id="usage" data-testid="usage">' + (S.usageText || "확인 중…") + "</div>";
      if (!S.usageAt || Date.now() - S.usageAt > 60000) {
        S.usageAt = Date.now();
        S.assets.list().then(function (l) {
          var u = l.usage || {}, mb = function (b) { return (b / 1048576).toFixed(1) + "MB"; };
          S.usageText = "사진 " + (u.files || 0) + "장 · " + mb(u.bytes || 0) + (u.maxBytes ? " / " + mb(u.maxBytes) + " 사용" : "");
          var el = $("#usage"); if (el) el.textContent = S.usageText;
        }).catch(function () { var el = $("#usage"); if (el) el.textContent = "확인하지 못했어요."; });
      }
    }

    html += '<div class="section-title">앱 정보</div><div class="panel about" data-testid="about"><img src="assets/logo.webp" alt="세탁기 크루 로고">' +
      '<div><div class="t">세탁기 <b>크루</b></div><div class="muted">세척·이전설치 예약과 월별 매출 장부</div>' +
      '<div style="margin-top:6px;font-weight:600">개발 · 신창민</div></div></div>';

    html += '<div class="section-title">함께 쓰는 방법</div><div class="panel help"><ol style="margin:0;padding-left:20px">' + (S.fixedStaff
      ? "<li>휴대폰에서 장부 주소를 열고 내 이름을 누른 뒤 비밀번호 6자리를 넣어요. 한 번 들어오면 다음부터는 바로 열려요.</li>" +
        "<li>브라우저 메뉴의 <b>홈 화면에 추가</b>(아이폰은 사파리 <b>공유</b> 버튼)로 앱처럼 열고, <b>알림 켜기</b>를 눌러 두세요.</li>" +
        "<li>예약을 넣거나 고치면 다른 직원 화면에도 바로 반영되고, 통계도 자동으로 다시 계산돼요.</li></ol>"
      : "<li>장부 주인이 오른쪽 위 <b>공유</b> 메뉴에서 직원 이메일을 <b>편집자</b>로 초대해요. (공개 링크를 켜면 직원이 입력할 수 없게 되니 켜지 마세요.)</li>" +
      "<li>직원은 claude.ai에 로그인한 뒤 받은 링크를 열고, 처음 한 번 자기 이름을 골라요.</li>" +
      "<li>휴대폰에서는 브라우저 메뉴의 <b>홈 화면에 추가</b>로 앱처럼 열 수 있어요.</li>" +
      "<li>예약을 넣거나 고치면 다른 직원 화면에도 바로 반영되고, 통계도 자동으로 다시 계산돼요.</li></ol>") +
      '<p style="margin:10px 0 0">매출 기준: <b>완료 매출</b>은 완료 처리된 예약, <b>예정 매출</b>은 아직 작업 전인 예약 금액이에요. 취소한 예약은 빠져요. <b>미수금</b>은 완료됐지만 입금 확인이 안 된 금액이에요.</p>' +
      '<p class="muted" style="margin:10px 0 0;font-size:13px">연결 상태: ' + (S.conn === "ok" ? (S.readOnly ? "보기 전용" : "공유 장부 연결됨") : S.conn === "connecting" ? "연결 중" : "연결 안 됨") + "</p></div>";
    $("#body").innerHTML = html;
  }

  function openStaffSetup() {
    var rows = "";
    for (var i = 0; i < 5; i++) rows += '<input class="inp" id="setup-' + i + '" placeholder="직원 ' + (i + 1) + ' 이름" maxlength="20" data-testid="setup-input">';
    openModal('<img class="setup-logo" src="assets/logo.webp" alt="세탁기 크루">' + "<h2>직원 명단을 넣어 주세요</h2><p>함께 쓰는 직원 이름이에요. 예약마다 누가 참여하는지 이 이름으로 표시돼요. 나중에 '직원·설정'에서 고칠 수 있어요.</p>" +
      '<div class="staff-edit">' + rows + "</div>" +
      '<button class="btn primary wide" data-act="setup-save" data-testid="setup-save">저장하고 시작하기</button>',
      async function (e) {
        if (!e.target.closest("[data-act=setup-save]")) return;
        var names = [];
        for (var i = 0; i < 5; i++) { var v = $("#setup-" + i).value.trim(); if (v) names.push(v); }
        if (!names.length) { toast("이름을 한 명 이상 넣어 주세요."); return; }
        var listNew = names.map(function (n, i) { return { id: "s" + Date.now().toString(36) + i, name: n }; });
        try {
          // 다른 기기에서 먼저 명단을 만들었으면 덮어쓰지 않음(직원 번호가 바뀌면 참여 기록이 어긋남)
          var cur = await S.db.doc("config/staff").get();
          var curList = cur.exists && Array.isArray((cur.data() || {}).list) ? cur.data().list.filter(function (p) { return p && p.id && p.name; }) : [];
          if (curList.length) {
            closeModal();
            S.staff = curList;
            staffDraft = null;
            toast("이미 직원 명단이 있어서 그 명단을 쓸게요.");
            askIdentity();
            return;
          }
          await S.db.doc("config/staff").set({ list: listNew });
          closeModal();
          S.staff = listNew;
          staffDraft = null;
          askIdentity();
        } catch (err) { toast(writeError(err)); }
      });
  }

  async function saveStaff() {
    var cleaned = staffDraft.map(function (p, i) {
      var inp = $("#staff-" + i);
      return { id: p.id || ("s" + Date.now().toString(36) + i), name: (inp ? inp.value : p.name).trim() };
    }).filter(function (p) { return p.name; });
    if (!cleaned.length) { toast("이름을 한 명 이상 넣어 주세요."); return; }
    try {
      await S.db.doc("config/staff").set({ list: cleaned });
      staffDraft = null;
      toast("직원 명단을 저장했어요.");
    } catch (e) { toast(writeError(e)); }
  }

  // ---------------- 이벤트 ----------------
  function setTab(t) {
    var wasList = S.tab === "list";
    S.tab = t;
    if (t === "settings") staffDraft = null;
    render();
    window.scrollTo(0, 0);
    if (t !== "list" && wasList) pushLayer(); else if (t === "list") releaseGuardSoon();
  }
  function setMonth(ym) {
    S.ym = ym;
    if (S.filter === "today" && ym !== C.ymOf(C.todayStr())) S.filter = "all";
    subscribeYear(ym.slice(0, 4));
    render();
    window.scrollTo(0, 0);
  }

  function bindStatic() {
    $("#tabs").addEventListener("click", function (e) {
      var b = e.target.closest("[data-tab]");
      if (b) setTab(b.getAttribute("data-tab"));
    });
    $("#prevM").onclick = function () { setMonth(C.addMonths(S.ym, -1)); };
    $("#nextM").onclick = function () { setMonth(C.addMonths(S.ym, 1)); };
    $("#todayBtn").onclick = function () { setMonth(C.ymOf(C.todayStr())); };
    $("#sumStrip").onclick = function (e) {
      var t = e.target.closest("[data-tile]");
      if (!t) { setTab("stats"); return; }
      var k = t.getAttribute("data-tile");
      if (k === "stats") { setTab("stats"); return; }
      if (k === "reqs") { openRequests(); return; }
      if (S.tab !== "list") setTab("list");
      S.filter = S.filter === k ? "all" : k;
      if (S.filter === "today" && S.ym !== C.ymOf(C.todayStr())) setMonth(C.ymOf(C.todayStr())); else render();
    };
    $("#fab").onclick = function () { openForm(null); };
    $("#meChip").onclick = function () {
      if (S.fixedStaff) { openAccount(); return; }
      if (!S.staff.length) { if (S.conn === "ok") openStaffSetup(); else setTab("settings"); return; }
      askIdentity();
    };
    $("#view").addEventListener("click", onViewClick);
    $("#view").addEventListener("input", function (e) {
      var si = e.target.getAttribute && e.target.getAttribute("data-si");
      if (si != null && staffDraft && staffDraft[+si]) staffDraft[+si].name = e.target.value;
    });
    $("#view").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target.classList && e.target.classList.contains("card")) openForm(e.target.getAttribute("data-id"));
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (!$("#modal").hidden) closeModal(); else if (!$("#sheet").hidden) closeForm();
    });
  }

  function onViewClick(e) {
    var t = e.target;
    var f = t.closest("[data-filter]");
    if (f) { S.filter = f.getAttribute("data-filter"); if (S.filter === "today" && S.ym !== C.ymOf(C.todayStr())) setMonth(C.ymOf(C.todayStr())); else renderBody(); return; }
    var day = t.closest("[data-day]");
    if (day) { S.calDay = day.getAttribute("data-day"); renderBody(); return; }
    var op = t.closest("[data-open]");
    if (op) { var orr = S.all[op.getAttribute("data-open")]; if (orr) { if (C.ymOf(orr.date) !== S.ym) setMonth(C.ymOf(orr.date)); openForm(orr.id); } return; }
    var pick = t.closest("[data-pick]");
    if (pick) { setMe(pick.getAttribute("data-pick")); return; }
    var lm = t.closest("[data-lockmin]");
    if (lm && S.user && S.user.setLockMinutes) {
      S.user.setLockMinutes(+lm.getAttribute("data-lockmin"));
      renderBody();
      toast(+lm.getAttribute("data-lockmin") ? "이 기기는 " + lm.textContent + " 동안 안 쓰면 잠겨요." : "자동 잠금을 껐어요.");
      return;
    }
    var np = t.closest("[data-navpref]");
    if (np) {
      store("navApp", np.getAttribute("data-navpref"));
      renderBody();
      toast(np.textContent + "을(를) 내 내비 앱으로 정했어요.");
      return;
    }
    var act = t.closest("[data-act]");
    var host = t.closest("[data-id]");
    var r = host ? S.all[host.getAttribute("data-id")] : null;
    if (act) {
      var a = act.getAttribute("data-act");
      if (a === "rsvp" && r) return setRsvp(r, act.getAttribute("data-v"));
      if (a === "done" && r) return quickStatus(r);
      if (a === "paid" && r && canEditRes(r)) return quickPaid(r);
      if (a === "phone" && r) return phoneSheet(r);
      if (a === "addr" && r) return addrSheet(r);
      if (a === "addr2" && r) return addrSheet(r, true);
      if (a === "photos" && r) return openPhotos(r.id);
      if (a === "detail" && r) return openForm(r.id);
      if (a === "nav" && r) return navSheet(r);
      if (a === "stage" && r) return setStage(r, act.getAttribute("data-v"));
      if (a === "seen-all") { markAllSeen(); render(); return; }
      if (a === "csv") return exportCsv(false);
      if (a === "csv-year") return exportCsv(true);
      if (a === "toggle-table") { S.statsTable = !S.statsTable; renderBody(); return; }
      if (a === "add-on-day") return openForm(null, S.calDay);
      if (a === "staff-add") { staffDraft.push({ id: "", name: "" }); renderBody(); var last = $("#staff-" + (staffDraft.length - 1)); if (last) last.focus(); return; }
      if (a === "staff-rm") { staffDraft.splice(+act.getAttribute("data-si"), 1); renderBody(); return; }
      if (a === "staff-save") return saveStaff();
      if (a === "open-reqs") return openRequests();
      if (a === "open-rem") return openReminders();
      if (a === "push-on") return pushOn();
      if (a === "install") return doInstall();
      if (a === "install-later") { store("installLater", String(Date.now() + 3 * 86400000)); renderBanner(); return; }
      if (a === "push-later") { store("pushLater", String(Date.now() + 3 * 86400000)); renderBanner(); return; }
      if (a === "push-off") { S.push.disable().then(refreshPushState); return; }
      if (a === "push-test") { S.push.test().then(function () { toast("시험 알림을 보냈어요. 잠시 뒤 휴대폰을 확인하세요."); }, function () { toast("보내지 못했어요. 다시 눌러 주세요."); }); return; }
      if (a === "my-pin") return myPin();
      if (a === "logout") return S.user.signOut();
      if (a === "switch-user") return S.user.switchUser();
      if (a === "copy-book") return copyText(new URL("book.html", location.href).href, "예약 링크를 복사했어요.");
      if (a === "acct-pin") return acctPin(act.getAttribute("data-sid"));
      if (a === "acct-rm") return acctRemove(act.getAttribute("data-sid"));
      return;
    }
    if (host && r) {
      if (host.tagName === "ARTICLE") { OPEN[r.id] = !OPEN[r.id]; if (OPEN[r.id]) markSeen(r.id); renderBody(); }
      else openForm(r.id);
    }
  }

  function needMe(then) {
    if (S.myStaffId && staffName(S.myStaffId)) return true;
    if (!S.staff.length) { openStaffSetup(); return false; }
    askIdentity(then);
    return false;
  }

  // 같은 버튼을 다시 누르면 응답 취소
  async function setRsvp(r, kind) {
    if (!needMe(function () { setRsvp(S.all[r.id] || r, kind); })) return;
    var me = S.myStaffId;
    var cur = rsvpOf(r, me);
    var val = cur === kind ? false : kind === "yes" ? true : kind;
    var patch = { workers: {} };
    patch.workers[me] = val;
    try {
      await S.db.doc("reservations/" + r.id).update(patch);
      toast(val === false ? RSVP[kind] + " 표시를 취소했어요." : RSVP[kind] + "으로 표시했어요.");
    } catch (e) { toast(writeError(e)); }
  }

  // 단계 기록: log 맵에 {상태, 누가, 언제}를 하나씩 더함(동시에 눌러도 서로 지워지지 않음)
  function logPatch(patch, s) {
    var at = nowIso();
    patch.log = {};
    patch.log[Date.now().toString(36) + "_" + (S.myStaffId || "x")] = { s: s, by: S.myStaffId || "", at: at };
    return patch;
  }
  var stageBusy = {};
  async function setStage(r, s, undo) {
    if (stageBusy[r.id]) return;
    stageBusy[r.id] = true;
    var prev = r.status;
    toast("저장 중…");
    try {
      await S.db.doc("reservations/" + r.id).update(logPatch({ status: s, updatedBy: S.myStaffId || "", updatedAt: nowIso() }, s));
      if (undo) toast(C.STATUS[s] + "(으)로 되돌렸어요.");
      else toast((C.LOG_LABEL[s] || C.STATUS[s]) + " 저장했어요.", { label: "되돌리기", run: function () { setStage(S.all[r.id] || r, prev, true); } });
    } catch (e) { toast("저장 실패 · " + writeError(e)); }
    finally { stageBusy[r.id] = false; }
  }
  function quickStatus(r) {
    return setStage(r, "done");
  }
  async function quickPaid(r) {
    try {
      await S.db.doc("reservations/" + r.id).update(logPatch({ payment: { paid: true }, updatedBy: S.myStaffId || "", updatedAt: nowIso() }, "paid"));
      toast("입금 확인했어요.", { label: "되돌리기", run: function () { S.db.doc("reservations/" + r.id).update(logPatch({ payment: { paid: false } }, "unpaid")).catch(function (e) { toast(writeError(e)); }); } });
    } catch (e) { toast("저장 실패 · " + writeError(e)); }
  }
  // 길 안내: 이전설치면 출발지·도착지 중 고르기
  function navSheet(r) {
    var c = r.customer || {}, to = r.moveTo || {};
    if (!(C.isMove(r) && c.address && to.address)) return addrSheet(r, !c.address && !!to.address);
    openModal("<h2>어디로 갈까요?</h2>" +
      '<button class="btn primary wide" data-go="from" data-testid="nav-from">출발지 (철거하는 곳)</button><p class="muted" style="margin-top:-6px">' + esc(c.address) + "</p>" +
      '<button class="btn primary wide" data-go="to" data-testid="nav-to">도착지 (설치하는 곳)</button><p class="muted" style="margin-top:-6px">' + esc(to.address) + "</p>",
      function (e) { var g = e.target.closest("[data-go]"); if (g) addrSheet(r, g.getAttribute("data-go") === "to"); });
  }

  function copyText(text, okMsg) {
    try {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, function () { toast("길게 눌러서 복사해 주세요."); });
    } catch (e) { toast("길게 눌러서 복사해 주세요."); }
  }

  function phoneSheet(r) {
    var c = r.customer || {};
    var num = C.formatPhone(c.phone), d = C.normalizePhone(c.phone);
    openModal("<h2>" + esc(c.name || "고객") + "</h2>" +
      '<div class="sel-text num">' + esc(num) + "</div>" +
      '<a class="btn primary wide" href="tel:' + esc(d) + '">' + ICON.phone.replace("<svg", '<svg width="20" height="20"') + "전화 걸기</a>" +
      '<a class="btn wide" href="sms:' + esc(d) + '">문자 보내기</a>' +
      '<button class="btn wide" data-copy>번호 복사</button>' +
      '<p class="muted" style="font-size:13px">전화 걸기가 안 되면 번호를 복사해서 걸어 주세요.</p>',
      function (e) { if (e.target.closest("[data-copy]")) copyText(num, "번호를 복사했어요."); });
  }

  function addrSheet(r, dest) {
    var c = r.customer || {}, site = r.site || {};
    if (dest) {
      var to = r.moveTo || {};
      c = { name: c.name, address: to.address };
      site = { floor: to.floor, elevator: to.elevator };
    }
    var extra = [site.floor ? site.floor + "층" : "", site.elevator ? "엘리베이터 " + site.elevator : "", site.parking ? "주차 " + site.parking : ""].filter(Boolean).join(" · ");
    var links = C.navLinks(c.address, C.detectPlatform(navigator.userAgent));
    var mine = myNavApp();
    // 내 내비 앱을 맨 위 큰 버튼으로
    var apps = links.apps.slice().sort(function (a, b) { return (b.key === mine) - (a.key === mine); });
    var a = function (l, cls, main) {
      return '<a class="btn wide' + cls + '" target="_blank" rel="noopener" href="' + esc(l.href) + '" data-nav="' + l.key + '"' +
        (l.copyFirst ? " data-navcopy" : "") + ' data-testid="nav-' + l.key + '">' + esc(l.label) +
        (main ? (l.copyFirst ? " 열기 (주소 자동 복사)" : " 길찾기") : "") + "</a>";
    };
    var html = "<h2>" + esc(c.name || "고객") + (C.isMove(r) ? (dest ? " 도착지 (설치하는 곳)" : " 출발지 (철거하는 곳)") : " 주소") + "</h2>" +
      '<div class="sel-text">' + esc(c.address) + "</div>" +
      (extra || site.memo ? "<p>" + esc(extra) + (site.memo ? "<br>" + esc(site.memo) : "") + "</p>" : "");
    if (apps.length) {
      html += a(apps[0], " primary nav-main", true) +
        '<div class="nav-more">' + apps.slice(1).map(function (l) { return a(l, ""); }).join("") + "</div>" +
        '<div class="nav-web">' + links.web.map(function (l) {
          return '<a class="linkish" target="_blank" rel="noopener" href="' + esc(l.href) + '">' + esc(l.label) + "</a>";
        }).join("") + "</div>";
    } else {
      html += links.web.map(function (l, i) {
        return '<a class="btn wide' + (i ? "" : " primary") + '" target="_blank" rel="noopener" href="' + esc(l.href) + '" data-testid="web-' + l.key + '">' + esc(l.label) + "에서 보기</a>";
      }).join("");
    }
    html += '<button class="btn wide" data-copy>주소 복사</button>' +
      '<p class="muted" style="font-size:13px">' + (apps.length
        ? "앱이 열리면 [도착]을 누르세요. 카카오내비는 주소가 자동 복사되니 검색창에 붙여넣으면 돼요. 앱이 안 열리면 [주소 복사] 후 내비에 붙여넣으세요."
        : "PC에서는 웹 지도로 열려요. 휴대폰에서 열면 티맵·카카오내비 버튼이 나와요.") + "</p>";
    openModal(html, function (e) {
      if (e.target.closest("[data-copy]")) { copyText(c.address || "", "주소를 복사했어요."); return; }
      // 링크 이동은 막지 않고, 카카오내비는 같은 클릭 안에서 주소를 먼저 복사
      if (e.target.closest("[data-navcopy]")) copyText(c.address || "", "주소를 복사했어요. 카카오내비 검색창에 붙여넣으세요.");
    });
  }

  function myNavApp() {
    var v = store("navApp");
    return C.NAV_APPS.some(function (a) { return a.key === v; }) ? v : "tmap";
  }

  async function exportCsv(year) {
    var rows = year ? list() : C.filterMonth(list(), S.ym);
    if (!rows.length) { toast("내보낼 예약이 없어요."); return; }
    var csv = C.toCSV(rows, S.staff);
    var name = "예약내역_" + (year ? S.ym.slice(0, 4) + "년" : S.ym) + ".csv";
    if (!S.downloads) { toast("이 화면에서는 파일 받기를 쓸 수 없어요."); return; }
    try {
      await S.downloads.save({ filename: name, data: csv });
      toast("파일을 저장했어요.");
    } catch (e) {
      if (e && e.code === "declined") return;
      toast(e && e.code === "rate_limited" ? "잠시 뒤 다시 눌러 주세요." : "파일을 저장하지 못했어요.");
    }
  }

  // ---------------- 입력 폼 ----------------
  var DUR = [30, 60, 90, 120, 180, 240];

  function blank(date) {
    var today = C.todayStr();
    var d = date || (S.ym === C.ymOf(today) ? today : S.ym + "-01");
    var workers = {};
    if (S.myStaffId && staffName(S.myStaffId)) workers[S.myStaffId] = true;
    return {
      date: d, time: "09:00", durationMin: 60, status: "scheduled",
      customer: { name: "", phone: "", address: "" }, site: { floor: "", elevator: "", parking: "", memo: "" },
      moveTo: { address: "", floor: "", elevator: "" },
      items: [{ type: "통돌이", model: "", qty: 1, work: "세척" }],
      total: 0, payment: { method: "미정", paid: false }, needed: 2, workers: workers, note: ""
    };
  }

  function openForm(id, date, prefill) {
    if (!id && !canWrite()) return;
    // 새 예약은 누가 넣는지 알아야 나중에 그 사람만 고칠 수 있음
    if (!id && !needMe(function () { openForm(null, date, prefill); })) return;
    var r = id ? S.all[id] : null;
    if (id && !r) return;
    if (id) markSeen(id);
    var data = r ? clone(r) : blank(date);
    if (prefill) Object.keys(prefill).forEach(function (k) { if (k !== "fromRequest" && k !== "requestedAt" && prefill[k] !== undefined) data[k] = clone({ v: prefill[k] }).v; });
    delete data.id;
    data.customer = Object.assign({ name: "", phone: "", address: "" }, data.customer);
    data.site = Object.assign({ floor: "", elevator: "", parking: "", memo: "" }, data.site);
    data.moveTo = Object.assign({ address: "", floor: "", elevator: "" }, data.moveTo);
    data.payment = Object.assign({ method: "미정", paid: false }, data.payment);
    data.workers = data.workers || {};
    if (!Array.isArray(data.items) || !data.items.length) data.items = [{ type: "통돌이", model: "", qty: 1, work: "세척" }];
    F = { readOnly: !!(r && !canEditRes(r)), id: id, data: data, orig: r ? clone(r) : null, openedAt: r ? r.updatedAt || r.createdAt || "" : "", errors: {}, staleOk: false, confirmDel: false, hist: null, histFor: "", fromRequest: (prefill && prefill.fromRequest) || null, requestedAt: (prefill && prefill.requestedAt) || null };
    if (!id) F.newId = S.db.collection("reservations").doc().id; // 다시 눌러도 같은 예약 번호 → 중복 예약 안 생김
    var dr = loadDraft(id);
    if (dr && dr.data && (!r || dr.at > (r.updatedAt || r.createdAt || "")) && !F.readOnly) F.draft = dr;
    renderForm();
    $("#sheet").hidden = false;
    growMemo(); // 화면이 보인 뒤에 높이를 재야 메모 전체가 보임
    document.body.style.overflow = "hidden";
    pushLayer();
    if (!id) setTimeout(function () { var n = $("#f-name"); if (n && S.wide) n.focus(); }, 50);
    if (data.customer.phone) lookupHistory();
  }

  function closeForm(saved) {
    if (!saved) flushDraft(); else clearTimeout(draftTimer);
    if (F && F.dirty && !saved) toast("입력한 내용은 이 휴대폰에 임시 저장해 두었어요. 다시 열면 불러올 수 있어요.");
    F = null;
    $("#sheet").hidden = true;
    $("#sheet").innerHTML = "";
    document.body.style.overflow = "";
    releaseGuardSoon();
  }

  function chipGroup(name, options, value, labels) {
    return '<div class="chips" role="group">' + options.map(function (o, i) {
      return '<button type="button" class="chip" data-f="' + name + '" data-v="' + esc(o) + '" aria-pressed="' + (String(value) === String(o)) + '">' + esc(labels ? labels[i] : o) + "</button>";
    }).join("") + "</div>";
  }

  function memoBlock(d) {
    return '<div class="fs memo-fs"><div class="f"><label for="f-note" class="memo-lab">메모 (고객 요청사항)</label>' +
      '<textarea class="inp memo-big" id="f-note" placeholder="고객 요청사항 등" data-testid="f-note">' + esc(d.note) + "</textarea></div></div>";
  }
  function statusChips(cur) {
    var keys = ["scheduled", "done", "canceled"];
    if (cur === "moving" || cur === "working") keys.splice(1, 0, cur);
    return chipGroup("status", keys, cur, keys.map(function (k) { return C.STATUS[k]; }));
  }

  // 예약 상세의 메모: 내용이 많아도 스크롤 없이 한눈에 보이게 높이를 내용에 맞춤
  function growMemo() {
    var t = $("#f-note");
    if (!t) return;
    t.style.height = "auto";
    t.style.height = Math.max(t.scrollHeight + 2, 132) + "px";
  }

  function renderForm() {
    var d = F.data, e = F.errors, c = d.customer, site = d.site;
    var custom = DUR.indexOf(+d.durationMin) < 0;
    var meta = F.orig ? "등록 " + (staffName(F.orig.createdBy) || "") + " " + fmtStamp(F.orig.createdAt) +
      (F.orig.updatedAt ? " · 마지막 수정 " + (staffName(F.orig.updatedBy) || "") + " " + fmtStamp(F.orig.updatedAt) : "") : "";
    var html = '<div class="sheet-in" role="dialog" aria-modal="true" aria-labelledby="formTitle">' +
      '<div class="sheet-h wrap"><h2 id="formTitle">' + (F.id ? "예약 수정" : "새 예약") + '</h2><button class="icon-btn" data-x aria-label="닫기">' + ICON.close + "</button></div>" +
      '<form class="sheet-b wrap" id="form" novalidate>' +
      '<div id="liveWarn"></div><div id="draftNote"></div>' +
      (F.id ? memoBlock(d) : "") +

      '<div class="fs"><h3><span class="no">1</span>일정</h3><div class="f2">' +
        '<div class="f"><label for="f-date">예약일자</label><input class="inp" type="date" id="f-date" value="' + esc(d.date) + '" data-testid="f-date">' + (e.date ? '<span class="err">' + e.date + "</span>" : "") + "</div>" +
        '<div class="f"><label for="f-time">시작 시간</label><input class="inp" type="time" id="f-time" step="600" value="' + esc(d.time) + '" data-testid="f-time">' + (e.time ? '<span class="err">' + e.time + "</span>" : "") + "</div></div>" +
        '<div class="f"><span class="lab">소요시간</span>' +
          chipGroup("dur", DUR.concat(["custom"]), custom ? "custom" : d.durationMin, ["30분", "1시간", "1시간 30분", "2시간", "3시간", "4시간", "직접 입력"]) +
          (custom ? '<div style="display:flex;gap:8px;align-items:center"><input class="inp" id="f-durmin" type="number" inputmode="numeric" min="10" step="10" value="' + esc(d.durationMin) + '" style="max-width:120px" data-testid="f-durmin"> 분</div>' : "") +
          '<div class="endinfo" id="endInfo"></div>' + (e.durationMin ? '<span class="err">' + e.durationMin + "</span>" : "") + '<div class="wn" id="w-time"></div></div>' +
      "</div>" +

      '<div class="fs"><h3><span class="no">2</span>작업 · 기기</h3><div id="items" style="display:grid;gap:8px">' + d.items.map(itemHtml).join("") + "</div>" +
        '<button type="button" class="btn" data-addi data-testid="add-item">+ 기기 추가</button>' + (e.items ? '<span class="err">' + e.items + "</span>" : "") + "</div>" +

      '<div class="fs" id="fsCust"><h3><span class="no">3</span><span id="custTitle">고객 · 방문 주소</span></h3>' +
        '<div class="f"><label for="f-phone">전화번호</label><input class="inp num" type="tel" inputmode="tel" id="f-phone" value="' + esc(c.phone) + '" placeholder="010-0000-0000" autocomplete="off" data-testid="f-phone">' + (e.phone ? '<span class="err">' + e.phone + "</span>" : "") + '<div id="hist"></div></div>' +
        '<div class="f"><label for="f-name">고객 이름</label><input class="inp" id="f-name" value="' + esc(c.name) + '" placeholder="예: 김민지" autocomplete="off" data-testid="f-name"></div>' +
        (e.customer ? '<span class="err">' + e.customer + "</span>" : "") +
        '<div class="f"><label for="f-addr" id="addrLabel">방문 주소</label><input class="inp" id="f-addr" value="' + esc(c.address) + '" placeholder="예: 수원시 영통구 ○○아파트 101동 1203호" autocomplete="off" data-testid="f-addr"></div>' +
        '<div class="move" id="moveBlock" hidden data-testid="move-block">' +
          '<div class="f"><label for="f-addr2">도착지 주소 (설치하는 곳)</label><input class="inp" id="f-addr2" value="' + esc(d.moveTo.address) + '" placeholder="예: 용인시 기흥구 ○○아파트 105동 701호" autocomplete="off" data-testid="f-addr2"></div>' +
          '<div class="f2"><div class="f"><label for="f-floor2">도착지 층수</label><input class="inp" id="f-floor2" inputmode="numeric" value="' + esc(d.moveTo.floor) + '" placeholder="예: 7"></div>' +
          '<div class="f"><span class="lab">도착지 엘리베이터</span>' + chipGroup("elevator2", ["있음", "없음"], d.moveTo.elevator) + "</div></div>" +
        "</div>" +
        '<div class="wn" id="w-addr"></div><div class="wn" id="w-dup" data-testid="dup-warn"></div>' +
      "</div>" +

      '<div class="fs"><h3><span class="no">4</span>금액 · 배정</h3>' +
        '<div class="f"><label for="f-total">총 금액</label><div class="won-inp"><input class="inp num" id="f-total" inputmode="numeric" value="' + (d.total ? C.formatWon(d.total) : "") + '" placeholder="0" data-testid="f-total"><span>원</span></div>' + (e.total ? '<span class="err">' + e.total + "</span>" : "") + '<div class="wn" id="w-total"></div></div>' +
        '<div class="f"><span class="lab">결제방법</span>' + chipGroup("method", C.PAY_METHODS, d.payment.method) + "</div>" +
        '<label class="toggle"><input type="checkbox" id="f-paid"' + (d.payment.paid ? " checked" : "") + ' data-testid="f-paid">입금 확인됨</label>' +
        '<div class="f"><span class="lab">필요 인원</span>' + chipGroup("needed", [1, 2, 3, 4], d.needed || 2, ["1명", "2명", "3명", "4명"]) + "</div>" +
        '<div class="f"><span class="lab">참여 직원 (눌러서 선택)</span><div class="chips" data-testid="f-workers">' +
          (S.staff.length ? S.staff.map(function (p) {
            return '<button type="button" class="chip" data-w="' + esc(p.id) + '" aria-pressed="' + (d.workers[p.id] === true) + '">' + esc(p.name) + "</button>";
          }).join("") : '<span class="muted">직원·설정에서 명단을 먼저 넣어 주세요.</span>') + '</div><div class="wn" id="w-crew"></div></div>' +
        (F.id ? '<div class="f"><span class="lab">진행 상태</span>' + statusChips(d.status) + "</div>" : "") +
      "</div>" +
      (F.id ? "" : memoBlock(d)) +

      '<details class="fs"' + (site.floor || site.elevator || site.parking || site.memo ? " open" : "") + '><summary>현장 정보 (층수·엘리베이터·주차)</summary>' +
        '<div class="f2"><div class="f"><label for="f-floor">층수</label><input class="inp" id="f-floor" inputmode="numeric" value="' + esc(site.floor) + '" placeholder="예: 12"></div>' +
        '<div class="f"><span class="lab">엘리베이터</span>' + chipGroup("elevator", ["있음", "없음"], site.elevator) + "</div></div>" +
        '<div class="f"><span class="lab">주차</span>' + chipGroup("parking", ["가능", "불가"], site.parking) + "</div>" +
        '<div class="f"><label for="f-sitememo">현장 메모</label><textarea class="inp" id="f-sitememo" placeholder="예: 베란다 배수구 좁음, 공동현관 비번 1234">' + esc(site.memo) + "</textarea></div>" +
      "</details>" +
      (F.id ? '<div class="fs"><h3>작업 사진</h3><div id="photoLine"></div></div>' : "") +

      (F.orig ? '<div class="fs"><h3>진행 기록</h3>' + stepperHtml(F.orig) + logHtml(F.orig) + "</div>" : "") +
      (meta ? '<p class="meta-line">' + esc(meta) + "</p>" : "") +
      "</form>" +
      '<div class="sheet-f wrap" id="formFoot"></div></div>';
    var sh = $("#sheet");
    sh.innerHTML = html;
    if (F.readOnly) {
      // 보기만: 입력칸과 버튼을 잠그고(사진 보기 버튼은 남김) 누가 고칠 수 있는지 안내
      sh.querySelectorAll("#form input, #form select, #form textarea, #form button").forEach(function (el) {
        if (!el.hasAttribute("data-photos")) el.disabled = true;
      });
      $("#formTitle").textContent = "예약 보기";
      var who = staffName(F.orig.createdBy);
      $("#form").insertAdjacentHTML("afterbegin", '<div class="banner info" data-testid="readonly-note">' +
        (who ? esc(who) + "님이 넣은 예약이에요. 수정은 " + esc(who) + "님이나 사장님만 할 수 있어요." : "이 예약은 사장님만 수정할 수 있어요.") +
        " 참여·불참·보류와 사진은 예약 목록에서 누구나 할 수 있어요.</div>");
    }
    renderFoot();
    growMemo();
    refreshFormLive();
    renderHist();
    bindForm();
  }

  function itemHtml(it, i) {
    return '<div class="item" data-i="' + i + '" data-testid="item">' +
      '<select data-k="type" aria-label="기기 종류" data-testid="item-type">' + C.TYPES.map(function (t) { return "<option" + (t === it.type ? " selected" : "") + ">" + esc(t) + "</option>"; }).join("") + "</select>" +
      '<select data-k="work" aria-label="작업" data-testid="item-work">' + C.WORKS.map(function (w) { return "<option" + (w === it.work ? " selected" : "") + ">" + esc(w) + "</option>"; }).join("") + "</select>" +
      '<input class="full" data-k="model" value="' + esc(it.model) + '" placeholder="모델명 (예: WA16T6A10)" aria-label="모델명" data-testid="item-model">' +
      '<div class="qty"><button type="button" data-q="-1" aria-label="대수 줄이기">−</button><input data-k="qty" inputmode="numeric" value="' + esc(it.qty) + '" aria-label="대수" data-testid="item-qty"><button type="button" data-q="1" aria-label="대수 늘리기" data-testid="item-plus">+</button></div>' +
      (F.data.items.length > 1 ? '<button type="button" class="btn danger rm" data-rmi>기기 빼기</button>' : "<span></span>") +
      "</div>";
  }

  function renderFoot() {
    var foot = $("#formFoot");
    if (!foot) return;
    if (F.confirmDel) {
      foot.innerHTML = '<span style="align-self:center;font-weight:700;flex:1">이 예약을 지울까요? 되돌릴 수 없어요.</span>' +
        '<button class="btn" data-delno>아니요</button><button class="btn danger solid" data-delyes data-testid="del-yes">삭제</button>';
      return;
    }
    if (F.readOnly) { foot.innerHTML = '<button class="btn primary grow" data-x data-testid="close-view">닫기</button>'; return; }
    var label = saving ? "저장 중…" : F.saveErr ? "다시 저장" : F.dupOk ? "그래도 저장" : F.id ? "수정 저장" : "예약 저장";
    foot.innerHTML = (F.saveErr ? '<div class="save-err" data-testid="save-err">저장 실패 · ' + esc(F.saveErr) + " 입력한 내용은 그대로 있어요.</div>" : "") +
      (F.id ? '<button class="btn danger" data-del data-testid="del">삭제</button>' : '<button class="btn" data-x>닫기</button>') +
      '<button class="btn primary grow" data-save data-testid="save"' + (saving ? " disabled" : "") + ">" + label + "</button>";
  }

  function readForm() {
    var d = F.data;
    var g = function (id) { var el = $("#" + id); return el ? el.value : ""; };
    d.date = g("f-date");
    d.time = g("f-time");
    var dm = $("#f-durmin");
    if (dm) d.durationMin = parseInt(dm.value, 10) || 0;
    d.customer.phone = C.formatPhone(g("f-phone").trim());
    d.customer.name = g("f-name").trim();
    d.customer.address = g("f-addr").trim();
    d.moveTo.address = g("f-addr2").trim();
    d.moveTo.floor = g("f-floor2").trim();
    d.total = C.parseWon(g("f-total"));
    var paid = $("#f-paid"); d.payment.paid = !!(paid && paid.checked);
    d.site.floor = g("f-floor").trim();
    d.site.memo = g("f-sitememo").trim();
    d.note = g("f-note").trim();
    document.querySelectorAll("#items .item").forEach(function (row) {
      var i = +row.getAttribute("data-i"), it = d.items[i];
      if (!it) return;
      it.type = row.querySelector("[data-k=type]").value;
      it.work = row.querySelector("[data-k=work]").value;
      it.model = row.querySelector("[data-k=model]").value.trim();
      var q = parseInt(row.querySelector("[data-k=qty]").value, 10);
      it.qty = q > 0 ? q : 0;
    });
    return d;
  }

  function refreshFormLive() {
    if (!F || !$("#endInfo")) return;
    var d = F.data;
    // 이전설치가 있으면 출발지/도착지
    var mv = C.isMove(d);
    $("#moveBlock").hidden = !mv;
    $("#addrLabel").textContent = mv ? "출발지 주소 (철거하는 곳)" : "방문 주소";
    var pl = $("#photoLine");
    if (pl) {
      var cur = F.id && S.all[F.id];
      if (cur) {
        var pc = C.photoCounts(cur);
        pl.innerHTML = '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="num">작업 전 ' + pc.before + "장 · 작업 후 " + pc.after + "장</span>" +
          '<button type="button" class="btn" data-photos data-testid="form-photos">사진 보기·추가</button></div>';
      } else pl.innerHTML = '<span class="muted">예약을 저장한 뒤 카드의 [사진 추가]로 올릴 수 있어요.</span>';
    }
    var end = C.endTime(d.time, d.durationMin);
    $("#endInfo").innerHTML = end ? "끝나는 시간 <b class=\"num\" data-testid=\"end-time\">" + esc(end) + "</b> (" + C.durationLabel(d.durationMin) + ")" : "";
    var warn = "";
    if (F.id && !S.all[F.id]) warn += '<div class="stale">다른 사람이 이 예약을 삭제했어요. 저장하면 새 예약으로 다시 만들어져요.</div>';
    else if (F.id && S.all[F.id] && (S.all[F.id].updatedAt || S.all[F.id].createdAt || "") !== F.openedAt) {
      var who = staffName(S.all[F.id].updatedBy);
      warn += '<div class="stale" data-testid="stale">' + esc(who ? who + "님이" : "다른 사람이") + " 방금 이 예약을 고쳤어요. 저장하면 내 입력으로 덮어써요.</div>";
    }
    $("#liveWarn").innerHTML = warn ? '<div style="display:grid;gap:8px;margin-bottom:10px">' + warn + "</div>" : "";
    var w = formWarnings(d);
    ["time", "addr", "dup", "total", "crew"].forEach(function (k) { var el = $("#w-" + k); if (el) el.innerHTML = w[k] || ""; });
    $("#custTitle").textContent = mv ? "고객 · 출발지 · 도착지" : "고객 · 방문 주소";
    $("#fsCust").classList.toggle("move-on", mv);
    renderDraftNote();
  }
  // 저장 전에 확인할 점(저장은 가능): 시간 겹침, 인원 부족, 다음날로 넘어가는 종료, 주소 누락, 금액 0원, 같은 고객·주소 중복
  function formWarnings(d) {
    var w = {}, id = F.id || "__new__";
    var cand = Object.assign({}, d, { id: id });
    var line = function (cls, text, tid) { return '<div class="' + cls + '"' + (tid ? ' data-testid="' + tid + '"' : "") + ">" + esc(text) + "</div>"; };
    var end = C.endTime(d.time, d.durationMin);
    if (/다음날/.test(end)) w.time = line("conflict", "끝나는 시간이 다음날(" + end.replace(" (다음날)", "") + ")이에요. 시작 시간과 소요시간을 확인하세요.");
    var cf = conflictsOf(cand)[id], crewN = Object.keys(d.workers || {}).filter(function (k) { return d.workers[k] === true && staffName(k); }).length;
    w.crew = (cf ? line("conflict", "시간 겹침: " + conflictText(cand, cf) + ". 그래도 저장할 수 있어요.", "form-conflict") : "") +
      (d.status === "scheduled" && crewN < (+d.needed || 2) ? line("conflict", "필요 인원 " + (+d.needed || 2) + "명 중 " + crewN + "명만 배정됐어요.", "crew-short") : "");
    var c = d.customer || {}, to = d.moveTo || {};
    if (C.isMove(d) && (!String(c.address || "").trim() || !String(to.address || "").trim())) w.addr = line("conflict", "이전설치는 출발지와 도착지 주소가 모두 필요해요.", "addr-missing");
    else if (!C.isMove(d) && !String(c.address || "").trim()) w.addr = line("conflict", "방문 주소가 비어 있어요.", "addr-missing");
    if (!C.parseWon(d.total)) w.total = line("conflict", "금액이 0원이에요. 정해지면 넣어 주세요.", "total-zero");
    var dup = dupOf(d, id);
    if (dup) w.dup = line("conflict", dup.text, "dup");
    return w;
  }
  // 같은 날 같은 전화번호(또는 같은 주소)로 이미 있는 예약
  function dupOf(d, id) {
    var digits = C.normalizePhone((d.customer || {}).phone), addr = String((d.customer || {}).address || "").trim();
    var same = list().filter(function (r) { return r.id !== id && r.date === d.date && r.status !== "canceled"; });
    var byPhone = digits.length >= 9 && same.filter(function (r) { return (r.phoneDigits || C.normalizePhone((r.customer || {}).phone)) === digits; })[0];
    if (byPhone) return { r: byPhone, text: "같은 고객(전화번호)이 이날 " + byPhone.time + "에 이미 예약돼 있어요. 중복이 아닌지 확인하세요." };
    var byAddr = addr && same.filter(function (r) { return String((r.customer || {}).address || "").trim() === addr; })[0];
    if (byAddr) return { r: byAddr, text: "같은 주소로 이날 " + byAddr.time + "에 이미 예약이 있어요. 중복이 아닌지 확인하세요." };
    return null;
  }

  // ---- 임시 저장: 입력하던 내용은 이 기기에 바로바로 저장, 다시 열면 불러오기 ----
  function draftKey(id) { return "draft." + (S.uid || "local") + "." + (id || "new"); }
  var draftTimer = null;
  function saveDraftSoon() {
    if (!F || F.readOnly) return;
    F.dirty = true;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(flushDraft, 300);
  }
  // 저장을 누르거나 창을 닫을 때는 기다리지 않고 바로 임시 저장
  function flushDraft() {
    clearTimeout(draftTimer);
    if (F && F.dirty && !F.readOnly) store(draftKey(F.id), JSON.stringify({ at: nowIso(), data: F.data }));
  }
  function dropDraft(id) { clearTimeout(draftTimer); try { localStorage.removeItem("wb." + draftKey(id)); } catch (e) { /* 무시 */ } }
  function loadDraft(id) { try { return JSON.parse(store(draftKey(id)) || "null"); } catch (e) { return null; } }
  function renderDraftNote() {
    var el = $("#draftNote");
    if (!el) return;
    el.innerHTML = F.draft ? '<div class="banner info draft" data-testid="draft-note"><span>저장하지 않은 입력이 있어요 (' + esc(fmtStamp(F.draft.at)) + ").</span>" +
      '<button type="button" class="btn primary" data-draft-load data-testid="draft-load">불러오기</button><button type="button" class="btn" data-draft-drop>버리기</button></div>' : "";
  }

  var histTimer = null;
  function lookupHistory() {
    clearTimeout(histTimer);
    histTimer = setTimeout(async function () {
      if (!F || !S.db) return;
      var digits = C.normalizePhone($("#f-phone") ? $("#f-phone").value : F.data.customer.phone);
      if (digits.length < 9) { F.hist = null; F.histFor = ""; renderHist(); return; }
      if (F.histFor === digits) return;
      F.histFor = digits;
      try {
        var snap = await S.db.collection("reservations").where("phoneDigits", "==", digits).get();
        if (!F || F.histFor !== digits) return;
        F.hist = C.sortReservations(snap.docs.map(function (d) { return Object.assign({}, d.data(), { id: d.id }); })
          .filter(function (r) { return r.id !== F.id; })).reverse();
        renderHist();
      } catch (e) { /* 이력은 보조 기능 */ }
    }, 350);
  }

  function renderHist() {
    var box = $("#hist");
    if (!box) return;
    if (!F.hist || !F.hist.length) { box.innerHTML = ""; return; }
    var h = F.hist;
    box.innerHTML = '<div class="hist" data-testid="history"><b>이전 작업 ' + h.length + "건이 있는 고객이에요</b><ul>" +
      h.slice(0, 3).map(function (r) {
        return "<li>" + esc(r.date) + " · " + esc(C.itemsSummary(r.items)) + " " + esc(C.worksSummary(r.items)) + " · " + C.formatWon(r.total) + "원</li>";
      }).join("") + '</ul><button type="button" class="btn" data-fill data-testid="fill-history">이름·주소·현장정보 불러오기</button></div>';
  }

  function bindForm() {
    var sh = $("#sheet");
    var form = $("#form");
    form.onsubmit = function (e) { e.preventDefault(); };
    sh.onclick = async function (e) {
      var t = e.target;
      if (t === sh || t.closest("[data-x]")) { closeForm(); return; }
      if (t.closest("[data-save]")) { readForm(); return save(); }
      if (t.closest("[data-del]")) { F.confirmDel = true; renderFoot(); return; }
      if (t.closest("[data-delno]")) { F.confirmDel = false; renderFoot(); return; }
      if (t.closest("[data-delyes]")) return del();
      if (t.closest("[data-photos]") && F.id) return openPhotos(F.id);
      if (t.closest("[data-draft-load]") && F.draft) {
        var dd = F.draft.data;
        F.data = Object.assign(F.data, dd, { customer: Object.assign({}, F.data.customer, dd.customer), site: Object.assign({}, F.data.site, dd.site),
          moveTo: Object.assign({}, F.data.moveTo, dd.moveTo), payment: Object.assign({}, F.data.payment, dd.payment), workers: Object.assign({}, dd.workers) });
        if (!Array.isArray(F.data.items) || !F.data.items.length) F.data.items = [{ type: "통돌이", model: "", qty: 1, work: "세척" }];
        F.draft = null; renderForm(); toast("작성하던 내용을 불러왔어요."); return;
      }
      if (t.closest("[data-draft-drop]")) { dropDraft(F.id); F.draft = null; renderDraftNote(); return; }
      if (t.closest("[data-addi]")) {
        readForm();
        var lastType = F.data.items.length ? F.data.items[F.data.items.length - 1].work : "세척";
        F.data.items.push({ type: "건조기", model: "", qty: 1, work: lastType });
        rerenderItems(); return;
      }
      var rm = t.closest("[data-rmi]");
      if (rm) { readForm(); F.data.items.splice(+rm.closest(".item").getAttribute("data-i"), 1); rerenderItems(); return; }
      var q = t.closest("[data-q]");
      if (q) {
        var inp = q.parentNode.querySelector("[data-k=qty]");
        inp.value = Math.max(1, (parseInt(inp.value, 10) || 1) + +q.getAttribute("data-q"));
        readForm(); saveDraftSoon(); return;
      }
      if (t.closest("[data-fill]") && F.hist && F.hist.length) {
        var last = F.hist[0];
        readForm();
        if (last.customer && last.customer.name) F.data.customer.name = last.customer.name;
        if (last.customer && last.customer.address) F.data.customer.address = last.customer.address;
        if (last.site) F.data.site = Object.assign({ floor: "", elevator: "", parking: "", memo: "" }, last.site);
        var keep = F.hist; renderForm(); F.hist = keep; renderHist();
        toast("이전 고객 정보를 불러왔어요.");
        return;
      }
      var w = t.closest("[data-w]");
      if (w) {
        var id = w.getAttribute("data-w");
        F.data.workers[id] = !(F.data.workers[id] === true);
        w.setAttribute("aria-pressed", String(F.data.workers[id]));
        refreshFormLive(); saveDraftSoon(); return;
      }
      var chip = t.closest("[data-f]");
      if (chip) {
        readForm();
        var k = chip.getAttribute("data-f"), v = chip.getAttribute("data-v");
        if (k === "dur") {
          // 직접 입력: 프리셋에 없는 값(기본 2시간 30분)으로 바꿔 입력칸을 띄움
          if (v === "custom") { if (DUR.indexOf(+F.data.durationMin) >= 0) F.data.durationMin = 150; }
          else F.data.durationMin = +v;
          var y = $(".sheet-b").scrollTop; renderForm(); $(".sheet-b").scrollTop = y;
          if (v === "custom") { var dm = $("#f-durmin"); if (dm) dm.focus(); }
          return;
        }
        if (k === "method") F.data.payment.method = v;
        else if (k === "needed") F.data.needed = +v;
        else if (k === "status") F.data.status = v;
        else if (k === "elevator" || k === "parking") F.data.site[k] = F.data.site[k] === v ? "" : v;
        else if (k === "elevator2") F.data.moveTo.elevator = F.data.moveTo.elevator === v ? "" : v;
        chip.parentNode.querySelectorAll("[data-f]").forEach(function (b) {
          var val = k === "elevator" || k === "parking" ? F.data.site[k] : k === "elevator2" ? F.data.moveTo.elevator : k === "method" ? F.data.payment.method : F.data[k];
          b.setAttribute("aria-pressed", String(String(val) === b.getAttribute("data-v")));
        });
        refreshFormLive();
        saveDraftSoon();
      }
    };
    form.addEventListener("input", function (e) {
      if (e.target.id === "f-note") growMemo();
      if (e.target.id === "f-total") {
        var n = C.parseWon(e.target.value);
        e.target.value = n ? C.formatWon(n) : "";
      }
      readForm();
      if (e.target.id === "f-phone") lookupHistory();
      F.dupOk = false;
      refreshFormLive();
      saveDraftSoon();
    });
    form.addEventListener("change", function () { readForm(); refreshFormLive(); saveDraftSoon(); });
    var ph = $("#f-phone");
    ph.addEventListener("blur", function () { ph.value = C.formatPhone(ph.value); });
  }

  function rerenderItems() {
    $("#items").innerHTML = F.data.items.map(itemHtml).join("");
    refreshFormLive();
  }

  var saving = false;
  async function save() {
    if (saving || F.readOnly) return;
    flushDraft();
    var d = F.data;
    var qtyMissing = (d.items || []).some(function (it) { return it && it.type && !(it.qty > 0); });
    d.items = C.cleanItems(d.items);
    F.errors = C.validateReservation(d);
    if (qtyMissing) F.errors.items = "기기 대수를 넣어 주세요.";
    if (Object.keys(F.errors).length) {
      var y = $(".sheet-b").scrollTop;
      renderForm();
      var firstErr = $(".sheet-b .err");
      if (firstErr) firstErr.scrollIntoView({ block: "center" }); else $(".sheet-b").scrollTop = y;
      toast("빨간 글씨 항목을 확인해 주세요.");
      return;
    }
    // 같은 날 같은 고객 예약이 있으면 한 번 더 확인
    if (!F.id && dupOf(d, "__new__") && !F.dupOk) {
      F.dupOk = true;
      refreshFormLive(); renderFoot();
      var dw = $("#w-dup"); if (dw) dw.scrollIntoView({ block: "center" });
      toast("같은 고객 예약이 이미 있어요. 중복이 아니면 [그래도 저장]을 누르세요.");
      return;
    }
    var cur = F.id ? S.all[F.id] : null;
    if (cur && (cur.updatedAt || cur.createdAt || "") !== F.openedAt && !F.staleOk) {
      F.staleOk = true;
      refreshFormLive();
      toast("다른 사람이 먼저 고쳤어요. 한 번 더 누르면 저장돼요.");
      return;
    }
    var me = S.myStaffId || "";
    var body = {
      date: d.date, time: d.time, durationMin: +d.durationMin, status: d.status,
      customer: { name: d.customer.name, phone: d.customer.phone, address: d.customer.address },
      phoneDigits: C.normalizePhone(d.customer.phone),
      site: { floor: d.site.floor, elevator: d.site.elevator, parking: d.site.parking, memo: d.site.memo },
      moveTo: { address: d.moveTo.address, floor: d.moveTo.floor, elevator: d.moveTo.elevator },
      items: d.items, total: C.parseWon(d.total),
      payment: { method: d.payment.method, paid: !!d.payment.paid },
      needed: +d.needed || 2, note: d.note,
      updatedBy: me, updatedAt: nowIso()
    };
    saving = true;
    var form = F;
    form.saveErr = null;
    renderFoot();
    try {
      if (F.id && cur) {
        // 참여 직원은 바뀐 사람만 병합 → 다른 직원이 동시에 누른 참여가 지워지지 않음
        var changed = {}, any = false, before = (F.orig && F.orig.workers) || {};
        Object.keys(Object.assign({}, before, d.workers)).forEach(function (k) {
          if ((before[k] === true) !== (d.workers[k] === true)) { changed[k] = d.workers[k] === true; any = true; }
        });
        if (any) body.workers = changed;
        if (F.orig && F.orig.status !== d.status) logPatch(body, d.status);
        if (F.orig && !!(F.orig.payment || {}).paid !== !!d.payment.paid && body.log) body.log[Date.now().toString(36) + "_p_" + me] = { s: d.payment.paid ? "paid" : "unpaid", by: me, at: nowIso() };
        else if (F.orig && !!(F.orig.payment || {}).paid !== !!d.payment.paid) logPatch(body, d.payment.paid ? "paid" : "unpaid");
        await S.db.doc("reservations/" + F.id).update(body);
        dropDraft(F.id);
        toast("저장 완료 · 수정했어요.");
      } else {
        var w = {};
        Object.keys(d.workers).forEach(function (k) { if (d.workers[k] === true && staffName(k)) w[k] = true; });
        body.workers = w;
        body.createdBy = me;
        if (F.requestedAt) { body.log = {}; body.log["req_" + Date.now().toString(36)] = { s: "request", by: "", at: F.requestedAt }; }
        body.createdAt = body.updatedAt;
        var ref = S.db.doc("reservations/" + (F.id || F.newId));
        await ref.set(body);
        dropDraft(F.id);
        if (F.fromRequest && S.bookings) S.bookings.accept(F.fromRequest, ref.id).catch(function () { /* 요청 목록에 남으면 다시 처리 */ });
        if (C.ymOf(d.date) !== S.ym) setMonth(C.ymOf(d.date));
        toast("저장 완료 · " + C.dayLabel(d.date) + " " + d.time + " 예약");
      }
      closeForm(true);
    } catch (e) {
      // 실패해도 입력은 그대로 두고, 이 기기에 임시 저장
      form.saveErr = navigator.onLine === false ? "인터넷 연결이 끊겼어요." : writeError(e);
      store(draftKey(form.id), JSON.stringify({ at: nowIso(), data: form.data }));
      toast("저장 실패 · " + form.saveErr);
    } finally { saving = false; if (F === form) renderFoot(); }
  }

  async function del() {
    var photos = C.photoList(S.all[F.id] || F.orig || {});
    try {
      await S.db.doc("reservations/" + F.id).delete();
      closeForm();
      toast("예약을 삭제했어요.");
    } catch (e) { toast(writeError(e)); return; }
    // 예약에 딸린 사진도 정리(다른 직원이 올린 사진은 권한상 남을 수 있음)
    if (S.assets) for (var i = 0; i < photos.length; i++) { try { await S.assets.delete(photos[i].id); } catch (e) { /* 무시 */ } }
  }

  // ---------------- 작업 사진 ----------------
  var KIND = { before: "작업 전", after: "작업 후" };
  // 사진 주소: 웹앱은 비공개 보관함의 서명된 주소(받아 오는 동안은 빈 칸), 가짜 런타임은 /_blob/<id>
  function blobAttr(id) {
    if (!(S.assets && S.assets.src)) return ' src="/_blob/' + esc(id) + '"';
    var u = S.assets.src(id);
    return (u ? ' src="' + esc(u) + '"' : "") + ' data-blob="' + esc(id) + '"';
  }
  function fillBlobs(root) {
    if (!(S.assets && S.assets.prefetch)) return;
    var imgs = Array.prototype.slice.call(root.querySelectorAll("img[data-blob]:not([src])"));
    if (!imgs.length) return;
    S.assets.prefetch(imgs.map(function (i) { return i.getAttribute("data-blob"); })).then(function (urls) {
      imgs.forEach(function (i) {
        var u = urls[i.getAttribute("data-blob")];
        if (u) i.src = u; else { i.classList.add("broken"); if (i.parentNode) i.parentNode.title = "사진을 불러올 수 없어요"; }
      });
    }).catch(function () { /* 다음 화면 갱신 때 다시 */ });
  }
  var GONE = {}; // 방금 지운 사진(기록이 갱신되기 전에도 바로 숨김)
  function livePhotos(r, kind) { return C.photoList(r, kind).filter(function (p) { return !GONE[p.id]; }); }
  function openPhotos(id) {
    if (!S.all[id]) return;
    P = { id: id, view: null, confirmDel: false };
    renderPhotos();
  }

  function renderPhotos() {
    if (!P) return;
    var r = S.all[P.id];
    var m = $("#modal");
    if (!r) { closeModal(); toast("예약이 삭제되어 사진 창을 닫았어요."); return; }
    var canUp = !!(S.assets && canWrite());
    var all = livePhotos(r);
    var html;
    if (P.view) {
      var i = all.map(function (p) { return p.id; }).indexOf(P.view);
      if (i < 0) { P.view = null; return renderPhotos(); }
      var ph = all[i], same = livePhotos(r, ph.kind), k = same.map(function (p) { return p.id; }).indexOf(ph.id);
      html = '<div class="pv-top"><button class="btn" data-pback>목록으로</button><b>' + KIND[ph.kind] + " " + (k + 1) + "/" + same.length + "</b></div>" +
        '<div class="pv-img"><img' + blobAttr(ph.id) + ' alt="' + KIND[ph.kind] + ' 사진" data-testid="photo-big"></div>' +
        '<p class="muted pv-meta">' + esc(staffName(ph.by) || "") + " " + esc(fmtStamp(ph.at)) + "에 올림</p>" +
        '<div class="pv-nav"><button class="btn" data-pstep="-1"' + (i > 0 ? "" : " disabled") + '>이전</button><button class="btn" data-pstep="1"' + (i < all.length - 1 ? "" : " disabled") + ">다음</button>" +
        (canUp ? (P.confirmDel ? '<span class="pv-del"><button class="btn" data-pdelno>아니요</button><button class="btn danger solid" data-pdelyes data-testid="photo-del-yes">삭제</button></span>'
          : '<button class="btn danger" data-pdel data-testid="photo-del">삭제</button>') : "") + "</div>";
    } else {
      html = "<h2>" + esc((r.customer || {}).name || "고객") + " 작업 사진</h2>";
      var up = UP[P.id];
      if (up && up.total) html += '<div class="banner info" data-testid="photo-busy">사진 ' + up.total + "장 중 " + up.done + "장 올렸어요. 창을 닫아도 계속 올라가요.</div>";
      ["before", "after"].forEach(function (kind) {
        var list = livePhotos(r, kind);
        html += '<div class="ph-sec"><div class="ph-h">' + KIND[kind] + ' <span class="num muted">' + list.length + "장</span></div>" +
          '<div class="ph-grid" data-testid="grid-' + kind + '">' + list.map(function (p, n) {
            return '<button class="ph" data-pv="' + esc(p.id) + '"><img' + blobAttr(p.id) + ' alt="' + KIND[kind] + " 사진 " + (n + 1) + '" loading="lazy"></button>';
          }).join("") +
          // 고르자마자 미리보기, 올라가는 동안 표시
          ((up && up.items) || []).filter(function (u) { return u.kind === kind; }).map(function (u) {
            return '<div class="ph pending' + (u.failed ? " failed" : "") + '" data-testid="pending"><img src="' + esc(u.url) + '" alt=""><span>' + (u.failed ? "실패" : "올리는 중") + "</span></div>";
          }).join("") +
          (canUp ? '<label class="ph add" data-testid="add-' + kind + '"><input type="file" accept="image/*" multiple class="vh" data-kind="' + kind + '" data-testid="file-' + kind + '">' +
              ICON.gallery + "<span>앨범에서<br>여러 장</span></label>" +
            '<label class="ph add" data-testid="cam-' + kind + '"><input type="file" accept="image/*" capture="environment" class="vh" data-kind="' + kind + '">' +
              ICON.camera + "<span>카메라로<br>찍기</span></label>" : "") + "</div></div>";
      });
      if (!canUp && S.conn === "ok") html += '<p class="muted" style="font-size:13px">사진을 올리려면 장부 주인에게 편집자로 초대받아야 해요.</p>';
      html += '<button class="btn wide" data-pclose>닫기</button>';
    }
    var scroll = m.firstChild ? m.firstChild.scrollTop : 0;
    openModal(html, onPhotoClick);
    m.firstChild.classList.add("photo-modal");
    if (!P.view) m.firstChild.scrollTop = scroll;
    fillBlobs(m);
    m.onchange = function (e) {
      var inp = e.target;
      if (inp && inp.matches("input[type=file][data-kind]") && inp.files && inp.files.length) uploadPhotos(Array.prototype.slice.call(inp.files), inp.getAttribute("data-kind"));
    };
  }

  function onPhotoClick(e) {
    var t = e.target;
    if (t.closest("[data-pclose]")) { closeModal(); return; }
    var v = t.closest("[data-pv]");
    if (v) { P.view = v.getAttribute("data-pv"); P.confirmDel = false; pushLayer(); renderPhotos(); return; }
    if (t.closest("[data-pback]")) { P.view = null; P.confirmDel = false; renderPhotos(); return; }
    var st = t.closest("[data-pstep]");
    if (st && !st.disabled) {
      var all = livePhotos(S.all[P.id]).map(function (p) { return p.id; });
      var i = all.indexOf(P.view) + +st.getAttribute("data-pstep");
      if (all[i]) { P.view = all[i]; P.confirmDel = false; renderPhotos(); }
      return;
    }
    if (t.closest("[data-pdel]")) { P.confirmDel = true; renderPhotos(); return; }
    if (t.closest("[data-pdelno]")) { P.confirmDel = false; renderPhotos(); return; }
    if (t.closest("[data-pdelyes]")) { deletePhoto(P.id, P.view); return; }
  }

  // 긴 변 1600px JPEG로 줄여 데이터·저장 공간을 아낌
  function loadImage(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: "from-image" }).catch(function () { return createImageBitmap(file); });
    }
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); res(img); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error("decode")); };
      img.src = url;
    });
  }
  async function compressImage(file) {
    var MAX = 1280; // 휴대폰 화면에서 충분히 선명하고 올리는 시간은 짧게
    try {
      var img = await loadImage(file);
      var w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight;
      var sc = Math.min(1, MAX / Math.max(w0, h0));
      var w = Math.max(1, Math.round(w0 * sc)), h = Math.max(1, Math.round(h0 * sc));
      var cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      var cx = cv.getContext("2d");
      cx.fillStyle = "#ffffff"; cx.fillRect(0, 0, w, h);
      cx.drawImage(img, 0, 0, w, h);
      if (img.close) img.close();
      var blob = await new Promise(function (res) { cv.toBlob(res, "image/jpeg", 0.82); });
      if (blob && blob.size) return blob;
    } catch (e) { /* 원본 시도 */ }
    if (/^image\/(jpeg|png|webp)$/.test(file.type) && file.size <= 20 * 1024 * 1024) return file;
    throw { code: "unsupported_type" };
  }

  function photoError(e) {
    var code = e && e.code;
    if (code === "unsupported_type") return "이 사진 형식은 올릴 수 없어요. 일반 사진(JPG)으로 다시 골라 주세요.";
    if (code === "too_large") return "사진이 너무 커요. 다른 사진을 골라 주세요.";
    if (code === "quota_or_state") return "사진 저장 공간이 가득 찼어요. 오래된 사진을 지워 주세요.";
    if (code === "rate_limited") return "잠시 뒤 다시 올려 주세요.";
    if (code === "not_granted" || code === "capability_disabled" || code === "capability_removed") return "이 화면에서는 사진을 올릴 수 없어요.";
    if (code === "invalid_argument") return writeError(e);
    return "사진을 올리지 못했어요. 인터넷 연결을 확인하고 다시 올려 주세요.";
  }

  // 예약별 업로드 진행 상태: {total, done, items:[{kind, url, failed}]}
  var UP = {};
  var writeChain = {};
  var UPLOAD_AT_ONCE = 8;

  // 너무 많이 동시에 보내 '잠시 뒤 다시'가 오면 조금 기다렸다 다시(최대 3번)
  async function uploadWithRetry(blob) {
    for (var tryNo = 0; ; tryNo++) {
      try { return await S.assets.upload(blob, { type: blob.type || "image/jpeg" }); }
      catch (e) {
        var again = e && (e.code === "rate_limited" || e.code === "store_unavailable");
        if (!again || tryNo >= 3) throw e;
        await new Promise(function (r) { setTimeout(r, 800 * (tryNo + 1) + Math.random() * 400); });
      }
    }
  }

  // 같은 예약 문서에는 한 번에 하나씩 기록(동시에 쓰면 느려짐)
  function recordPhoto(rid, assetId, kind, at) {
    var patch = { photos: {} };
    patch.photos[assetId] = { kind: kind, by: S.myStaffId || "", at: at };
    var run = function () { return S.db.doc("reservations/" + rid).update(patch); };
    writeChain[rid] = (writeChain[rid] || Promise.resolve()).then(run, run);
    return writeChain[rid];
  }

  function refreshUploadView(rid) { if (P && P.id === rid && !P.view) renderPhotos(); }

  async function uploadPhotos(files, kind) {
    if (!P || !S.assets) return;
    var rid = P.id, ok = 0, err = null;
    var up = UP[rid] = UP[rid] || { total: 0, done: 0, items: [] };
    var jobs = files.map(function (f, i) {
      var item = { kind: kind, url: URL.createObjectURL(f), failed: false };
      up.items.push(item);
      // 같은 순간 고른 사진도 고른 순서대로 정렬되게 시각을 조금씩 다르게
      return { file: f, item: item, at: new Date(Date.now() + i).toISOString() };
    });
    up.total += jobs.length;
    refreshUploadView(rid);
    var next = 0;
    async function worker() {
      while (next < jobs.length) {
        var job = jobs[next++];
        try {
          var blob = await compressImage(job.file);
          var res = await uploadWithRetry(blob);
          await recordPhoto(rid, res.id, kind, job.at);
          ok++;
          up.items.splice(up.items.indexOf(job.item), 1);
          (function (u) { setTimeout(function () { URL.revokeObjectURL(u); }, 3000); })(job.item.url);
        } catch (e) { err = e; job.item.failed = true; }
        up.done++;
        refreshUploadView(rid);
      }
    }
    var pool = [];
    for (var w = 0; w < Math.min(UPLOAD_AT_ONCE, jobs.length); w++) pool.push(worker());
    await Promise.all(pool);
    // 실패한 미리보기는 잠깐 보여 준 뒤 정리
    if (up.done >= up.total) {
      var failed = up.items.slice();
      setTimeout(function () { failed.forEach(function (it) { URL.revokeObjectURL(it.url); }); }, 4000);
      delete UP[rid];
      refreshUploadView(rid);
    }
    if (err) toast((ok ? ok + "장은 올렸어요. " : "") + photoError(err));
    else toast(KIND[kind] + " 사진 " + ok + "장을 올렸어요.");
  }

  async function deletePhoto(rid, pid) {
    try {
      await S.assets.delete(pid);
    } catch (e) {
      P.confirmDel = false; renderPhotos();
      toast(e && e.code === "not_uploader" ? "다른 직원이 올린 사진은 올린 사람이나 사장님만 지울 수 있어요." : "사진을 지우지 못했어요. 다시 눌러 주세요.");
      return;
    }
    GONE[pid] = true;
    var patch = { photos: {} };
    patch.photos[pid] = null;
    try { await S.db.doc("reservations/" + rid).update(patch); } catch (e) { /* 파일은 지워짐, 목록은 다음 수정 때 정리 */ }
    if (P) { P.view = null; P.confirmDel = false; renderPhotos(); }
    toast("사진을 지웠어요.");
  }

  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

  boot();
})();
