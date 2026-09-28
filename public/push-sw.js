self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* invalid payload */ }
  event.waitUntil(self.registration.showNotification(data.title || "إشعار من ترجمان", {
    body: data.body || "لديك إشعار جديد",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { link: data.link || "/app/notifications" }
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = new URL(event.notification.data?.link || "/app/notifications", self.location.origin);
  if (link.origin !== self.location.origin) return;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
    const open = clients.find((client) => new URL(client.url).origin === self.location.origin);
    if (open) { await open.navigate(link.href); return open.focus(); }
    return self.clients.openWindow(link.href);
  }));
});
