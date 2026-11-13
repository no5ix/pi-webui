/*
 * PI WEB's service worker.
 *
 * Its job is the notification centre: Safari on macOS and iOS shows no web notification that a
 * service worker did not post, so the registration exists to own them - and it is also the only party
 * that can receive a push message when no PI WEB page is open, which is what a phone in a pocket
 * needs.
 *
 * It is a classic script, not a module: Safari does not run module service workers, and this one
 * imports nothing. A page-posted notice carries its whole message with it. A push message carries its
 * whole message too, encrypted to this device, so there is no API to call back over once the page is
 * gone - and the payload's `tag` is the event's id, which is what makes the page's own notice and a
 * push delivery of the same event one notification on a device that gets both.
 *
 * A tap answers the question the notification raised: it opens the session it speaks about, in a
 * window that is already open when there is one. The address arrives with the notification, because
 * the device - not the server - knows the host, port, path prefix and Tailscale address it uses.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = null;
  try {
    payload = event.data && event.data.json();
  } catch (error) {
    payload = null;
  }
  const notice = payload && payload.notification;
  if (!notice || !notice.title) {
    // A message with nothing to show is not a notification. Answering it keeps the push service
    // from believing the device was woken for a notice that was never made.
    event.waitUntil(Promise.resolve());
    return;
  }
  event.waitUntil(
    self.registration.showNotification(notice.title, {
      body: notice.body || "",
      tag: notice.tag || "pi-web",
      data: { url: notice.url || "./" },
      icon: iconUrl(),
      badge: iconUrl(),
      silent: false,
    }),
  );
});

/*
 * The push service expired this device's subscription. The browser offers the new address to nobody
 * but the service worker, so the worker asks the browser for one minted with this server's VAPID key
 * and registers it. A subscription that cannot be replaced is unsubscribed: an address the sender
 * holds and the browser will never wake again is a device the reader thinks is notified.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    fetch(pushStateUrl().toString(), { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("push state unavailable"))))
      .then((state) => {
        const publicKey = state && state.publicKey;
        if (!publicKey) return Promise.reject(new Error("no VAPID public key"));
        return self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) });
      })
      .then((subscription) => {
        const json = subscription.toJSON();
        return fetch(subscriptionRegisterUrl().toString(), {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            endpoint: json.endpoint,
            keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
            appBaseUrl: appBaseUrl(),
            userAgent: self.navigator ? self.navigator.userAgent : "",
          }),
        });
      })
      .catch(() => self.registration.pushManager.getSubscription().then((subscription) => (subscription ? subscription.unsubscribe() : undefined))),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "./";
  const wanted = absolute(target);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUnsecured: true }).then((clients) => {
      // A window already showing this app is focused, and navigated when the notification speaks
      // about a different session: a reader who taps "3 questions are waiting" expects the questions.
      let appWindow = null;
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          if (!appWindow) appWindow = client;
          if (client.url === wanted) return client.focus();
        }
      }
      if (appWindow) return "navigate" in appWindow ? appWindow.navigate(wanted).then(() => appWindow.focus()) : appWindow.focus();
      return self.openWindow(wanted);
    }).catch(() => self.openWindow(wanted)),
  );
});

self.addEventListener("notificationclose", () => {
  // Nothing to keep: a dismissed notification carried its whole message, and the event's id rode with
  // it as its tag, so a page that learns the question was answered closes the notice by that tag.
});

function iconUrl() {
  return absolute("pwa-icon-192.png");
}

function pushStateUrl() {
  return new URL("api/push/state", self.location);
}

function subscriptionRegisterUrl() {
  return new URL("api/push/subscriptions", self.location);
}

function appBaseUrl() {
  const path = self.location.pathname;
  return `${self.location.origin}${path.slice(0, path.lastIndexOf("/") + 1)}`;
}

function absolute(value) {
  try {
    return new URL(value, self.location).toString();
  } catch (error) {
    return self.location.origin;
  }
}

function base64UrlToBytes(value) {
  const padded = String(value).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(value).length / 4) * 4, "=");
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}
