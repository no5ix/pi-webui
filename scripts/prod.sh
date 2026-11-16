#!/usr/bin/env bash
# Production foreground stack with the same Tailscale lifecycle as scripts/dev.sh.
# Starts the built session daemon and web/API server (no Vite or file watchers).
set -uo pipefail

PROD_PORT="${PI_WEB_PROD_TAILSCALE_PORT:-8504}"
PROD_HOST_SUFFIX="${PI_WEB_PROD_TAILSCALE_HOST_SUFFIX:-.ts.net}"
READY_TIMEOUT="${PI_WEB_PROD_TAILSCALE_WAIT_SECONDS:-120}"
BACKEND_TIMEOUT="${PI_WEB_PROD_BACKEND_WAIT_SECONDS:-90}"
STOP_GRACE="${PI_WEB_PROD_STOP_GRACE_SECONDS:-5}"
HOST_SUFFIX="${PI_WEB_PROD_TAILSCALE_HOST_SUFFIX:-.ts.net}"
children=()
serve_mapping_mine=false
serve_owner_file=""
cleanup_ran=false
stop_signals=0

say() { printf 'prod: %s
' "$*"; }
trouble() { printf 'prod: %s
' "$*" >&2; }

tailnet_ready() {
  tailscale status --json </dev/null 2>/dev/null | node -e '
let text = "";
process.stdin.on("data", (chunk) => { text += chunk; });
process.stdin.on("end", () => {
  try {
    const status = JSON.parse(text);
    const self = status.Self || {};
    const addresses = [self.TailscaleIPs, self.DNSNames].filter(Array.isArray);
    process.exit(status.BackendState === "Running" && addresses.some((list) => list.length > 0) ? 0 : 1);
  } catch { process.exit(1); }
});'
}

process_running() {
  local state
  state="$(ps -o stat= -p "$1" 2>/dev/null | tr -d ' ')"
  case "$state" in ""|Z*) return 1 ;; *) return 0 ;; esac
}

descendants() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    descendants "$child"
    printf '%s
' "$child"
  done
}

signal_children() {
  local signal="$1" pid child pgid
  for pid in "${children[@]+"${children[@]}"}"; do
    for child in $(descendants "$pid"); do kill -"$signal" "$child" 2>/dev/null; done
    kill -"$signal" "$pid" 2>/dev/null
  done
  pgid="$(ps -o pgid= -p "$$" 2>/dev/null | tr -d ' ')"
  [ -z "$pgid" ] || pkill -"$signal" -g "$pgid" 2>/dev/null || true
}

serve_mapping_state() {
  local status
  if ! status="$(tailscale serve status </dev/null 2>&1)"; then
    [ -n "$status" ] && trouble "$status"
    return 2
  fi
  printf '%s
' "$status" | grep -qE -- ":${PROD_PORT}([[:space:]]|\$)" && return 1
  return 0
}

remove_serve_mapping() {
  [ "$serve_mapping_mine" = true ] || return 0
  serve_mapping_mine=false
  trap '' INT TERM
  local attempt output state
  for attempt in 1 2 3; do
    output="$(tailscale serve --https="$PROD_PORT" off </dev/null 2>&1)"
    state=0
    serve_mapping_state || state=$?
    if [ "$state" = 0 ]; then
      sleep 1
      state=0
      serve_mapping_state || state=$?
      if [ "$state" = 0 ]; then
        [ -z "$serve_owner_file" ] || rm -f "$serve_owner_file"
        return 0
      fi
    elif [ "$state" = 2 ]; then
      trouble "could not confirm Tailscale Serve cleanup; inspect with: tailscale serve status"
      return 0
    fi
  done
  trouble "Tailscale Serve mapping may remain on port $PROD_PORT${output:+: $output}; clear it with: tailscale serve --https=$PROD_PORT off"
}

start_watchdog() {
  local owner_file="$1" parent="$$"
  set -m
  (
    trap '' HUP INT TERM
    while :; do
      local state command
      state="$(ps -o stat= -p "$parent" 2>/dev/null | tr -d ' ')"
      case "$state" in ""|Z*) break ;; esac
      command="$(ps -o command= -p "$parent" 2>/dev/null)"
      case "$command" in *"scripts/prod.sh"*|*"bash scripts/prod.sh"*) : ;; *) break ;; esac
      sleep 1
    done
    [ "$(cat "$owner_file" 2>/dev/null)" = mine ] || exit 0
    tailscale serve --https="$PROD_PORT" off </dev/null >/dev/null 2>&1
    rm -f "$owner_file"
  ) &
  set +m
}

cleanup() {
  [ "$cleanup_ran" = true ] && return 0
  cleanup_ran=true
  trap '' INT TERM
  remove_serve_mapping
  [ "${#children[@]}" -eq 0 ] || {
    signal_children TERM
    local waited=0 alive=true
    while [ "$waited" -lt "$STOP_GRACE" ]; do
      alive=false
      for pid in "${children[@]}"; do process_running "$pid" && alive=true; done
      [ "$alive" = true ] || break
      sleep 1
      waited=$((waited + 1))
    done
    if [ "$alive" = true ]; then signal_children KILL; fi
  }
}

on_signal() {
  stop_signals=$((stop_signals + 1))
  if [ "$stop_signals" -gt 1 ]; then
    remove_serve_mapping
    signal_children KILL
    trap - INT TERM EXIT
    kill -KILL 0 2>/dev/null
    exit 130
  fi
  cleanup
  exit 130
}

wait_for_sessiond() {
  local waited=0 socket="${PI_WEB_SESSIOND_SOCKET:-${PI_WEB_DATA_DIR:-$HOME/.pi-web}/sessiond.sock}"
  case "$socket" in /*) : ;; *) socket="$PWD/$socket" ;; esac
  while [ "$waited" -lt "$BACKEND_TIMEOUT" ]; do
    if node -e '
const net = require("node:net");
const socket = net.createConnection(process.argv[1]);
socket.setTimeout(1000);
socket.once("connect", () => { socket.destroy(); process.exit(0); });
socket.once("error", () => process.exit(1));
socket.once("timeout", () => { socket.destroy(); process.exit(1); });
' "$socket" >/dev/null 2>&1; then return 0; fi
    process_running "${children[0]}" || { trouble "session daemon exited before becoming ready"; return 1; }
    sleep 1
    waited=$((waited + 1))
  done
  trouble "session daemon did not become ready within ${BACKEND_TIMEOUT}s"
  return 1
}

wait_for_web() {
  local waited=0
  while [ "$waited" -lt "$BACKEND_TIMEOUT" ]; do
    if curl -fsS --max-time 1 "http://127.0.0.1:${PI_WEB_PORT:-8504}/api/config" >/dev/null 2>&1; then return 0; fi
    process_running "${children[1]}" || { trouble "web/API server exited before becoming ready"; return 1; }
    sleep 1
    waited=$((waited + 1))
  done
  trouble "web/API server did not become ready within ${BACKEND_TIMEOUT}s"
  return 1
}

main() {
  trap on_signal INT
  trap on_signal TERM
  trap cleanup EXIT

  if [ "$(uname -s)" = Darwin ] && [ "${PI_WEB_PROD_SKIP_TAILSCALE:-}" != 1 ]; then
    command -v tailscale >/dev/null 2>&1 || { trouble "Tailscale CLI not found. Install Tailscale, or set PI_WEB_PROD_SKIP_TAILSCALE=1."; return 1; }
    if ! tailnet_ready; then
      say "Tailscale is not connected; opening the Tailscale application"
      open -a Tailscale </dev/null >/dev/null 2>&1 || { trouble "could not open Tailscale; connect it manually or set PI_WEB_PROD_SKIP_TAILSCALE=1"; return 1; }
      local waited=0
      while [ "$waited" -lt "$READY_TIMEOUT" ]; do
        sleep 2
        waited=$((waited + 2))
        tailnet_ready && break
      done
    fi
    tailnet_ready || { trouble "Tailscale did not connect within ${READY_TIMEOUT}s"; return 1; }

    serve_owner_file="$(mktemp "${TMPDIR:-/tmp}/pi-web-prod-serve.XXXXXX")" || serve_owner_file=""
    say "publishing production HTTP port ${PI_WEB_PORT:-8504} as Tailscale HTTPS :$PROD_PORT"
    if serve_mapping_state; then
      :
    else
      local mapping_state=$?
      if [ "$mapping_state" = 1 ]; then trouble "Tailscale Serve already has a handler on port $PROD_PORT; leaving the existing mapping untouched."; return 1; fi
      trouble "could not inspect existing Tailscale Serve configuration"; return 1
    fi
    tailscale serve --bg --https="$PROD_PORT" "http://127.0.0.1:${PI_WEB_PORT:-8504}" </dev/null || { trouble "Tailscale Serve setup failed"; return 1; }
    serve_mapping_mine=true
    if [ -n "$serve_owner_file" ]; then printf 'mine
' >"$serve_owner_file"; start_watchdog "$serve_owner_file"; fi
  else
    say "skipping automatic Tailscale setup"
  fi

  if [ ! -f dist/server/sessiond.js ] || [ ! -f dist/server/index.js ]; then
    trouble "production build not found; run pnpm run build first"
    return 1
  fi

  node dist/server/sessiond.js &
  children+=("$!")
  wait_for_sessiond || return 1

  node dist/server/index.js &
  children+=("$!")
  wait_for_web || return 1
  say "production PI WEB is ready at http://127.0.0.1:${PI_WEB_PORT:-8504}"
  if [ "$(uname -s)" = Darwin ] && [ "${PI_WEB_PROD_SKIP_TAILSCALE:-}" != 1 ]; then
    say "Tailscale HTTPS is available on port $PROD_PORT"
  fi

  while :; do
    local alive=true
    for pid in "${children[@]}"; do
      process_running "$pid" || { alive=false; break; }
    done
    [ "$alive" = true ] || { trouble "a production process exited; shutting down"; return 1; }
    sleep 1
  done
}

main
exit_code=$?
cleanup
exit "$exit_code"
