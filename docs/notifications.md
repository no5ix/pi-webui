# Notifications

PI WEB raises browser notifications when a session needs the person who started it: the task they started finished, failed, stopped, or has been asking a question for longer than they have been looking at it. The notification arrives in the device's own notification centre, and its click opens PI WEB at the session the notice is about.

## What to expect

- **A task that ends** — a completion, a failure, a Stop, and a run the session daemon reports as interrupted.
- **A question that is waiting** — a pi extension's question card, a permission request, a plugin's card: any dialog the session is parked on. A card that asks several questions is described by how many are waiting; a dialog that asks one thing is reported as waiting for an answer.
- **Nothing else.** A notification about a task that was not started from the browser is reported to you as a session event, not shouted at you as a notification, and a page that is not running a task says so.

Task notices say what the task did and how long it took, measured between the start the session daemon reported and the end it reported. Where a task's end was never reported — a browser closed mid-task, a transcript with no recorded start — the notice says the end is unconfirmed and gives no duration. It never guesses one.

## Enable it

Open **Settings → Notifications**. The section shows, one line at a time, what is set: the notification permission, the server's push key, the devices registered on this server.

- **Request permission** — the browser shows its own permission prompt. PI WEB never sends a notification before it answers, and never asks again after it has.
- **Remember this device** (the push toggle) — registers this browser for notifications from the server. It needs the notification permission, a secure origin, and a server that has a push key pair.
- **Send a test notification** — delivers a real notification through the path you are testing. It says how many devices it reached, and says so when it reached none.

The page never asks the browser for permission on its own.

## On this device

Notifications work on the device that has PI WEB open, in the browser that granted permission, while that browser is running. The page posts them itself: a task that ends, a question that has waited long enough, and a permission request that arrived while you were away.

A notification carries the session it is about. Its click opens that session in the browser you are reading it in, in the same machine scope the session belongs to.

Two clocks measure a task, and they answer different questions. The status bar's running clock answers "how long has this been going?" — it ticks, it appears with the task, and it disappears when the task ends. The task record answers "how long did that task take?" — it is frozen at the moment the task ended, it survives a reload, and it is what a notification and the status bar's last-task line report. A long-running task, a session that goes idle, and a task that ended are three different facts, and each is shown on its own.

A task that ends while you are looking at its session, with the tab in front, is not sent you as a notification: you are already there, and a notification would be a second copy of what you are reading.

## On your other devices

Notifications reach every device you have registered on the server, including a phone that has PI WEB closed, through Web Push. The server sends one message per event; each registered device receives it.

A device is registered by that device, from that browser, by the push toggle. PI WEB never registers a device on its own, and one device's registration is never visible to another device.

### iPhone and iPad

1. Open PI WEB in **Safari** over the address you use, and add it to the Home Screen (**Share → Add to Home Screen**). Notifications on iOS go to an installed web app; Safari's tab alone will not take them.
2. Open the installed PI WEB, sign in, and open **Settings → Notifications**.
3. Tap **Request permission**, and accept the system prompt.
4. Turn on **Remember this device**. The device appears in the list with the address a notification will open.
5. Tap **Send a test notification**. The notification should arrive in the iPhone's notification centre.
6. Send a prompt, leave the app, and let the task finish: the completion notice arrives with the session's name, the verdict, and the time it took; tapping it opens that session.

Push on iOS requires HTTPS. A plain-HTTP address, including a LAN address, is refused at registration — the browser refuses it first, and the server refuses it again, because a stored registration that cannot deliver is worse than a refused one.

### Android, desktop, and any other browser

The same four steps: open PI WEB, grant the permission, turn on the toggle, send a test. Chromium browsers on Android take push in a tab, and do not require the app to be installed. A browser you have never opened PI WEB in cannot register, and a browser whose site data you clear forgets its registration; the device drops off the list the next time the server pushes to it and the push service says the address is gone.

Each row of the list says what the server knows about that device: what it is (`Safari on iPhone`), whose tailnet login registered it, which push service carries it, when that service last accepted a message for it, and - kept beside a later acceptance - the last refusal with its status and the service's own reason. Every row has **Test**, which sends to that device alone, and **Remove**, which forgets that one address and leaves the others registered. A list of four devices is diagnosed one row at a time, and a phone that answers while a laptop is refused is two facts, not one average.

The device list is this server's list. It is not a device's own list, and a device that is on it is a device that can be woken — deleting an entry is a device's "stop notifying me". The list is honest about what it cannot see: when the server cannot read its own push file, the list says so and says that devices registered earlier are missing from it, rather than saying that no device is registered.

A push identity belongs to one server. Reinstalling PI WEB, deleting `$PI_WEB_DATA_DIR/push/vapid.json`, or a key file the daemon cannot parse mints a new identity, and every device registered under the old one is then refused by the push service. The settings section says the key changed and offers **Register this device again** — a browser hands back the subscription it already has, so only a new registration can follow the server. The unreadable file is kept beside the new one as `vapid.json.unreadable-<time>`, which is how an operator who owns their key material puts it back.

## Deduplication

Both paths — the page that has the session open, and the push message that wakes a device — put the same key on the same event: the session and its verdict. A device that receives both shows one notification, and the newest notice of a kind replaces the older one of the same kind, so a session that finishes twice leaves one finished notice on the screen, not a stack. The event's own identity rides alongside the key, unique per run, and it is what the server logs and deduplicates.

The key is coarser than the run on purpose: a page on a laptop and a session daemon on a server are two clocks, and a key built from the moment a run ended is a key the two paths mint apart — a key that deduplicates nothing.

The page suppresses its own copy of a task notice only for the session the reader is looking at, with that tab in front: what a reader sees twice is a copy, and what they do not see is not one. A session's asking notice carries every question that is waiting on it, and answering the last of them takes the notice back on both paths.

## Configuration

Push is on by default and needs no configuration: on the first start the session daemon writes a VAPID key pair to `$PI_WEB_DATA_DIR/push/vapid.json` and every device registered with this server is sent through it. The private key is never in the browser-facing config, in a plugin's config, in a log line, or in a URL.

To put the keys in the global config yourself — to give several instances one identity, or to keep the key material in your own store — set both halves. See [the push key reference](config.md#mobile-push-notifications).

```json
{
  "push": {
    "enabled": true,
    "vapidPublicKey": "BKdf…",
    "vapidPrivateKey": "{\"kty\":\"EC\",…}",
    "subject": "mailto:you@example.com",
    "ttlSeconds": 3600
  }
}
```

`enabled: false` closes the feature: nothing is sent, no device is registered (a server with push off stores no device address), and the settings section says the server has push off. A device can still leave a server that has push turned off.

`ttlSeconds` bounds how long a push service may hold a message for a device that is offline: an integer from 0 to 604800 seconds (seven days), **86400 - one day - by default**. The short default the push services advertise for "bulk" traffic is the reason a phone that was asleep received nothing an hour later: PI WEB sends at high urgency with a day's window, so a device that comes back within the day is told.

`subject` is the contact the push services see in the signed assertion. Apple refuses a contact it cannot resolve - `mailto:pi-web@localhost` is answered with `403 BadJwtToken`, and every device behind Apple Orange refuses the message - so the default is `https://github.com/Gang-of-Beads/pi-web`, and a configured subject that is a dotless address, a `localhost` address, or a credential-bearing URL is replaced by the default and said in the session daemon's log and in the settings section. Set it to an address you own if you want push services to be able to reach you about this server.

`allowedTailnetLogins` names the tailnet users whose devices may register:

```json
{
  "push": {
    "allowedTailnetLogins": ["you@example.com", "partner@github"]
  }
}
```

With the list empty - the default - the network is the boundary, as it is for the rest of PI WEB, and every device that reaches the server may register. Once logins are named, a registration from a Tailscale identity outside the list is refused, and a device that arrives with no identity is refused too, because an allowlist that named people cannot be satisfied by a device that arrived with no name. The identity is read from the `Tailscale-User-Login` header `tailscale serve` adds (see [Remote access](install.md#remote-access)), and a browser that sends that header itself is ignored: only the web process, the process Tailscale faces, writes the identity the session daemon is shown. The login is stored with the device, which is what makes the device list say whose device each row is.

## Privacy

PI WEB never sends a prompt, a response, a file path, a command, or a tool name in a push message. A push notification carries:

- the session's title, which is a name the reader gave or the first prompt's first line
- the project's folder name, which is the folder the session is in
- the verdict, the measured duration, and - for a questionnaire - a question count
- the event's identity: the session id, the moment the daemon decided the run ended, and the verdict
- the device's own saved application address with the session id appended, so the notification can be tapped

A failed run's notice says that it failed, how long it ran, and to open PI WEB. It never carries pi's own error text: a runtime message can contain a prompt, a file path, a command, or a tool argument, and a push message leaves the machine and sits on a push service on its way to a pocket. The reason is shown where the facts are — in the session, on a page that already has them.

The session id is not a secret and the address is the one that device registered with. A device's registration is stored on the server it registered with, in the PI WEB data directory, and contains the push service's address for that device and the keys the encryption needs.

That address and those keys never leave the server: the settings section shows a device's label, its push service's host, the tailnet login that registered it, and what the service answered - and a page that held the address and the keys could send to that device by itself, so it is not given them. A device's row is a name and a history, not a credential.

The push message's body is encrypted end to end between this server and the device's browser (RFC 8291 and RFC 8292): the push service relays ciphertext, and the payload limit - 4 KB, kept under the smallest limit any service documents - is enforced before sending, with a clipped form used when a title is long enough to overflow it.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| "Notification permission has not been granted on this device." | The browser's permission prompt was never answered, or was dismissed. Open Settings → Notifications and request it. |
| "The server has no push key pair, and could not create one." | The session daemon could not write `$PI_WEB_DATA_DIR/push/vapid.json`, or the configured key pair is broken. The settings line says which. |
| "This browser has no push support." | The browser has no Push API — Firefox on iOS has none, and plain HTTP disables it everywhere. |
| "PI WEB must be served over HTTPS to register this device." | A non-secure origin. Reach the server over HTTPS, or use a tunnel that terminates TLS. |
| "This browser is not installed as an app." | iOS refuses push to a Safari tab. Add PI WEB to the Home Screen and open it from there. |
| The device appears in the list, nothing arrives | The push service is dropping the message. Check `Send a test notification`: it reports the push service's answer, and a device whose address the service has revoked is removed from the list on the spot. |
| "The server cannot read its push file" | `$PI_WEB_DATA_DIR/push/subscriptions.json` is unreadable (corrupt, owned by another user, on a full disk). The server refuses to write over a file it cannot read, so nothing is lost while it is looked at. Fix the file and the list comes back. |
| Apple devices answer `BadJwtToken`, and the settings section reports `403 BadJwtToken` on the row | The `subject` is a contact Apple refuses - a `localhost` address, an address with no domain. The current default is a URL; set `push.subject` to a contact you own. The session daemon logs the refusal when it starts. |
| Chromium devices on desktop time out while iPhone and Android receive fine | Windows' push service (WNS) is reachable over IPv6 on hosts whose IPv6 is broken in the way that black-holes rather than refuses. PI WEB sends over IPv4 first and remembers the family that worked per push service host; a network that is IPv6-only is served by the fallback. |
| Every device stopped receiving after a reinstall, a restore, or a moved data directory | The server minted a new push identity. The settings section says so: use **Register this device again** on each device, or restore the key file from `vapid.json.unreadable-<time>`. |
| "Pick a session first" when sending a test push | A push notice is about one session and opens it when tapped, so a test push is sent with the session you have selected. |
| Nothing at all, on every device | Check the server: the settings section's first line says whether push is enabled, configured, and how many devices are registered. The session daemon log records each event it sent, and to how many devices. |
| A desktop browser says it has no push notifications | Some browsers ship without a push service of their own, and PI WEB registers nothing when the browser has none. On macOS that means Safari (in an installed web app), Chrome, or Firefox; on iPhone and iPad it means the web app added to the Home Screen. |
| You want to find out where a notification stopped, on your own machine | [CONTRIBUTING.md](../CONTRIBUTING.md#testing-device-notifications-on-a-device) runs an isolated PI WEB of its own - its own port, device list and push key - and prints what each device's push service answered. The server's own log says `0 of N device(s) accepted by their push service`, then each device's status and the reason that service gave. |

A tap opens the session by its id, in the PI WEB the tap landed on. A session that lives on a remote fleet machine is therefore opened by that id in the local machine's list, which is not the same session; PI WEB does not carry a machine scope in the event, so a remote session is best reached from the page it is open in. This is a known limitation of the current tap target.

Push traffic is not proxied by PI WEB. The session daemon sends directly to each push service the browser named, and the response from that service is what the settings section reports.
