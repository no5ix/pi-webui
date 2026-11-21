---
"@gang-of-beads/pi-web": patch
---

Draw plugin code fences in the React transcript.

A fenced block whose language a plugin claims is now handed to that plugin in the React
conversation, and the plain code block the reader typed stands in while the plugin draws and
after it refuses. Markdown is still sanitized the same way; only a claimed fence leaves the
sanitizer's path.
