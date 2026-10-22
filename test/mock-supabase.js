// 테스트용 가짜 Supabase(window.supabase.createClient): supa-db.js 가 쓰는 만큼만 흉내 냅니다.
// 데이터는 localStorage("fakesb")에 두고, 같은 브라우저의 다른 탭에는 storage 이벤트로 실시간 반영합니다.
// 로그인은 탭마다 따로(sessionStorage) 두어 한 브라우저에서 여러 직원을 함께 시험할 수 있게 합니다.
// 서버 규칙도 흉내 냄: config/* 쓰기는 사장님만, data/users/<uid> 는 본인만, 예약 삭제는 넣은 사람·사장님만, 사진 삭제는 올린 사람·사장님만.
// Playwright addInitScript(mockSupabase, cfg) 로 주입합니다. cfg.accounts = [{ uid, staffId, pin, owner }]
function mockSupabase(cfg) {
  cfg = cfg || {};
  var KEY = "fakesb", SKEY = "fakesb.session";
  function load() {
    var d = null;
    try { d = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { d = null; }
    d = d || {};
    d.docs = d.docs || {}; d.bookings = d.bookings || []; d.files = d.files || {}; d.subs = d.subs || {};
    d.accounts = d.accounts || (cfg.accounts || []).map(function (a) { return Object.assign({}, a); });
    return d;
  }
  function save(d) { localStorage.setItem(KEY, JSON.stringify(d)); }
  if (!localStorage.getItem(KEY)) save(load());
  window.__fakesb = { load: load, save: save, calls: [] };

  var handlers = [];
  function emit(table, path) { setTimeout(function () { handlers.forEach(function (h) { if (h.table === table) h.cb({ new: path ? { path: path } : {}, old: {} }); }); }, 0); }
  window.addEventListener("storage", function (e) { if (e.key === KEY) { emit("docs", null); emit("booking_requests", null); } });

  function delay() { return new Promise(function (r) { setTimeout(r, 5); }); }
  function uid() { return sessionStorage.getItem(SKEY) || null; }
  function acct(d) { var u = uid(); return d.accounts.filter(function (a) { return a.uid === u; })[0] || null; }
  function canRead(d, path) {
    var a = acct(d);
    if (!a) return false;
    if (path.indexOf("data/users/") === 0) return path.split("/")[2] === a.uid;
    return true;
  }
  function canWrite(d, path) { return canRead(d, path) && (path.indexOf("config/") !== 0 || !!acct(d).owner); }
  function isObj(v) { return v && typeof v === "object" && !Array.isArray(v); }
  function merge(a, b) {
    var out = Object.assign({}, a);
    Object.keys(b).forEach(function (k) { out[k] = isObj(b[k]) && isObj(a[k]) ? merge(a[k], b[k]) : b[k]; });
    return out;
  }
  function colOf(path) { return path.replace(/\/[^/]+$/, ""); }
  function val(row, c) {
    var m = /^data->>(.+)$/.exec(c);
    if (m) { var v = row.data[m[1]]; return v == null ? null : typeof v === "string" ? v : JSON.stringify(v); }
    return row[c];
  }
  function test(v, op, x) {
    switch (op) { case "eq": return v === x; case "gt": return v > x; case "gte": return v >= x; case "lt": return v < x; case "lte": return v <= x; }
    return false;
  }
  function rowsOf(d, table) {
    if (table === "docs") return Object.keys(d.docs).filter(function (p) { return canRead(d, p); }).map(function (p) { return { path: p, coll: colOf(p), data: d.docs[p] }; });
    if (table === "staff_accounts") return acct(d) ? d.accounts.map(function (a) { return { uid: a.uid, staff_id: a.staffId, is_owner: !!a.owner }; }) : [];
    if (table === "booking_requests") return acct(d) ? d.bookings : [];
    return [];
  }
  function pick(row, cols) {
    if (!cols || cols === "*") return JSON.parse(JSON.stringify(row));
    var o = {};
    cols.split(",").forEach(function (c) { c = c.trim(); o[c] = row[c]; });
    return JSON.parse(JSON.stringify(o));
  }
  async function exec(st) {
    await delay();
    window.__fakesb.calls.push(st.table + ":" + st.op);
    if (cfg.offline) return { data: null, error: { message: "Failed to fetch" } };
    var d = load();
    var match = function (row) { return st.filters.every(function (f) { return test(val(row, f[0]), f[1], f[2]); }); };
    if (st.op === "select") {
      var rows = rowsOf(d, st.table).filter(match);
      if (st.order) rows.sort(function (a, b) { var x = val(a, st.order.c), y = val(b, st.order.c); return (x < y ? -1 : x > y ? 1 : 0) * (st.order.asc ? 1 : -1); });
      if (st.range) rows = rows.slice(st.range[0], st.range[1] + 1);
      rows = rows.map(function (r) { return pick(r, st.cols); });
      return { data: st.single ? rows[0] || null : rows, error: null };
    }
    if (st.table === "docs" && st.op === "upsert") {
      var row = st.payload;
      if (!canWrite(d, row.path)) return { data: null, error: { code: "42501", message: "new row violates row-level security policy" } };
      d.docs[row.path] = JSON.parse(JSON.stringify(row.data)); save(d); emit("docs", row.path);
      return { data: null, error: null };
    }
    if (st.table === "docs" && st.op === "delete") {
      var gone = Object.keys(d.docs).filter(function (p) {
        if (!match({ path: p, coll: colOf(p), data: d.docs[p] }) || !canWrite(d, p)) return false;
        var a = acct(d);
        return colOf(p) !== "reservations" || a.owner || d.docs[p].createdBy === a.staffId;
      });
      gone.forEach(function (p) { delete d.docs[p]; emit("docs", p); });
      save(d);
      return { data: gone.map(function (p) { return { path: p }; }), error: null };
    }
    if (st.table === "booking_requests" && st.op === "update") {
      if (!acct(d)) return { data: [], error: null };
      var hit = d.bookings.filter(match);
      hit.forEach(function (b) { Object.assign(b, st.payload); });
      save(d); emit("booking_requests", null);
      return { data: hit.map(function (b) { return { id: b.id }; }), error: null };
    }
    return { data: null, error: { message: "fake: unsupported " + st.table + " " + st.op } };
  }
  function from(table) {
    var st = { table: table, op: "select", filters: [], order: null, range: null, single: false, cols: "*", payload: null };
    var b = {
      select: function (cols) { if (st.op === "select") st.cols = cols; return b; },
      upsert: function (row) { st.op = "upsert"; st.payload = row; return b; },
      update: function (p) { st.op = "update"; st.payload = p; return b; },
      delete: function () { st.op = "delete"; return b; },
      order: function (c, o) { st.order = { c: c, asc: !(o && o.ascending === false) }; return b; },
      range: function (a, z) { st.range = [a, z]; return b; },
      maybeSingle: function () { st.single = true; return b; },
      then: function (res, rej) { return exec(st).then(res, rej); }
    };
    ["eq", "gt", "gte", "lt", "lte"].forEach(function (op) { b[op] = function (c, v) { st.filters.push([c, op, v]); return b; }; });
    return b;
  }

  async function rpc(name, args) {
    await delay();
    window.__fakesb.calls.push("rpc:" + name);
    var d = load(), a = acct(d);
    if (name === "login_staff") {
      var list = (d.docs["config/staff"] || {}).list || [];
      return { data: list.filter(function (p) { return d.accounts.some(function (x) { return x.staffId === p.id; }); }), error: null };
    }
    if (!a) return { data: null, error: { code: "42501", message: "permission denied" } };
    if (name === "docs_merge") {
      if (!(args.p_path in d.docs) || !canWrite(d, args.p_path)) return { data: null, error: { code: "P0002", message: "not_found" } };
      d.docs[args.p_path] = merge(d.docs[args.p_path], args.p_patch); save(d); emit("docs", args.p_path);
      return { data: d.docs[args.p_path], error: null };
    }
    if (name === "photo_usage") {
      var ids = Object.keys(d.files);
      return { data: { files: ids.length, bytes: ids.reduce(function (s, k) { return s + d.files[k].size; }, 0) }, error: null };
    }
    if (name === "save_push_subscription") { d.subs[args.p_endpoint] = a.uid; save(d); return { data: null, error: null }; }
    if (name === "delete_push_subscription") { delete d.subs[args.p_endpoint]; save(d); return { data: null, error: null }; }
    return { data: null, error: { message: "fake: unknown rpc " + name } };
  }

  var authCbs = [];
  var auth = {
    getSession: async function () { var u = uid(); return { data: { session: u ? { user: { id: u }, access_token: "fake" } : null } }; },
    signInWithPassword: async function (o) {
      await delay();
      var d = load();
      var a = d.accounts.filter(function (x) { return (x.staffId.toLowerCase() + "@washer-crew.local") === o.email && x.pin === o.password; })[0];
      if (!a) return { data: { session: null }, error: { message: "Invalid login credentials", status: 400 } };
      sessionStorage.setItem(SKEY, a.uid);
      return { data: { session: { user: { id: a.uid }, access_token: "fake" } }, error: null };
    },
    signOut: async function () { sessionStorage.removeItem(SKEY); authCbs.forEach(function (f) { f("SIGNED_OUT", null); }); return { error: null }; },
    updateUser: async function (o) {
      var d = load(), a = acct(d);
      if (!a) return { error: { message: "no session" } };
      if (a.pin === o.password) return { error: { message: "New password should be different from the old password." } };
      d.accounts.forEach(function (x) { if (x.uid === a.uid) x.pin = o.password; }); save(d);
      return { data: {}, error: null };
    },
    onAuthStateChange: function (f) { authCbs.push(f); return { data: { subscription: { unsubscribe: function () {} } } }; }
  };

  function storageFrom() {
    return {
      upload: async function (id, blob, opt) {
        var d = load(), a = acct(d);
        if (!a) return { data: null, error: { statusCode: "403", message: "rls" } };
        var r = await fetch("/_blob/" + id, { method: "PUT", body: blob, headers: { "content-type": opt.contentType } });
        if (!r.ok) return { data: null, error: { statusCode: "500", message: "upstream" } };
        d = load(); d.files[id] = { owner: a.uid, size: blob.size }; save(d);
        return { data: { path: id }, error: null };
      },
      remove: async function (ids) {
        var d = load(), a = acct(d), done = [];
        ids.forEach(function (id) {
          var f = d.files[id];
          if (f && a && (f.owner === a.uid || a.owner)) { delete d.files[id]; done.push({ name: id }); }
        });
        save(d);
        await Promise.all(done.map(function (x) { return fetch("/_blob/" + x.name, { method: "DELETE" }); }));
        return { data: done, error: null };
      },
      list: async function (prefix, o) {
        var d = load();
        return { data: Object.keys(d.files).filter(function (k) { return !o || !o.search || k.indexOf(o.search) >= 0; }).map(function (k) { return { name: k }; }), error: null };
      },
      createSignedUrls: async function (ids) {
        await delay();
        window.__fakesb.calls.push("signed:" + ids.length);
        var d = load();
        return { data: ids.map(function (id) { return d.files[id] ? { path: id, signedUrl: "/_blob/" + id + "?token=t" + id.slice(0, 4), error: null } : { path: id, signedUrl: null, error: "not found" }; }), error: null };
      }
    };
  }

  window.__pushTests = 0;
  var functions = {
    invoke: async function (name, o) {
      await delay();
      var d = load(), a = acct(d), body = o.body || {};
      if (name === "push") { window.__pushTests++; return { data: { sent: 1 }, error: null }; }
      if (name === "staff-admin") {
        if (!a || !a.owner) return { data: null, error: { message: "forbidden", context: { json: async function () { return { error: "forbidden" }; } } } };
        if (body.action === "set_pin") {
          var ex = d.accounts.filter(function (x) { return x.staffId === body.staffId; })[0];
          if (ex) ex.pin = body.pin; else d.accounts.push({ uid: "u_" + body.staffId, staffId: body.staffId, pin: body.pin, owner: false });
          save(d); return { data: { ok: true }, error: null };
        }
        if (body.action === "remove") { d.accounts = d.accounts.filter(function (x) { return x.staffId !== body.staffId || x.owner; }); save(d); return { data: { ok: true }, error: null }; }
      }
      return { data: null, error: { message: "fake: unknown function" } };
    }
  };

  function channel() {
    var ch = {
      on: function (type, filter, cb) { handlers.push({ table: filter.table, cb: cb }); return ch; },
      subscribe: function (cb) { setTimeout(function () { if (cb) cb("SUBSCRIBED"); }, 0); return ch; }
    };
    return ch;
  }

  window.supabase = {
    createClient: function () {
      return { auth: auth, from: from, rpc: rpc, channel: channel, removeChannel: function () {}, storage: { from: storageFrom }, functions: functions };
    }
  };
}
if (typeof module !== "undefined") module.exports = mockSupabase;
