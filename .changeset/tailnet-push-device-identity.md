---
"@gang-of-beads/pi-web": patch
---

Each push device now records the Tailscale identity that registered it, read from the headers `tailscale serve` adds and written only by the web/API process, so a browser cannot claim a tailnet user and a device list says whose device every row is. `push.allowedTailnetLogins` names the tailnet users whose devices may register: with the list empty the network stays the boundary, and once logins are named, a registration from anyone else, and one that arrives with no identity, is refused. A configured `push.subject` that push services refuse (a `localhost` address, an address with no domain) is replaced and said in the settings section and the session daemon's log, because a refused contact makes every device behind Apple's push service undeliverable while the device list looks healthy.
