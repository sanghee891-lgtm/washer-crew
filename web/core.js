/* 예약장부 핵심 계산 로직 — 화면과 무관한 순수 함수만 둡니다(브라우저·Node 공용). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var TYPES = ["통돌이", "삼성 2단", "LG 2단", "빌트인", "건조기", "세탁기"];
  var WORKS = ["세척", "이전설치", "철거", "기타"];
  var PAY_METHODS = ["미정", "현금", "카드", "계좌이체"];
  // 저장되는 상태값. "직원 배정"·"입금 완료"는 인원·입금 여부로 계산(stageOf)
  var STATUS = { scheduled: "확정", moving: "이동 중", working: "작업 중", done: "완료", canceled: "취소" };
  // 화면에 보이는 진행 단계: 예약 요청 → 확정 → 직원 배정 → 이동 중 → 작업 중 → 작업 완료 → 입금 완료
  var STAGES = [
    { key: "request", label: "예약 요청" }, { key: "confirmed", label: "확정" }, { key: "assigned", label: "직원 배정" },
    { key: "moving", label: "이동 중" }, { key: "working", label: "작업 중" }, { key: "done", label: "작업 완료" }, { key: "paid", label: "입금 완료" }
  ];
  var NEXT = { scheduled: { s: "moving", label: "이동 시작" }, moving: { s: "working", label: "작업 시작" }, working: { s: "done", label: "작업 완료" } };
  var WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  // "HH:MM" → 분. 형식이 틀리면 NaN
  function toMin(t) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ""));
    if (!m) return NaN;
    var h = +m[1], mm = +m[2];
    if (h > 23 || mm > 59) return NaN;
    return h * 60 + mm;
  }

  function fromMin(min) {
    var day = Math.floor(min / 1440);
    var m = ((min % 1440) + 1440) % 1440;
    return pad(Math.floor(m / 60)) + ":" + pad(m % 60) + (day > 0 ? " (다음날)" : "");
  }

  function endTime(time, durationMin) {
    var s = toMin(time);
    if (isNaN(s)) return "";
    return fromMin(s + Math.max(0, +durationMin || 0));
  }

  function durationLabel(min) {
    min = Math.max(0, Math.round(+min || 0));
    var h = Math.floor(min / 60), m = min % 60;
    if (!h) return m + "분";
    return h + "시간" + (m ? " " + m + "분" : "");
  }

  // 배정된 직원 id 목록(workers 맵에서 true 인 것만)
  function assignedWorkers(r) {
    var w = (r && r.workers) || {};
    return Object.keys(w).filter(function (k) { return w[k] === true; });
  }

  function interval(r) {
    var s = toMin(r.time);
    return [s, s + Math.max(0, +r.durationMin || 0)];
  }

  // 같은 날짜, 둘 다 취소 아님, 시간이 겹침(끝 시각 = 시작 시각은 겹치지 않음)
  function overlaps(a, b) {
    if (!a || !b || a.date !== b.date) return false;
    if (a.status === "canceled" || b.status === "canceled") return false;
    var x = interval(a), y = interval(b);
    if (isNaN(x[0]) || isNaN(y[0])) return false;
    return x[0] < y[1] && y[0] < x[1];
  }

  // 같은 직원이 시간이 겹치는 두 예약에 배정된 경우 → { 예약id: [{otherId, staffIds}] }
  function findConflicts(list, candidate) {
    var all = (list || []).slice();
    if (candidate) {
      all = all.filter(function (r) { return r.id !== candidate.id; });
      all.push(candidate);
    }
    var out = {};
    var byDate = {};
    all.forEach(function (r) { (byDate[r.date] = byDate[r.date] || []).push(r); });
    Object.keys(byDate).forEach(function (d) {
      var rs = byDate[d];
      for (var i = 0; i < rs.length; i++) {
        for (var j = i + 1; j < rs.length; j++) {
          var a = rs[i], b = rs[j];
          if (!overlaps(a, b)) continue;
          var wb = assignedWorkers(b);
          var shared = assignedWorkers(a).filter(function (s) { return wb.indexOf(s) >= 0; });
          if (!shared.length) continue;
          (out[a.id] = out[a.id] || []).push({ otherId: b.id, staffIds: shared });
          (out[b.id] = out[b.id] || []).push({ otherId: a.id, staffIds: shared });
        }
      }
    });
    return out;
  }

  // ---- 날짜 ----
  function todayStr(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function ymOf(date) { return String(date || "").slice(0, 7); }
  function addMonths(ym, n) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    return y + "-" + pad(m + 1);
  }
  function monthRange(ym) { return { start: ym + "-01", end: addMonths(ym, 1) + "-01" }; }
  function yearRange(y) { return { start: y + "-01-01", end: (+y + 1) + "-01-01" }; }
  function daysInMonth(ym) { return new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate(); }
  function weekdayOf(date) {
    return new Date(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)).getDay();
  }
  function dayLabel(date) {
    return (+date.slice(5, 7)) + "월 " + (+date.slice(8, 10)) + "일 (" + WEEKDAYS[weekdayOf(date)] + ")";
  }
  function ymLabel(ym) { return ym.slice(0, 4) + "년 " + (+ym.slice(5, 7)) + "월"; }

  // ---- 금액·전화 ----
  function parseWon(v) {
    if (typeof v === "number") return isFinite(v) ? Math.round(v) : 0;
    var s = String(v == null ? "" : v).replace(/[^\d-]/g, "");
    var n = parseInt(s, 10);
    return isNaN(n) ? 0 : n;
  }
  function formatWon(n) {
    n = Math.round(+n || 0);
    return (n < 0 ? "-" : "") + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  // 달력 칸처럼 좁은 곳: 245000 → "24.5만"
  function shortWon(n) {
    n = +n || 0;
    if (n < 10000) return formatWon(n);
    var man = Math.round(n / 1000) / 10;
    return (man % 1 === 0 ? man.toFixed(0) : man.toFixed(1)) + "만";
  }
  function normalizePhone(s) { return String(s || "").replace(/\D/g, ""); }
  function formatPhone(s) {
    var d = normalizePhone(s);
    if (d.indexOf("02") === 0) {
      if (d.length === 9) return d.replace(/^(02)(\d{3})(\d{4})$/, "$1-$2-$3");
      if (d.length === 10) return d.replace(/^(02)(\d{4})(\d{4})$/, "$1-$2-$3");
    }
    if (d.length === 11) return d.replace(/^(\d{3})(\d{4})(\d{4})$/, "$1-$2-$3");
    if (d.length === 10) return d.replace(/^(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3");
    if (d.length === 8) return d.replace(/^(\d{4})(\d{4})$/, "$1-$2");
    return String(s || "");
  }

  // ---- 기기 요약 ----
  function cleanItems(items) {
    return (items || []).filter(function (it) { return it && it.type; }).map(function (it) {
      return {
        type: String(it.type),
        model: String(it.model || "").trim(),
        qty: Math.max(1, parseInt(it.qty, 10) || 1),
        work: WORKS.indexOf(it.work) >= 0 ? it.work : "세척"
      };
    });
  }
  function itemsSummary(items) {
    var acc = {}, order = [];
    cleanItems(items).forEach(function (it) {
      if (!(it.type in acc)) { acc[it.type] = 0; order.push(it.type); }
      acc[it.type] += it.qty;
    });
    return order.map(function (t) { return t + " " + acc[t] + "대"; }).join(" · ");
  }
  function worksSummary(items) {
    var seen = [];
    cleanItems(items).forEach(function (it) { if (seen.indexOf(it.work) < 0) seen.push(it.work); });
    return seen.join("·");
  }
  function modelsSummary(items) {
    return cleanItems(items).map(function (it) { return it.model; }).filter(Boolean).join(", ");
  }
  function unitCount(items) {
    return cleanItems(items).reduce(function (s, it) { return s + it.qty; }, 0);
  }

  // ---- 작업 사진 ----
  // r.photos = { assetId: {kind: "before"|"after", by, at} }, 지운 사진은 null
  function photoList(r, kind) {
    var ph = (r && r.photos) || {};
    return Object.keys(ph).filter(function (id) {
      var p = ph[id];
      return p && typeof p === "object" && (!kind || p.kind === kind);
    }).map(function (id) {
      return { id: id, kind: ph[id].kind === "after" ? "after" : "before", by: ph[id].by || "", at: ph[id].at || "" };
    }).sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : (a.id < b.id ? -1 : 1); });
  }
  function photoCounts(r) {
    var all = photoList(r);
    var before = all.filter(function (p) { return p.kind === "before"; }).length;
    return { before: before, after: all.length - before, total: all.length };
  }

  // 작업 중 '이전설치'가 있으면 출발지(customer.address) → 도착지(moveTo.address)
  function isMove(r) {
    return cleanItems(r && r.items).some(function (it) { return it.work === "이전설치"; });
  }

  function isPaid(r) { return !!(r.payment && r.payment.paid); }

  // ---- 진행 단계 ----
  // crewCount: 지금 명단에 있는 참여 직원 수(없으면 workers 의 true 개수)
  function stageOf(r, crewCount) {
    if (!r || r.status === "canceled") return { key: "canceled", label: "취소", step: -1 };
    var key = r.status === "done" ? (isPaid(r) ? "paid" : "done")
      : r.status === "moving" || r.status === "working" ? r.status
      : ((crewCount == null ? assignedWorkers(r).length : crewCount) >= (+r.needed || 2) ? "assigned" : "confirmed");
    for (var i = 0; i < STAGES.length; i++) if (STAGES[i].key === key) return { key: key, label: STAGES[i].label, step: i };
    return { key: key, label: "", step: 0 };
  }
  function nextStatus(r) { return r ? NEXT[r.status] || null : null; }
  // 상태 변경 기록(log: {키: {s, by, at}})을 시간순으로
  function statusLog(r) {
    var log = (r && r.log) || {};
    return Object.keys(log).map(function (k) { return log[k]; }).filter(function (e) { return e && e.s && e.at; })
      .sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
  }
  var LOG_LABEL = { scheduled: "확정", moving: "이동 시작", working: "작업 시작", done: "작업 완료", paid: "입금 확인", unpaid: "입금 확인 취소", canceled: "취소", request: "고객 예약 요청" };

  // ---- 집계 ----
  // 매출 기준: 완료 매출(확정) + 예정 매출(상태 '예약'), 취소 제외. 미수금 = 완료됐지만 입금 미확인.
  function summarize(list) {
    var s = {
      count: 0, canceled: 0, done: 0, scheduled: 0,
      doneRevenue: 0, scheduledRevenue: 0, totalRevenue: 0,
      unpaid: 0, unpaidCount: 0, units: 0,
      byType: {}, byWork: {}, byStaff: {}, byMethod: {}
    };
    TYPES.forEach(function (t) { s.byType[t] = 0; });
    WORKS.forEach(function (w) { s.byWork[w] = 0; });
    (list || []).forEach(function (r) {
      if (r.status === "canceled") { s.canceled++; return; }
      var total = parseWon(r.total);
      s.count++;
      if (r.status === "done") {
        s.done++;
        s.doneRevenue += total;
        if (!isPaid(r)) { s.unpaid += total; if (total > 0) s.unpaidCount++; }
        var m = (r.payment && r.payment.method) || "미정";
        s.byMethod[m] = (s.byMethod[m] || 0) + total;
      } else {
        s.scheduled++;
        s.scheduledRevenue += total;
      }
      var works = {};
      cleanItems(r.items).forEach(function (it) {
        s.byType[it.type] = (s.byType[it.type] || 0) + it.qty;
        s.units += it.qty;
        works[it.work] = true;
      });
      Object.keys(works).forEach(function (w) { s.byWork[w] = (s.byWork[w] || 0) + 1; });
      assignedWorkers(r).forEach(function (id) {
        var b = s.byStaff[id] = s.byStaff[id] || { count: 0, done: 0, revenue: 0 };
        b.count++;
        if (r.status === "done") { b.done++; b.revenue += total; }
      });
    });
    s.totalRevenue = s.doneRevenue + s.scheduledRevenue;
    return s;
  }

  function filterMonth(list, ym) {
    return (list || []).filter(function (r) { return ymOf(r.date) === ym; });
  }

  function summarizeYear(list, year) {
    var out = [];
    for (var m = 1; m <= 12; m++) {
      var ym = year + "-" + pad(m);
      var s = summarize(filterMonth(list, ym));
      s.ym = ym;
      out.push(s);
    }
    return out;
  }

  function sortReservations(list) {
    return (list || []).slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      var x = toMin(a.time), y = toMin(b.time);
      if (x !== y) return (isNaN(x) ? 9999 : x) - (isNaN(y) ? 9999 : y);
      return String(a.id) < String(b.id) ? -1 : 1;
    });
  }

  function searchMatch(r, q) {
    q = String(q || "").trim().toLowerCase();
    if (!q) return true;
    var c = r.customer || {};
    var hay = [c.name, c.address, (r.moveTo || {}).address, c.phone, r.note,
      (r.site || {}).memo, modelsSummary(r.items), itemsSummary(r.items)].join(" ").toLowerCase();
    var digits = normalizePhone(q);
    if (digits.length >= 3 && normalizePhone(c.phone).indexOf(digits) >= 0) return true;
    return hay.indexOf(q) >= 0;
  }

  // ---- 입력 검사 ----
  function validateReservation(r) {
    var errors = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || "")) errors.date = "예약일자를 고르세요.";
    if (isNaN(toMin(r.time))) errors.time = "예약시간을 고르세요.";
    if (!(+r.durationMin > 0)) errors.durationMin = "소요시간을 고르세요.";
    var c = r.customer || {};
    if (!String(c.name || "").trim() && !normalizePhone(c.phone)) errors.customer = "고객 이름이나 전화번호 중 하나는 넣어 주세요.";
    var pd = normalizePhone(c.phone);
    if (pd.length > 0 && (pd.length < 9 || pd.length > 11 || pd[0] !== "0")) errors.phone = "전화번호 형식을 확인하세요. (예: 010-1234-5678)";
    if (!cleanItems(r.items).length) errors.items = "기기를 하나 이상 넣어 주세요.";
    if (parseWon(r.total) < 0) errors.total = "금액은 0원 이상이어야 해요.";
    if (!(r.status in STATUS)) errors.status = "상태를 고르세요.";
    return errors;
  }

  // ---- CSV (엑셀용, UTF-8 BOM) ----
  function csvCell(v) {
    var s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(list, staff) {
    var names = {};
    (staff || []).forEach(function (p) { names[p.id] = p.name; });
    var head = ["예약일자", "요일", "시작", "종료", "소요시간", "상태", "고객명", "전화번호", "주소(출발지)", "도착지 주소",
      "기기", "모델명", "작업", "대수", "금액", "결제방법", "입금", "참여직원", "층수", "엘리베이터", "주차", "메모", "사진(전/후)"];
    var rows = [head];
    sortReservations(list).forEach(function (r) {
      var c = r.customer || {}, site = r.site || {}, p = r.payment || {};
      rows.push([
        r.date, WEEKDAYS[weekdayOf(r.date)], r.time, endTime(r.time, r.durationMin), durationLabel(r.durationMin),
        STATUS[r.status] || "", c.name || "", formatPhone(c.phone), c.address || "",
        isMove(r) ? ((r.moveTo || {}).address || "") : "",
        itemsSummary(r.items), modelsSummary(r.items), worksSummary(r.items), unitCount(r.items),
        parseWon(r.total), p.method || "미정", p.paid ? "입금완료" : "미입금",
        assignedWorkers(r).map(function (id) { return names[id]; }).filter(Boolean).join(" "),
        site.floor || "", site.elevator || "", site.parking || "",
        [site.memo, r.note].filter(Boolean).join(" / "),
        (function () { var pc = photoCounts(r); return pc.total ? pc.before + "/" + pc.after : ""; })()
      ]);
    });
    return "﻿" + rows.map(function (row) { return row.map(csvCell).join(","); }).join("\r\n") + "\r\n";
  }

  // ---- 내비·지도 링크 ----
  // 좌표 없이 주소 검색 상태로 앱을 엽니다. platform: "android" | "ios" | "other"(PC: 웹 지도만)
  var NAV_APPS = [
    { key: "tmap", label: "티맵", pkg: "com.skt.tmap.ku" },
    { key: "kakaonavi", label: "카카오내비", pkg: "com.locnall.KimGiSa" },
    { key: "kakaomap", label: "카카오맵", pkg: "net.daum.android.map" },
    { key: "navermap", label: "네이버지도", pkg: "com.nhn.android.nmap" }
  ];
  function detectPlatform(ua) {
    ua = String(ua || "");
    if (/android/i.test(ua)) return "android";
    if (/iphone|ipad|ipod/i.test(ua)) return "ios";
    return "other";
  }
  function navLinks(address, platform) {
    var q = encodeURIComponent(String(address || "").trim());
    var web = {
      kakaomap: "https://map.kakao.com/link/search/" + q,
      navermap: "https://map.naver.com/p/search/" + q
    };
    var ios = {
      tmap: "tmap://search?name=" + q,
      kakaonavi: "kakaonavi-sdk://",
      kakaomap: "kakaomap://search?q=" + q,
      navermap: "nmap://search?query=" + q + "&appname=washbook"
    };
    var apps = [];
    if (platform === "android" || platform === "ios") {
      apps = NAV_APPS.map(function (a) {
        var href = ios[a.key];
        if (platform === "android") {
          var m = /^([a-z-]+):\/\/(.*)$/.exec(href);
          var fallback = web[a.key] || "https://play.google.com/store/apps/details?id=" + a.pkg;
          href = "intent://" + m[2] + "#Intent;scheme=" + m[1] + ";package=" + a.pkg +
            ";S.browser_fallback_url=" + encodeURIComponent(fallback) + ";end";
        }
        // 카카오내비는 주소를 넘기는 공개 링크가 없어 앱만 열고 주소는 복사해 둠
        return { key: a.key, label: a.label, href: href, copyFirst: a.key === "kakaonavi" };
      });
    }
    return {
      apps: apps,
      web: [
        { key: "kakaomap", label: "카카오맵(웹)", href: web.kakaomap },
        { key: "navermap", label: "네이버지도(웹)", href: web.navermap }
      ]
    };
  }

  // ---- 전날 확인 문자 ----
  function addDays(date, n) {
    var d = new Date(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + n);
    return todayStr(d);
  }
  // "오전 10시", "오후 1시 30분"
  function timeKo(time) {
    var m = toMin(time);
    if (isNaN(m)) return "";
    var h = Math.floor(m / 60), mm = m % 60;
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return (h < 12 ? "오전 " : "오후 ") + h12 + "시" + (mm ? " " + mm + "분" : "");
  }
  // [세탁기 크루] 김민지 고객님, 내일 10월 24일(토) 오전 10시 건조기 이전설치 예약 확인 드립니다. 변경 있으시면 연락 주세요.
  function reminderText(r, when) {
    var c = r.customer || {}, items = cleanItems(r.items);
    var types = [], works = [];
    items.forEach(function (it) {
      if (types.indexOf(it.type) < 0) types.push(it.type);
      if (works.indexOf(it.work) < 0) works.push(it.work);
    });
    var what = (types.join("·") + " " + works.join("·")).trim();
    return "[세탁기 크루] " + (c.name ? c.name + " " : "") + "고객님, " + (when == null ? "내일 " : when ? when + " " : "") +
      (+r.date.slice(5, 7)) + "월 " + (+r.date.slice(8, 10)) + "일(" + WEEKDAYS[weekdayOf(r.date)] + ") " +
      timeKo(r.time) + (what ? " " + what : "") + " 예약 확인 드립니다. 변경 있으시면 연락 주세요.";
  }
  // 문구가 채워진 문자 화면 열기(아이폰은 &body=, 그 밖은 ?body=)
  function smsHref(phone, body, platform) {
    return "sms:" + normalizePhone(phone) + (platform === "ios" ? "&" : "?") + "body=" + encodeURIComponent(body);
  }

  return {
    NAV_APPS: NAV_APPS, detectPlatform: detectPlatform, navLinks: navLinks,
    TYPES: TYPES, WORKS: WORKS, PAY_METHODS: PAY_METHODS, STATUS: STATUS, WEEKDAYS: WEEKDAYS,
    STAGES: STAGES, LOG_LABEL: LOG_LABEL, stageOf: stageOf, nextStatus: nextStatus, statusLog: statusLog,
    pad: pad, toMin: toMin, endTime: endTime, durationLabel: durationLabel,
    assignedWorkers: assignedWorkers, overlaps: overlaps, findConflicts: findConflicts,
    todayStr: todayStr, ymOf: ymOf, addMonths: addMonths, monthRange: monthRange, yearRange: yearRange,
    daysInMonth: daysInMonth, weekdayOf: weekdayOf, dayLabel: dayLabel, ymLabel: ymLabel,
    parseWon: parseWon, formatWon: formatWon, shortWon: shortWon,
    normalizePhone: normalizePhone, formatPhone: formatPhone,
    cleanItems: cleanItems, itemsSummary: itemsSummary, worksSummary: worksSummary,
    modelsSummary: modelsSummary, unitCount: unitCount, isPaid: isPaid,
    photoList: photoList, photoCounts: photoCounts, isMove: isMove,
    summarize: summarize, filterMonth: filterMonth, summarizeYear: summarizeYear,
    sortReservations: sortReservations, searchMatch: searchMatch,
    validateReservation: validateReservation, toCSV: toCSV,
    addDays: addDays, timeKo: timeKo, reminderText: reminderText, smsHref: smsHref
  };
});
