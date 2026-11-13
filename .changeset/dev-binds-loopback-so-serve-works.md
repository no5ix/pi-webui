---
"@gang-of-beads/pi-web": patch
---

`pnpm run dev` starts again on a Mac where Tailscale Serve is set up for the dev
port. The UI was binding every interface on 8505, and Serve already owns that port
on the tailnet interface, so Vite died with `Port 8505 is already in use` while the
HTTPS mapping sat there proxying to nothing. The development server now listens on
`127.0.0.1:8505`, which is exactly where Serve forwards, and `http://localhost:8505`
and `https://<machine>.<tailnet>.ts.net:8505` answer the same UI - including `/api`
through the dev proxy. Stopping is dependable too: the serve mapping is removed
before the processes are stopped and confirmed against `tailscale serve status`, a
process that outlives its parent no longer keeps the mapping alive, and a watcher
clears the mapping if the command is killed before it can. Run
`pnpm run dev:client --host 0.0.0.0` to put the UI on every interface of a network
you trust.
