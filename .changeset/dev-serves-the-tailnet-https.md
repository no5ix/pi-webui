---
"@gang-of-beads/pi-web": patch
---

`pnpm run dev` on a Mac in a tailnet now publishes the development server over
Tailscale HTTPS (`https://<machine>.<tailnet>.ts.net:8505`) and lets the dev server
answer `.ts.net` host names, which is what makes a phone on cellular reach the dev
UI over HTTPS - the address browser notifications need. It starts Tailscale's app if
it is not running, waits for the interface, and on `Ctrl+C` stops everything it
started and removes the serve mapping it created. It never takes Tailscale down,
never disconnects the machine, and leaves the app running if it was already. Where
there is no tailnet, it runs the plain development stack and says so;
`PI_WEB_DEV_SKIP_TAILSCALE=1` skips it.
