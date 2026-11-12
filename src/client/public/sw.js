/*
 * PI WEB's service worker.
 *
 * Its whole job is the notification a finished task leaves in the device's notification centre:
 * Safari on macOS and iOS only show a web notification that a service worker posted, so the
 * registration exists to own them. This file answers the tap: the reader is brought to the session
 * the notification spoke about, in a window that is already open when there is one.
 *
 * It is a classic script, not a module: Safari does not run module service workers, and this one
 * imports nothing - the payload arrives with the notification itself, so there is no API to call
 * back over once the page is gone.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUnsecured: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) return client.focus();
      }
      return self.openWindow(target);
    }),
  );
});

self.addEventListener("notificationclose", () => {
  // Nothing to keep: a dismissed notification carried its whole message.
});
