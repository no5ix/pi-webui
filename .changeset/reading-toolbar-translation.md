---
"@gang-of-beads/pi-web": patch
---

Read a transcript in place: double-click a word for a small toolbar over it (copy it, search for it, translate it), and press and hold a sentence to see its translation written under the sentence. Translation is answered by PI WEB's web process through the new `translation` config section, which sets the target language (Simplified Chinese by default), points the request at a mirror of your own with `baseUrl`, or turns it off with `provider: "off"`. This replaces what a browser userscript did outside the page, which cannot reach the transcript.
