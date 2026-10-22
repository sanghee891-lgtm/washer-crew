/* Supabase 연결: 예전 claude.use("db" | "user" | "downloads" | "assets") 와 같은 모양으로 만들어 app.js 를 그대로 씁니다.
   추가: "push"(휴대폰 알림), "bookings"(고객 예약 요청).
   로그인(이름 고르기 + 숫자 6자리)이 끝나야 use() 가 값을 돌려줍니다. 테스트의 가짜 런타임이 먼저 있으면 아무것도 하지 않습니다. */
(function () {
  "use strict";
  if (window.claude || !window.supabase || !window.WC_CONFIG) return;
  var CFG = window.WC_CONFIG;
  var sb = window.supabase.createClient(CFG.url, CFG.key, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "wc.auth" }
  });
  var ACC = null; // { uid, staffId, isOwner }
  var readyResolve;
  var ready = new Promise(function (r) { readyResolve = r; });

  function $(sel, el) { return (el || document).querySelector(sel); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function local(k, v) {
    try { if (v === undefined) return JSON.parse(localStorage.getItem("wc." + k) || "null"); localStorage.setItem("wc." + k, JSON.stringify(v)); } catch (e) { return null; }
  }
  function err(code, e) { return { code: code, message: (e && e.message) || code }; }
  function mapErr(e) {
    if (!e) return err("unknown");
    if (e.code === "P0002" || e.code === "42501" || /row-level security|permission denied/i.test(e.message || "")) return err("invalid_argument", e);
    return err("unavailable", e);
  }
  function emailOf(staffId) { return String(staffId).toLowerCase() + "@" + (CFG.emailDomain || "washer-crew.local"); }

  // ---------------- 로그인 ----------------
  async function loadAccount(session) {
    var uid = session.user.id;
    var r = await sb.from("staff_accounts").select("staff_id, is_owner").eq("uid", uid).maybeSingle();
    if (r.error) {
      // 인터넷이 잠깐 끊겨도 이 기기에 기억해 둔 계정으로 열기
      var c = local("account");
      return c && c.uid === uid ? c : null;
    }
    if (!r.data) return null;
    var acc = { uid: uid, staffId: r.data.staff_id, isOwner: !!r.data.is_owner };
    local("account", acc);
    return acc;
  }

  async function start() {
    var s = (await sb.auth.getSession()).data.session;
    if (s) {
      var acc = await loadAccount(s);
      if (acc) { ACC = acc; afterLogin(); return; }
      await sb.auth.signOut().catch(function () {});
    }
    showLogin();
  }

  function afterLogin() {
    var box = $("#login");
    if (box) box.remove();
    document.documentElement.classList.remove("need-login");
    readyResolve();
    resaveSubscription();
  }

  var LOGIN = { names: null, pick: null, pin: "", busy: false, msg: "" };
  var DEFAULT_PIN = "000000";
  async function showLogin() {
    document.documentElement.classList.add("need-login");
    var box = $("#login");
    if (!box) {
      box = document.createElement("div");
      box.id = "login";
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-label", "로그인");
      document.body.appendChild(box);
      box.addEventListener("click", onLoginClick);
      document.addEventListener("keydown", onLoginKey);
    }
    renderLogin();
    if (!LOGIN.names) {
      var r = await sb.rpc("login_staff");
      if (r.error) { LOGIN.msg = "인터넷 연결을 확인해 주세요."; LOGIN.names = []; }
      else LOGIN.names = r.data || [];
      renderLogin();
    }
  }

  function renderLogin() {
    var box = $("#login");
    if (!box) return;
    var html = '<div class="login-in"><img class="login-logo" src="assets/logo.webp" alt="세탁기 크루">';
    if (!LOGIN.pick) {
      html += "<h1>접속할 사용자를 선택해주세요</h1><p>선택한 사용자로 업무를 시작합니다.</p>";
      if (!LOGIN.names) html += '<p class="muted">불러오는 중…</p>';
      else if (!LOGIN.names.length) html += '<p class="login-err">' + esc(LOGIN.msg || "등록된 직원이 없어요. 사장님께 문의해 주세요.") + '</p><button class="btn wide" data-retry>다시 시도</button>';
      else html += '<div class="login-names">' + LOGIN.names.map(function (p) {
        return '<button class="btn" data-name="' + esc(p.id) + '" data-testid="login-' + esc(p.name) + '">' + esc(p.name) + "</button>";
      }).join("") + "</div>";
    } else {
      var who = (LOGIN.names || []).filter(function (p) { return p.id === LOGIN.pick; })[0] || {};
      html += "<h1>" + esc(who.name) + "님</h1><p>비밀번호 숫자 6자리를 누르세요.</p>" +
        '<div class="pin-dots" aria-label="입력한 자리 수 ' + LOGIN.pin.length + '">' +
        [0, 1, 2, 3, 4, 5].map(function (i) { return '<i class="' + (i < LOGIN.pin.length ? "on" : "") + '"></i>'; }).join("") + "</div>" +
        '<p class="login-err" data-testid="login-err">' + esc(LOGIN.msg) + "</p>" +
        '<div class="pin-pad">' + [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (n) { return '<button class="btn" data-key="' + n + '">' + n + "</button>"; }).join("") +
        '<button class="btn" data-back>다른 이름</button><button class="btn" data-key="0">0</button><button class="btn" data-del aria-label="한 자리 지우기">지우기</button></div>' +
        (LOGIN.busy ? '<p class="muted">확인 중…</p>' : "");
    }
    box.innerHTML = html + "</div>";
  }

  function onLoginKey(e) {
    if (!LOGIN.pick || !$("#login")) return;
    if (/^[0-9]$/.test(e.key)) typeKey(e.key);
    else if (e.key === "Backspace") { LOGIN.pin = LOGIN.pin.slice(0, -1); renderLogin(); }
  }
  function onLoginClick(e) {
    var t = e.target;
    var n = t.closest("[data-name]");
    if (n) { LOGIN.pick = n.getAttribute("data-name"); LOGIN.pin = ""; LOGIN.msg = ""; renderLogin(); return; }
    if (t.closest("[data-retry]")) { LOGIN.names = null; LOGIN.msg = ""; showLogin(); return; }
    if (t.closest("[data-back]")) { LOGIN.pick = null; LOGIN.pin = ""; LOGIN.msg = ""; renderLogin(); return; }
    if (t.closest("[data-del]")) { LOGIN.pin = LOGIN.pin.slice(0, -1); renderLogin(); return; }
    var k = t.closest("[data-key]");
    if (k) typeKey(k.getAttribute("data-key"));
  }
  async function typeKey(d) {
    if (LOGIN.busy || LOGIN.pin.length >= 6) return;
    LOGIN.pin += d; LOGIN.msg = "";
    renderLogin();
    if (LOGIN.pin.length < 6) return;
    LOGIN.busy = true; renderLogin();
    var r = await sb.auth.signInWithPassword({ email: emailOf(LOGIN.pick), password: LOGIN.pin });
    var acc = !r.error && r.data.session ? await loadAccount(r.data.session) : null;
    LOGIN.busy = false;
    if (acc) {
      // 처음 번호(000000)로 들어온 직원은 장부에서 비밀번호 바꾸기 안내(사장님 제외)
      if (LOGIN.pin === DEFAULT_PIN && !acc.isOwner) local("defaultPin", acc.uid);
      ACC = acc; afterLogin(); return;
    }
    LOGIN.pin = "";
    LOGIN.msg = r.error && /invalid/i.test(r.error.message || "") ? "비밀번호가 맞지 않아요. 다시 눌러 주세요."
      : r.error && r.error.status === 429 ? "너무 여러 번 틀렸어요. 잠시 뒤 다시 해 주세요."
      : "로그인하지 못했어요. 인터넷 연결을 확인해 주세요.";
    renderLogin();
  }

  // ---------------- db: 문서형 저장소 ----------------
  function segs(p) { return String(p).split("/").filter(Boolean); }
  function freeze(o) {
    if (o && typeof o === "object") { Object.freeze(o); Object.keys(o).forEach(function (k) { freeze(o[k]); }); }
    return o;
  }
  function snapOf(path, data) {
    var body = data == null ? undefined : freeze(JSON.parse(JSON.stringify(data)));
    return { id: path.split("/").pop(), exists: body !== undefined, data: function () { return body; }, metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function newId() {
    var a = "abcdefghijklmnopqrstuvwxyz0123456789", out = "";
    var b = crypto.getRandomValues(new Uint8Array(20));
    for (var i = 0; i < 20; i++) out += a[b[i] % 36];
    return out;
  }

  // 실시간: docs 표의 변경을 하나의 채널로 받아, 해당 경로를 보고 있는 화면만 다시 불러옴
  var LISTENERS = new Set();
  function touch(path) { LISTENERS.forEach(function (l) { if (!path || l.match(path)) l.schedule(); }); }
  function refreshAll() { touch(null); BOOK.schedule(); }
  var channel = null;
  function ensureChannel() {
    if (channel) return;
    channel = sb.channel("wc-docs")
      .on("postgres_changes", { event: "*", schema: "public", table: "docs" }, function (p) {
        touch((p.new && p.new.path) || (p.old && p.old.path) || null);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "booking_requests" }, function () { BOOK.schedule(); })
      .subscribe(function (status) { if (status === "SUBSCRIBED") refreshAll(); });
  }
  // 휴대폰을 껐다 켜거나 인터넷이 다시 연결되면 최신으로
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && ACC) refreshAll(); });
  window.addEventListener("online", function () { if (ACC) refreshAll(); });
  setInterval(function () { if (ACC && document.visibilityState === "visible") refreshAll(); }, 90000);

  function listen(match, fetcher, next, onErr) {
    var last = "\u0000", seq = 0, timer = null, failedOnce = false, alive = true;
    var l = {
      match: match,
      schedule: function () { clearTimeout(timer); timer = setTimeout(run, 60); }
    };
    async function run() {
      if (!alive) return;
      var my = ++seq;
      try {
        var res = await fetcher();
        if (!alive || my !== seq) return;
        var s = JSON.stringify(res.key);
        if (s === last) return;
        last = s;
        next(res.snap);
      } catch (e) {
        if (!alive) return;
        if (!failedOnce && onErr) { failedOnce = true; onErr(mapErr(e)); }
        clearTimeout(timer); timer = setTimeout(run, 5000);
      }
    }
    LISTENERS.add(l);
    ensureChannel();
    setTimeout(run, 0);
    return function () { alive = false; clearTimeout(timer); LISTENERS.delete(l); };
  }

  async function fetchDoc(path) {
    var r = await sb.from("docs").select("data").eq("path", path).maybeSingle();
    if (r.error) throw r.error;
    return r.data ? r.data.data : undefined;
  }

  function docRef(path) {
    if (segs(path).length % 2) throw new TypeError("doc path needs even segments: " + path);
    return {
      id: segs(path).pop(), path: path,
      get: async function () { return snapOf(path, await fetchDoc(path)); },
      set: async function (data) {
        var r = await sb.from("docs").upsert({ path: path, data: JSON.parse(JSON.stringify(data)), updated_at: new Date().toISOString() });
        if (r.error) throw mapErr(r.error);
        touch(path);
      },
      update: async function (data) {
        var r = await sb.rpc("docs_merge", { p_path: path, p_patch: JSON.parse(JSON.stringify(data)) });
        if (r.error) throw mapErr(r.error);
        touch(path);
      },
      delete: async function () {
        var r = await sb.from("docs").delete().eq("path", path).select("path");
        if (r.error) throw mapErr(r.error);
        // 권한이 없어 안 지워졌으면(남은 문서가 있으면) 알림
        if (!r.data.length && (await fetchDoc(path)) !== undefined) throw err("invalid_argument");
        touch(path);
      },
      onSnapshot: function (next, onErr) {
        return listen(function (p) { return p === path; }, async function () {
          var d = await fetchDoc(path);
          return { key: d === undefined ? null : d, snap: snapOf(path, d) };
        }, next, onErr);
      },
      collection: function (sub) { return colRef(path + "/" + sub); }
    };
  }

  var SERVER_OPS = { "==": "eq", "<": "lt", "<=": "lte", ">": "gt", ">=": "gte" };
  function query(col, filters, order, lim) {
    async function rows() {
      var out = [], from = 0, PAGE = 1000;
      for (;;) {
        var q = sb.from("docs").select("path, data").eq("coll", col);
        // 문자열 비교는 서버에서 먼저 걸러 주고, 결과는 아래에서 한 번 더 정확히 거름
        filters.forEach(function (f) {
          if (SERVER_OPS[f[1]] && typeof f[2] === "string") q = q[SERVER_OPS[f[1]]]("data->>" + f[0], f[2]);
        });
        var r = await q.order("path").range(from, from + PAGE - 1);
        if (r.error) throw r.error;
        out = out.concat(r.data);
        if (r.data.length < PAGE) return out;
        from += PAGE;
      }
    }
    async function run() {
      var out = (await rows()).filter(function (row) {
        var d = row.data;
        return filters.every(function (f) {
          var v = d[f[0]], x = f[2];
          switch (f[1]) {
            case "==": return v === x; case "!=": return v !== x;
            case "<": return v < x; case "<=": return v <= x; case ">": return v > x; case ">=": return v >= x;
            case "in": return x.indexOf(v) >= 0; case "not-in": return x.indexOf(v) < 0;
            case "array-contains": return Array.isArray(v) && v.indexOf(x) >= 0;
          }
          return false;
        });
      }).map(function (row) { return [row.path, row.data]; });
      out.sort(function (a, b) {
        if (order) { var x = a[1][order[0]], y = b[1][order[0]]; if (x !== y) return (x < y ? -1 : 1) * (order[1] === "desc" ? -1 : 1); }
        return a[0] < b[0] ? -1 : 1;
      });
      if (lim) out = out.slice(0, lim);
      var docs = out.map(function (e) { return snapOf(e[0], e[1]); });
      return {
        key: out,
        snap: { docs: docs, size: docs.length, empty: !docs.length, docChanges: function () { return []; }, metadata: { fromCache: false, hasPendingWrites: false } }
      };
    }
    var n = segs(col).length;
    return {
      where: function (f, op, v) { return query(col, filters.concat([[f, op, v]]), order, lim); },
      orderBy: function (f, dir) { return query(col, filters, [f, dir || "asc"], lim); },
      limit: function (k) { return query(col, filters, order, k); },
      get: async function () { try { return (await run()).snap; } catch (e) { throw mapErr(e); } },
      onSnapshot: function (next, onErr) {
        return listen(function (p) { var s = segs(p); return s.length === n + 1 && p.indexOf(col + "/") === 0; }, run, next, onErr);
      }
    };
  }

  function colRef(path) {
    if (segs(path).length % 2 === 0) throw new TypeError("collection path needs odd segments: " + path);
    var q = query(path, [], null, 0);
    q.path = path;
    q.doc = function (id) { return docRef(path + "/" + (id || newId())); };
    q.add = async function (data) { var r = q.doc(); await r.set(data); return r; };
    return q;
  }
  var db = { doc: docRef, collection: colRef };

  // ---------------- user: 로그인한 직원 ----------------
  var user = {
    id: async function () { return ACC && ACC.uid; },
    staffId: async function () { return ACC && ACC.staffId; },
    isOwner: async function () { return !!(ACC && ACC.isOwner); },
    canEdit: async function () { return true; },
    can: async function (n) { return n === "data.write"; },
    me: async function () { return { id: ACC && ACC.uid, name: "", email: null, isOwner: !!(ACC && ACC.isOwner), canEdit: true, avatarUrl: "", color: "#888" }; },
    profiles: async function (ids) { var o = {}; [].concat(ids).forEach(function (i) { o[i] = { id: i, name: "", avatarUrl: "", color: "#888", email: null, isMe: ACC && i === ACC.uid, guest: false }; }); return o; },
    signOut: async function () {
      await disablePushQuietly();
      await sb.auth.signOut().catch(function () {});
      try { localStorage.removeItem("wc.account"); localStorage.removeItem("wc.defaultPin"); } catch (e) { /* 무시 */ }
      location.replace(location.pathname);
    },
    changePin: async function (pin) {
      if (!/^\d{6}$/.test(pin)) throw err("bad_pin");
      if (pin === DEFAULT_PIN) throw err("default_pin");
      var r = await sb.auth.updateUser({ password: pin });
      if (r.error) throw err(/different|same/i.test(r.error.message || "") ? "same_pin" : "unavailable", r.error);
      try { localStorage.removeItem("wc.defaultPin"); } catch (e) { /* 무시 */ }
    },
    // 처음 번호 그대로 쓰는 중인지(이 기기에서 000000으로 로그인했고 아직 안 바꿈)
    needsPinChange: async function () { return !!(ACC && !ACC.isOwner && local("defaultPin") === ACC.uid); },
    // 사장님: 직원 계정 목록과 비밀번호 정하기
    accounts: async function () {
      var r = await sb.from("staff_accounts").select("staff_id, is_owner");
      if (r.error) throw mapErr(r.error);
      var o = {};
      r.data.forEach(function (a) { o[a.staff_id] = { isOwner: a.is_owner }; });
      return o;
    },
    setPin: async function (staffId, pin) { return adminCall({ action: "set_pin", staffId: staffId, pin: pin }); },
    removeAccount: async function (staffId) { return adminCall({ action: "remove", staffId: staffId }); }
  };
  async function adminCall(body) {
    var r = await sb.functions.invoke("staff-admin", { body: body });
    if (r.error) {
      var detail = null;
      try { detail = await r.error.context.json(); } catch (e) { /* 무시 */ }
      throw err((detail && detail.error) || "unavailable", r.error);
    }
    return r.data;
  }

  // ---------------- downloads: 파일 받기 ----------------
  // 한글 파일 이름은 일부 브라우저가 "download"로 바꿔 버려서 영문으로 저장(예: washer-crew_2026-10.csv)
  function asciiName(name) {
    var n = String(name).replace(/^예약내역_/, "washer-crew_").replace(/년/g, "").replace(/[^\x20-\x7e]/g, "");
    return /^[^.]+\.\w+$/.test(n) ? n : "washer-crew" + (String(name).match(/\.\w+$/) || [""])[0];
  }
  var downloads = {
    save: async function (req) {
      var blob = new Blob([req.data], { type: /\.csv$/i.test(req.filename) ? "text/csv;charset=utf-8" : "application/octet-stream" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = asciiName(req.filename); a.style.display = "none";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
      return { status: "saved" };
    }
  };

  // ---------------- assets: 작업 사진(비공개 보관함) ----------------
  var BUCKET = "photos";
  var URLS = local("photoUrls") || {}; // id → {u, e} 서명된 주소와 만료 시각(같은 주소를 다시 써서 휴대폰 캐시를 살림)
  (function prune() { var now = Date.now(); Object.keys(URLS).forEach(function (k) { if (!URLS[k] || URLS[k].e < now) delete URLS[k]; }); })();
  var saveUrls = (function () { var t; return function () { clearTimeout(t); t = setTimeout(function () { local("photoUrls", URLS); }, 300); }; })();
  var inflight = {};
  function hexId() { return Array.from(crypto.getRandomValues(new Uint8Array(16))).map(function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
  var assets = {
    upload: async function (blob, opt) {
      if (!(blob instanceof Blob) || !blob.size) throw err("invalid_request");
      var type = (opt && opt.type) || blob.type;
      if (!/^image\/(jpeg|png|webp)$/.test(type)) throw err("unsupported_type");
      var id = hexId();
      var r = await sb.storage.from(BUCKET).upload(id, blob, { contentType: type, cacheControl: "31536000", upsert: false });
      if (r.error) {
        var st = +(r.error.statusCode || r.error.status || 0);
        throw err(st === 413 ? "too_large" : st === 429 ? "rate_limited" : st === 403 ? "invalid_argument" : st >= 500 ? "store_unavailable" : "upstream_error", r.error);
      }
      return { id: id, url: null, sizeBytes: blob.size, contentType: type };
    },
    delete: async function (ref) {
      var id = String(ref).split("/").pop();
      var r = await sb.storage.from(BUCKET).remove([id]);
      if (r.error) throw err("upstream_error", r.error);
      if (r.data && r.data.length) { delete URLS[id]; saveUrls(); return { deleted: true }; }
      // 지워지지 않았는데 파일이 남아 있으면 남이 올린 사진
      var l = await sb.storage.from(BUCKET).list("", { search: id, limit: 1 });
      if (!l.error && l.data && l.data.some(function (f) { return f.name === id; })) throw err("not_uploader");
      return { deleted: false };
    },
    list: async function () {
      var r = await sb.rpc("photo_usage");
      if (r.error) throw mapErr(r.error);
      var u = r.data || {};
      return { assets: [], usage: { files: u.files || 0, bytes: u.bytes || 0, maxFiles: 100000, maxBytes: 1073741824 } };
    },
    // 화면용 주소: 있으면 바로, 없으면 prefetch 후 채움
    src: function (id) { var c = URLS[id]; return c && c.e > Date.now() + 60000 ? c.u : null; },
    prefetch: async function (ids) {
      var need = ids.filter(function (id) { return !assets.src(id) && !inflight[id]; });
      if (need.length) {
        var p = sb.storage.from(BUCKET).createSignedUrls(need, 7 * 86400).then(function (r) {
          var exp = Date.now() + 7 * 86400 * 1000 - 3600 * 1000;
          (r.data || []).forEach(function (x) { if (x.signedUrl && !x.error) URLS[x.path] = { u: x.signedUrl, e: exp }; });
          saveUrls();
        }).finally(function () { need.forEach(function (id) { delete inflight[id]; }); });
        need.forEach(function (id) { inflight[id] = p; });
      }
      await Promise.all(ids.map(function (id) { return inflight[id]; }).filter(Boolean));
      var out = {};
      ids.forEach(function (id) { out[id] = assets.src(id); });
      return out;
    }
  };

  // ---------------- push: 휴대폰 알림 ----------------
  var SW = null;
  if ("serviceWorker" in navigator) {
    SW = navigator.serviceWorker.register("sw.js").catch(function () { return null; });
  }
  function b64ToBytes(s) {
    var pad = "=".repeat((4 - s.length % 4) % 4);
    var raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function isIos() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); }
  function standalone() { return (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true; }
  async function currentSub() {
    var reg = SW && (await SW);
    if (!reg || !reg.pushManager) return null;
    return reg.pushManager.getSubscription();
  }
  async function saveSub(sub) {
    var j = sub.toJSON();
    var r = await sb.rpc("save_push_subscription", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
    if (r.error) throw mapErr(r.error);
  }
  // 로그인할 때마다 이 기기 구독을 지금 계정으로 다시 등록(기기를 다른 직원이 쓰게 된 경우 대비)
  async function resaveSubscription() {
    try { if (window.Notification && Notification.permission === "granted") { var s = await currentSub(); if (s) await saveSub(s); } } catch (e) { /* 다음에 */ }
  }
  async function disablePushQuietly() {
    try { var s = await currentSub(); if (s) { await sb.rpc("delete_push_subscription", { p_endpoint: s.endpoint }); await s.unsubscribe(); } } catch (e) { /* 무시 */ }
  }
  var push = {
    // on | off | denied | need-install(아이폰: 홈 화면에서 열어야 함) | unsupported
    state: async function () {
      if (isIos() && !standalone()) return "need-install";
      if (!SW || !window.PushManager || !window.Notification) return "unsupported";
      if (Notification.permission === "denied") return "denied";
      var s = await currentSub().catch(function () { return null; });
      return s && Notification.permission === "granted" ? "on" : "off";
    },
    enable: async function () {
      var perm = await Notification.requestPermission();
      if (perm !== "granted") throw err("denied");
      var reg = await SW;
      if (!reg) throw err("unsupported");
      reg = await navigator.serviceWorker.ready;
      var sub = await reg.pushManager.getSubscription() ||
        await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(CFG.vapidPublic) });
      await saveSub(sub);
    },
    disable: disablePushQuietly,
    test: async function () {
      var r = await sb.functions.invoke("push", { body: { type: "test" } });
      if (r.error) throw err("unavailable", r.error);
      return r.data;
    },
    isIos: isIos
  };

  // ---------------- bookings: 고객 예약 요청 ----------------
  var BOOK = {
    subs: new Set(),
    timer: null,
    schedule: function () { if (!BOOK.subs.size) return; clearTimeout(BOOK.timer); BOOK.timer = setTimeout(BOOK.run, 60); },
    last: null,
    run: async function () {
      var r = await sb.from("booking_requests").select("*").eq("status", "new").order("created_at");
      if (r.error) return;
      var s = JSON.stringify(r.data);
      if (s === BOOK.last) return;
      BOOK.last = s;
      var list = r.data.map(function (b) {
        return { id: b.id, createdAt: b.created_at, name: b.name, phone: b.phone, address: b.address, moveTo: b.move_to, date: b.want_date, timeSlot: b.time_slot, items: b.items || [], note: b.note };
      });
      BOOK.subs.forEach(function (f) { f(list); });
    }
  };
  async function handleBooking(id, patch) {
    var r = await sb.from("booking_requests").update(Object.assign({ handled_by: ACC && ACC.staffId, handled_at: new Date().toISOString() }, patch))
      .eq("id", id).eq("status", "new").select("id");
    if (r.error) throw mapErr(r.error);
    BOOK.schedule();
    return !!r.data.length;
  }
  var bookings = {
    onSnapshot: function (next) {
      BOOK.subs.add(next); BOOK.last = null; ensureChannel(); BOOK.schedule();
      return function () { BOOK.subs.delete(next); };
    },
    accept: function (id, reservationId) { return handleBooking(id, { status: "accepted", reservation_id: reservationId }); },
    reject: function (id) { return handleBooking(id, { status: "rejected" }); }
  };

  var caps = { db: db, user: user, downloads: downloads, assets: assets, push: push, bookings: bookings };
  window.claude = {
    use: function (name) { return ready.then(function () { return caps[name] || null; }); }
  };
  sb.auth.onAuthStateChange(function (ev) { if (ev === "SIGNED_OUT" && ACC) location.replace(location.pathname); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
