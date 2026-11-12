---
"@gang-of-beads/pi-web": patch
---

Post a device notification when the task in the open session finishes: which session, how long its task took, and a tap that opens the answer. Turn it on per device in Settings, new Notifications section, which reports what the browser allows separately from what the reader asked for, and offers a test notice. Notices are posted by the page through a service worker, so they arrive while the browser is running, including from a background tab; on iPhone and iPad Safari shows them to the installed web app. A task the reader stopped and a task that ends while the page is focused do not notify.
