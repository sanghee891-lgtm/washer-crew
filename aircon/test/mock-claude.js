// 테스트용 가짜 claude 런타임: db(localStorage 공유 + storage 이벤트로 탭 간 실시간 반영), user, downloads.
// Playwright addInitScript(mockClaude, cfg) 로 주입합니다.
function mockClaude(cfg) {
  cfg = cfg || {};
  if (cfg.noClaude) return;
  var KEY = "mockdb";
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } }
  var listeners = new Set();
  function notify() { setTimeout(function () { listeners.forEach(function (f) { f(); }); }, 0); }
  function save(db) { localStorage.setItem(KEY, JSON.stringify(db)); notify(); }
  window.addEventListener("storage", function (e) { if (e.key === KEY) notify(); });
  window.__mockWrites = 0;

  function freeze(o) {
    if (o && typeof o === "object") { Object.freeze(o); Object.keys(o).forEach(function (k) { freeze(o[k]); }); }
    return o;
  }
  function snapOf(path, data) {
    var body = data === undefined ? undefined : freeze(JSON.parse(JSON.stringify(data)));
    return { id: path.split("/").pop(), exists: body !== undefined, data: function () { return body; }, metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function isObj(v) { return v && typeof v === "object" && !Array.isArray(v); }
  function merge(a, b) {
    var out = Object.assign({}, a);
    Object.keys(b).forEach(function (k) { out[k] = isObj(b[k]) && isObj(a[k]) ? merge(a[k], b[k]) : b[k]; });
    return out;
  }
  function segs(p) { return p.split("/").filter(Boolean); }
  function err(code) { return { code: code, message: code }; }
  function delay() { return new Promise(function (r) { setTimeout(r, 5); }); }
  function checkWrite() { if (cfg.readOnly) throw err("invalid_argument"); window.__mockWrites++; }
  var counter = 0;

  function docRef(path) {
    if (segs(path).length % 2) throw new TypeError("doc path needs even segments: " + path);
    return {
      id: segs(path).pop(), path: path,
      get: async function () { await delay(); return snapOf(path, load()[path]); },
      set: async function (data) { await delay(); checkWrite(); var db = load(); db[path] = JSON.parse(JSON.stringify(data)); save(db); },
      update: async function (data) {
        await delay(); checkWrite();
        var db = load();
        if (!(path in db)) throw err("invalid_argument");
        db[path] = merge(db[path], JSON.parse(JSON.stringify(data)));
        save(db);
      },
      delete: async function () { await delay(); checkWrite(); var db = load(); delete db[path]; save(db); },
      onSnapshot: function (next) {
        var last = "\u0000";
        var fire = function () { var v = load()[path]; var s = JSON.stringify(v); if (s === last) return; last = s; next(snapOf(path, v)); };
        listeners.add(fire); setTimeout(fire, 10);
        return function () { listeners.delete(fire); };
      },
      collection: function (sub) { return colRef(path + "/" + sub); }
    };
  }

  function query(col, filters, order, lim) {
    function run() {
      var db = load(), n = segs(col).length, out = [];
      Object.keys(db).forEach(function (p) {
        var s = segs(p);
        if (s.length !== n + 1 || p.indexOf(col + "/") !== 0) return;
        var d = db[p];
        var ok = filters.every(function (f) {
          var v = d[f[0]], x = f[2];
          switch (f[1]) {
            case "==": return v === x; case "!=": return v !== x;
            case "<": return v < x; case "<=": return v <= x; case ">": return v > x; case ">=": return v >= x;
            case "in": return x.indexOf(v) >= 0; case "not-in": return x.indexOf(v) < 0;
            case "array-contains": return Array.isArray(v) && v.indexOf(x) >= 0;
          }
          return false;
        });
        if (ok) out.push([p, d]);
      });
      out.sort(function (a, b) {
        if (order) { var x = a[1][order[0]], y = b[1][order[0]]; if (x !== y) return (x < y ? -1 : 1) * (order[1] === "desc" ? -1 : 1); }
        return a[0] < b[0] ? -1 : 1;
      });
      if (lim) out = out.slice(0, lim);
      var docs = out.map(function (e) { return snapOf(e[0], e[1]); });
      return { docs: docs, size: docs.length, empty: !docs.length, docChanges: function () { return []; }, metadata: { fromCache: false, hasPendingWrites: false } };
    }
    return {
      where: function (f, op, v) { return query(col, filters.concat([[f, op, v]]), order, lim); },
      orderBy: function (f, dir) { return query(col, filters, [f, dir || "asc"], lim); },
      limit: function (n) { return query(col, filters, order, n); },
      get: async function () { await delay(); return run(); },
      onSnapshot: function (next) {
        var last = null;
        var fire = function () { var r = run(); var s = JSON.stringify(r.docs.map(function (d) { return [d.id, d.data()]; })); if (s === last) return; last = s; next(r); };
        listeners.add(fire); setTimeout(fire, 10);
        return function () { listeners.delete(fire); };
      }
    };
  }

  function colRef(path) {
    if (segs(path).length % 2 === 0) throw new TypeError("collection path needs odd segments: " + path);
    var q = query(path, [], null, 0);
    q.path = path;
    q.doc = function (id) { return docRef(path + "/" + (id || ("m" + Date.now().toString(36) + (counter++) + Math.random().toString(36).slice(2, 6)))); };
    q.add = async function (data) { var r = q.doc(); await r.set(data); return r; };
    return q;
  }

  var db = { doc: docRef, collection: colRef };
  var user = {
    id: async function () { return cfg.uid || null; },
    me: async function () { return { id: cfg.uid || null, name: "", email: null, isOwner: false, canEdit: !cfg.readOnly, avatarUrl: "", color: "#888" }; },
    isOwner: async function () { return false; },
    canEdit: async function () { return !cfg.readOnly; },
    can: async function (n) { return n === "data.write" ? !cfg.readOnly : false; },
    profiles: async function (ids) { var o = {}; [].concat(ids).forEach(function (i) { o[i] = { id: i, name: "", avatarUrl: "", color: "#888", email: null, isMe: i === cfg.uid, guest: false }; }); return o; }
  };
  window.__saved = [];
  var downloads = { save: async function (r) { window.__saved.push({ filename: r.filename, data: String(r.data) }); return { status: "saved" }; } };
  // assets: 테스트 서버의 /_blob/ 에 저장, 올린 사람을 기억해 남의 사진 삭제는 not_uploader
  var AKEY = "mockassets";
  function upMap() { try { return JSON.parse(localStorage.getItem(AKEY) || "{}"); } catch (e) { return {}; } }
  var assets = {
    upload: async function (blob, opt) {
      if (!(blob instanceof Blob) || !blob.size) throw err("invalid_request");
      var type = (opt && opt.type) || blob.type;
      if (!/^image\/(jpeg|png|webp)$/.test(type)) throw err("unsupported_type");
      var id = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
      if (cfg.rateLimitFirst > 0) { cfg.rateLimitFirst--; throw err("rate_limited"); } // 처음 몇 번은 '잠시 뒤 다시'
      window.__inflight = (window.__inflight || 0) + 1;
      window.__maxInflight = Math.max(window.__maxInflight || 0, window.__inflight);
      try { if (cfg.uploadDelay) await new Promise(function (r) { setTimeout(r, cfg.uploadDelay); }); } finally { window.__inflight--; } // 느린 모바일망 흉내
      var r = await fetch("/_blob/" + id, { method: "PUT", body: blob, headers: { "content-type": type } });
      if (!r.ok) throw err("upstream_error");
      var m = upMap(); m[id] = { by: cfg.uid, size: blob.size }; localStorage.setItem(AKEY, JSON.stringify(m));
      return { id: id, url: "/_blob/" + id, sizeBytes: blob.size, contentType: type };
    },
    delete: async function (ref) {
      var id = String(ref).split("/").pop(), m = upMap();
      if (!m[id]) return { deleted: false };
      if (m[id].by !== cfg.uid && !cfg.owner) throw err("not_uploader");
      await fetch("/_blob/" + id, { method: "DELETE" });
      delete m[id]; localStorage.setItem(AKEY, JSON.stringify(m));
      return { deleted: true };
    },
    list: async function () {
      var m = upMap(), ids = Object.keys(m);
      return { assets: [], usage: { files: ids.length, bytes: ids.reduce(function (s, k) { return s + m[k].size; }, 0), maxFiles: 10000, maxBytes: 1073741824 } };
    }
  };
  user.isOwner = async function () { return !!cfg.owner; };
  var caps = { db: cfg.noDb ? null : db, user: user, downloads: downloads, assets: cfg.readOnly ? null : assets };
  window.claude = { use: function (name) { return new Promise(function (r) { setTimeout(function () { r(caps[name] || null); }, 20); }); } };
}
if (typeof module !== "undefined") module.exports = mockClaude;
