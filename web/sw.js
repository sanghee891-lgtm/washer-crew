/* 서비스 워커: 휴대폰 알림 받기와 알림을 눌렀을 때 장부 열기만 맡습니다(화면 파일은 저장해 두지 않아 항상 최신). */
// 인터넷이 끊겼을 때 보여 줄 안내 화면 하나만 저장(장부 화면은 항상 서버에서 최신으로)
var OFFLINE = "offline-v1";
self.addEventListener("install", function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(OFFLINE).then(function (c) { return c.add("offline.html"); }).catch(function () { /* 다음에 다시 */ }));
});
self.addEventListener("fetch", function (e) {
  if (e.request.mode !== "navigate") return; // 그 밖의 요청은 브라우저에 맡김
  e.respondWith(fetch(e.request).catch(function () {
    return caches.open(OFFLINE).then(function (c) { return c.match("offline.html"); }).then(function (r) {
      return r || new Response("인터넷 연결을 확인해 주세요.", { headers: { "content-type": "text/plain; charset=utf-8" } });
    });
  }));
});
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "세탁기 크루", {
    body: d.body || "",
    icon: "icons/icon-192.png",
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: d.url || "./" }
  }));
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    // 이미 열린 장부가 있으면 그 화면에서 해당 예약·요청을 열기
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.url.indexOf(self.registration.scope) === 0 && !/book\.html/.test(c.url) && "focus" in c) {
        c.postMessage({ url: url });
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
