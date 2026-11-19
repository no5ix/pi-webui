---
"@gang-of-beads/pi-web": patch
---

**Settings → Notifications** configures ntfy from the browser. The page now carries the whole
form: the server, the topic, the address a tap opens, which events send a notice at all, and a
button that turns the channel off. The topic is the sensitive one: a stored topic is never read
into the browser, so the box shows that one is stored, and leaving it empty writes no topic, which
keeps the stored value. A saved topic is not shown again in the field that saved it. The page also
says where a delivery failed in pi's own words - a topic ntfy rejects is a different sentence from
"the server did not answer", and a page that cannot reach PI WEB says so. The form's rules live in
one shared module, which the settings page the old UI uses now reads too, so the two pages cannot
drift on how a topic is kept.
