---
"@gang-of-beads/pi-web": patch
---

PI WEB now notifies your other devices. Settings → Notifications has a **Remember this device** switch and a device list, and a phone that has PI WEB added to the Home Screen is notified through Web Push when a task ends or a question is waiting, even with PI WEB closed. The server generates its own push key on first start, so there is nothing to configure; a task notice says the session's name, the verdict, and how long it took, and tapping it opens that session. Notification permission is still asked for by you, once, per device.

The status bar now reports the task that just finished — how long it ran, and whether it completed, failed, or was stopped — and keeps that reading across a reload. A task that never reported its end is reported as unconfirmed, with no duration.

The down arrow above the composer gained a partner. The new up arrow jumps to the last prompt you sent; the down arrow jumps to the next assistant answer, over the tool runs and thinking rows in the way, and to the newest message when there is no answer below.

The device list tells the truth about what it can and cannot see: it reports what the push service said about the last attempt at each device, says when the server cannot read its own push file instead of claiming that no device is registered, and offers **Register this device again** when the server's push key has changed and old registrations can no longer be delivered. A failed task's notice says that it failed, how long it ran, and to open PI WEB; the reason itself stays in the session, because a push message passes through a push service and a runtime error can carry a prompt, a file path, a command, or a tool argument.
