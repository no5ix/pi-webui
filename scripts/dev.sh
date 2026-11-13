#!/usr/bin/env bash
# The whole development stack in one command, with the Tailscale HTTPS mapping that reaches it.
#
# `pnpm run dev` is the regular development workflow (owner, 2026-11-13): the stack is read from a
# phone on the tailnet, so its HTTPS mapping has to exist before the UI starts listening and be gone
# the moment the stack stops. This script owns exactly that mapping. It never runs `tailscale down`,
# never changes the node's Tailnet membership, never touches a global npm install or LaunchAgents,
# and leaves the Tailscale application running when it found it running already.
#
# Shutdown is the same on every exit path - Ctrl+C, a child dying, a signal, a failed start: the
# processes this script started are terminated with their descendants, the serve mapping is removed,
# and port 8505 is left free. PI WEB in daemon mode is untouched by any of this.
#
# Runs under the system bash (3.2 on macOS): no associative arrays, no `wait -n`.
set -uo pipefail

DEV_PORT="${PI_WEB_DEV_TAILSCALE_PORT:-8505}"
TAILSCALE_READY_TIMEOUT_SECONDS="${PI_WEB_DEV_TAILSCALE_WAIT_SECONDS:-120}"
STOP_GRACE_SECONDS="${PI_WEB_DEV_STOP_GRACE_SECONDS:-5}"
TAILSCALE_HOST_SUFFIX="${PI_WEB_DEV_TAILSCALE_HOST_SUFFIX:-.ts.net}"

# The phases, in one place: boot -> tailscale -> running -> stopping -> stopped. A start step that
# gives up leaves the phase where it failed, so the exit path knows what it has to undo - the serve
# mapping is removed only when this script made it, and the Tailscale application is left alone
# because taking a Mac off its tailnet is not this command's business.
phase=boot
children=()
serve_mapping_mine=false
stop_signals=0
cleanup_ran=false

say() { printf 'dev: %s\n' "$*"; }
trouble() { printf 'dev: %s\n' "$*" >&2; }

tailscale_platform() {
  [ "$(uname -s)" = "Darwin" ]
}

tailnet_ready() {
  tailscale status --json </dev/null 2>/dev/null | node -e '
let text = "";
process.stdin.on("data", (chunk) => { text += chunk; });
process.stdin.on("end", () => {
  try {
    const status = JSON.parse(text);
    const self = status.Self || {};
    const addresses = [self.TailscaleIPs, self.DNSNames].filter((list) => Array.isArray(list));
    const reachable = addresses.some((list) => list.length > 0);
    process.exit(status.BackendState === "Running" && reachable ? 0 : 1);
  } catch {
    process.exit(1);
  }
});'
}

# Every process under one pid, deepest first, so a parent is never killed before the children it
# would otherwise orphan: `pnpm run dev:web` is a chain (pnpm, sh -c, tsx watch, node) and killing
# only its head is how a surviving watcher keeps port 8505.
descendants() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    descendants "$child"
    printf '%s\n' "$child"
  done
}

signal_tree() {
  local signal="$1" pid
  local -a pids=()
  for pid in "${children[@]+"${children[@]}"}"; do
    for child in $(descendants "$pid"); do
      pids+=("$child")
    done
    pids+=("$pid")
  done
  for pid in "${pids[@]+"${pids[@]}"}"; do
    kill -"$signal" "$pid" 2>/dev/null
  done
}

children_alive() {
  local pid
  for pid in "${children[@]+"${children[@]}"}"; do
    if kill -0 "$pid" 2>/dev/null; then return 0; fi
  done
  return 1
}

stop_children() {
  [ "${#children[@]}" -eq 0 ] && return 0
  say "stopping the ${#children[@]} development processes"
  signal_tree TERM
  local waited=0
  while [ "$waited" -lt "$STOP_GRACE_SECONDS" ]; do
    children_alive || return 0
    sleep 1
    waited=$((waited + 1))
  done
  say "the processes ignored the stop; ending them"
  signal_tree CONT
  signal_tree KILL
}

tailscale_serve_off() {
  [ "$serve_mapping_mine" = true ] || return 0
  serve_mapping_mine=false
  say "removing the tailscale serve mapping for https on ${DEV_PORT}"
  if ! tailscale serve --https="$DEV_PORT" off </dev/null >/dev/null 2>&1; then
    trouble "could not remove the tailscale serve mapping; clear it with: tailscale serve --https=${DEV_PORT} off"
  fi
}

# The undo, run once, whatever ended the command: a child dying, Ctrl+C, a signal, a failed start.
cleanup() {
  [ "$cleanup_ran" = true ] && return 0
  cleanup_ran=true
  phase=stopping
  stop_children
  tailscale_serve_off
  phase=stopped
}

# Ctrl+C twice stops waiting: a child that will not die must not trap the reader at a prompt.
on_stop_signal() {
  local code="$1"
  stop_signals=$((stop_signals + 1))
  if [ "$stop_signals" -gt 1 ]; then
    trouble "second stop request: ending this process group without waiting"
    trap - INT TERM EXIT
    kill -KILL 0 2>/dev/null
    exit "$code"
  fi
  cleanup
  exit "$code"
}

start_children() {
  pnpm run dev:sessiond &
  children+=("$!")
  pnpm run dev:web &
  children+=("$!")
  pnpm run dev:client &
  children+=("$!")
}

# A child that dies takes the stack down: a UI over a half-started stack reads as a broken UI, and a
# serve mapping pointing at nothing reads as a Tailscale problem.
watch_children() {
  while :; do
    local pid
    for pid in "${children[@]}"; do
      if ! kill -0 "$pid" 2>/dev/null; then
        say "a development process (${pid}) exited; stopping the rest"
        return 1
      fi
    done
    sleep 1
  done
}

start_tailscale_application() {
  if tailnet_ready; then
    say "tailscale is already connected"
    return 0
  fi
  say "tailscale is not connected; opening the Tailscale application"
  if ! open -a Tailscale </dev/null >/dev/null 2>&1; then
    trouble "the Tailscale application did not open. Install it (https://tailscale.com/download/mac), or run the stack without it: PI_WEB_DEV_SKIP_TAILSCALE=1 pnpm run dev"
    return 1
  fi
  local waited=0
  while [ "$waited" -lt "$TAILSCALE_READY_TIMEOUT_SECONDS" ]; do
    sleep 2
    waited=$((waited + 2))
    if tailnet_ready; then
      say "tailscale is connected after ${waited}s"
      return 0
    fi
  done
  trouble "tailscale did not report a connected tailnet within ${TAILSCALE_READY_TIMEOUT_SECONDS}s. Sign in to the Tailscale application, or run the stack without it: PI_WEB_DEV_SKIP_TAILSCALE=1 pnpm run dev"
  return 1
}

apply_serve_mapping() {
  say "tailscale serve --bg --https=${DEV_PORT} http://127.0.0.1:${DEV_PORT}"
  if ! tailscale serve --bg --https="$DEV_PORT" "http://127.0.0.1:${DEV_PORT}" </dev/null; then
    trouble "tailscale serve refused the https mapping on ${DEV_PORT}. Check 'tailscale serve status', or run the stack without it: PI_WEB_DEV_SKIP_TAILSCALE=1 pnpm run dev"
    return 1
  fi
  serve_mapping_mine=true
}

# The dev server is asked by the tailnet's own host name, which Vite refuses by default. The suffix
# goes in through the existing PI_WEB_ALLOWED_HOSTS override, so no tailnet name is written into the
# repository, and it is exported only into this development session's environment.
allow_tailnet_hosts() {
  local current="${PI_WEB_ALLOWED_HOSTS:-}"
  case "$current" in
    *"$TAILSCALE_HOST_SUFFIX"*) return 0 ;;
  esac
  if [ -z "$current" ]; then
    PI_WEB_ALLOWED_HOSTS="$TAILSCALE_HOST_SUFFIX"
  else
    PI_WEB_ALLOWED_HOSTS="${current},${TAILSCALE_HOST_SUFFIX}"
  fi
  export PI_WEB_ALLOWED_HOSTS
  say "the dev server will answer host names ending in ${TAILSCALE_HOST_SUFFIX}"
}

main() {
  trap 'on_stop_signal 130' INT
  trap 'on_stop_signal 143' TERM
  trap 'cleanup' EXIT

  if ! tailscale_platform; then
    say "tailscale serve is a macOS step and this is $(uname -s): the stack runs without it"
    phase=running
  elif [ "${PI_WEB_DEV_SKIP_TAILSCALE:-}" = "1" ]; then
    say "PI_WEB_DEV_SKIP_TAILSCALE is set: the stack runs without a tailscale serve mapping"
    phase=running
  else
    phase=tailscale
    if ! command -v tailscale >/dev/null 2>&1; then
      trouble "the tailscale command is not installed. Install Tailscale (https://tailscale.com/download/mac), or run the stack without it: PI_WEB_DEV_SKIP_TAILSCALE=1 pnpm run dev"
      return 1
    fi
    start_tailscale_application || return 1
    if ! tailnet_ready; then
      trouble "tailscale is not connected to a tailnet; connect it, or run the stack without it: PI_WEB_DEV_SKIP_TAILSCALE=1 pnpm run dev"
      return 1
    fi
    apply_serve_mapping || return 1
    allow_tailnet_hosts
    phase=running
  fi

  say "starting the session daemon, the web/API process, the Vite UI and the plugin watchers"
  start_children
  watch_children
  return $?
}

main
exit_code=$?
cleanup
exit "$exit_code"
