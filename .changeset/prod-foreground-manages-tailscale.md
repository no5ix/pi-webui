---
"@gang-of-beads/pi-web": patch
---

Add `pnpm run prod` as a built production foreground workflow. It builds the production assets, starts the compiled session daemon and web/API server without Vite or development watchers, and on macOS automatically starts Tailscale when needed and publishes the configured production HTTP port through Tailscale Serve HTTPS. The launcher removes only the mapping it created on shutdown and leaves the Tailscale application and tailnet connection running. Set `PI_WEB_PROD_SKIP_TAILSCALE=1` to skip automatic Tailscale setup.
