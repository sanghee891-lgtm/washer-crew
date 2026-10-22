/* 서비스 워커: 휴대폰 알림 받기와 알림을 눌렀을 때 장부 열기만 맡습니다(화면 파일은 저장해 두지 않아 항상 최신). */
self.addEventListener("install", function () { self.skipWaiting(); });
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
