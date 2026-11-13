---
"@gang-of-beads/pi-web": patch
---

The "took" number is now the whole task, measured by the session daemon from the
prompt you sent to the last entry - not the span a browser happened to be watching.
A page that opened onto a two-hour run, a reload in the middle of it, and a phone
that never opened the page all read the same number, in the status line and in the
notification. Where an older daemon publishes no span, the page's own clock is used
and the number says so.
