---
"@gang-of-beads/pi-web": patch
---

PI WEB now tells you about three events - a task finished, a task failed, and a
session asking you for an answer - on two channels you switch on separately: this
browser, and ntfy. ntfy is posted by the session daemon, so it reaches a phone
whose browser is closed; set the server, the topic and the switches in
**Settings → Notifications**, which shows whether the channel is ready and sends a
test notice that reports what the server answered. The topic is a bearer secret, so
it is never sent to a browser and is cut out of logs and failure messages; the panel
keeps the stored topic when you save the switches without it, and clearing it is a
separate "Stop using this topic" action. The test notice goes to the server and
topic the panel is showing, not to a previously saved pair. A notification never
blocks a task, and a dead channel never stops the other one: a task does not wait
on a notice, and a browser whose notification centre refuses one says so on the
page instead. A run you stopped yourself is not announced.
