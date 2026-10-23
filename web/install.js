/* 홈 화면 설치 도우미: 카카오톡 등 앱 안 브라우저를 알아채고 크롬·사파리로 넘기기, 크롬 설치 창 띄우기, 기기별 설치 방법.
   로그인 화면(supa-db.js)과 장부(app.js)가 같이 씁니다. */
(function () {
  "use strict";
  var deferred = null; // 크롬이 주는 설치 창(beforeinstallprompt)
  var listeners = [];
  function notify() { listeners.forEach(function (f) { try { f(); } catch (e) { /* 무시 */ } }); }

  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); deferred = e; notify(); });
  window.addEventListener("appinstalled", function () { deferred = null; notify(); });

  function ua() { return navigator.userAgent || ""; }
  function isIos() { return /iphone|ipad|ipod/i.test(ua()) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); }
  function isAndroid() { return /android/i.test(ua()); }
  // 앱 안에서 열린 브라우저: 홈 화면 추가와 알림을 지원하지 않음
  function inApp() {
    var u = ua();
    if (/KAKAOTALK/i.test(u)) return "kakao";
    if (/NAVER\(inapp|Instagram|FBAN|FBAV|FB_IAB|Line\/|DaumApps|everytimeApp|; wv\)/i.test(u)) return "other";
    return "";
  }
  // 플레이스토어 앱(TWA)으로 열면 첫 화면의 referrer가 android-app:// — 이 탭에선 계속 앱으로 봄
  var TWA_KEY = "wc.twa";
  try { if (/^android-app:\/\//.test(document.referrer || "")) sessionStorage.setItem(TWA_KEY, "1"); } catch (e) { /* 무시 */ }
  function inTwa() { try { return sessionStorage.getItem(TWA_KEY) === "1"; } catch (e) { return false; } }
  function standalone() {
    return inTwa() || (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  }
  function browser() {
    var u = ua();
    if (isIos()) return /CriOS/i.test(u) ? "ios-chrome" : "ios-safari";
    if (/SamsungBrowser/i.test(u)) return "samsung";
    if (isAndroid()) return "android-chrome";
    return "pc";
  }
  // 카카오톡은 이 주소로 바깥 브라우저(갤럭시: 크롬 등, 아이폰: 사파리)를 엶
  function externalHref(url) {
    url = url || location.href;
    if (inApp() === "kakao") return "kakaotalk://web/openExternal?url=" + encodeURIComponent(url);
    if (isAndroid()) {
      var m = /^https?:\/\/(.*)$/.exec(url);
      return "intent://" + (m ? m[1] : url) + "#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=" + encodeURIComponent(url) + ";end";
    }
    return "";
  }
  function outName() { return isIos() ? "사파리" : "크롬"; }

  // 기기별 설치 방법(버튼으로 바로 설치가 안 될 때)
  var STEPS = {
    "ios-safari": ["화면 아래 <b>공유</b> 버튼(네모에 위쪽 화살표)을 누르세요.", "아래로 내려 <b>홈 화면에 추가</b>를 누르세요.", "오른쪽 위 <b>추가</b>를 누르면 끝이에요."],
    "ios-chrome": ["주소창 오른쪽 <b>공유</b> 버튼을 누르세요.", "<b>홈 화면에 추가</b>를 누르세요.", "<b>추가</b>를 누르면 끝이에요."],
    "samsung": ["화면 아래 <b>메뉴(≡)</b>를 누르세요.", "<b>현재 페이지 추가</b> → <b>홈 화면</b>을 누르세요.", "<b>추가</b>를 누르면 끝이에요."],
    "android-chrome": ["오른쪽 위 <b>점 3개(⋮)</b>를 누르세요.", "<b>홈 화면에 추가</b> 또는 <b>앱 설치</b>를 누르세요.", "<b>설치</b>(또는 <b>추가</b>)를 누르면 끝이에요."],
    "pc": ["주소창 오른쪽 <b>설치</b> 아이콘을 누르거나, 브라우저 메뉴에서 <b>앱 설치</b>를 누르세요."]
  };
  function stepsHtml() {
    return '<ol class="inst-steps">' + (STEPS[browser()] || STEPS.pc).map(function (s) { return "<li>" + s + "</li>"; }).join("") + "</ol>";
  }

  // 설치 버튼을 눌렀을 때: 크롬 설치 창이 있으면 띄우고 결과를, 없으면 "manual"
  async function prompt() {
    if (!deferred) return "manual";
    var d = deferred;
    deferred = null;
    try {
      d.prompt();
      var r = await d.userChoice;
      notify();
      return r && r.outcome === "accepted" ? "installed" : "dismissed";
    } catch (e) { return "manual"; }
  }

  // 앱 안 브라우저 안내 상자(로그인 화면·장부 공통)
  function inAppBoxHtml() {
    var k = inApp();
    if (!k) return "";
    var href = externalHref();
    var where = k === "kakao" ? "카카오톡" : "다른 앱";
    return '<div class="inst-box warn" data-testid="inapp-box"><b>' + where + " 안에서 열려 있어요</b>" +
      "<p>여기서는 <b>홈 화면 추가</b>와 <b>알림</b>이 안 돼요. " + outName() + "로 열어 주세요.</p>" +
      (href ? '<a class="btn primary wide" href="' + href + '" data-testid="open-external">' + outName() + "로 열기</a>"
        : '<p class="inst-tip">오른쪽 위(또는 아래) <b>…</b> 메뉴에서 <b>' + outName() + "로 열기</b>를 누르세요.</p>") +
      "</div>";
  }

  window.WCInstall = {
    inApp: function () { return inTwa() ? "" : inApp(); }, inTwa: inTwa, standalone: standalone, browser: browser, isIos: isIos,
    externalHref: externalHref, outName: outName,
    canPrompt: function () { return !!deferred; },
    prompt: prompt, stepsHtml: stepsHtml, inAppBoxHtml: inAppBoxHtml,
    onChange: function (f) { listeners.push(f); },
    // 설치 안내가 필요한가(이미 홈 화면 앱으로 열었으면 필요 없음)
    needed: function () { return !standalone(); }
  };
})();
