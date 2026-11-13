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
# The serve watchdog's ceiling: it exists to clear the mapping when the supervisor dies, and a bounded
# life keeps a confused process table from keeping one alive forever.
WATCHDOG_LIFETIME_SECONDS="${PI_WEB_DEV_WATCHDOG_SECONDS:-180}"
TAILSCALE_HOST_SUFFIX="${PI_WEB_DEV_TAILSCALE_HOST_SUFFIX:-.ts.net}"

# The phases, in one place: boot -> tailscale -> running -> stopping -> stopped. A start step that
# gives up leaves the phase where it failed, so the exit path knows what it has to undo - the serve
# mapping is removed only when this script made it, and the Tailscale application is left alone
# because taking a Mac off its tailnet is not this command's business.
phase=boot
children=()
serve_mapping_mine=false
serve_owner_file=""
watchdog_pid=""
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

# Is this pid a live process? `kill -0` answers yes for a zombie, and a development child whose pnpm
# wrapper died first is often one: the supervisor then watched a corpse and never noticed the stack had
# stopped, staying alive behind the terminal (live start/stop cycles, 2026-11-14). The process state
# answers the real question.
process_running() {
  local state
  state="$(ps -o stat= -p "$1" 2>/dev/null | tr -d ' ')"
  case "$state" in
    "") return 1 ;;
    Z*) return 1 ;;
    *) return 0 ;;
  esac
}

children_alive() {
  local pid
  for pid in "${children[@]+"${children[@]}"}"; do
    if process_running "$pid"; then return 0; fi
  done
  return 1
}

# Every process in this script's process group, self excluded where it matters. The tree walk above
# misses a descendant whose parent died first: `pnpm run dev:web` is a chain (pnpm, sh -c, bash -c,
# node scripts/build-plugins.mjs --watch), the top of it exits on the first signal, and the watcher is
# reparented to launchd - alive, in this group, invisible to `pgrep -P` of a dead pid. A group signal
# reaches it. (Live start/stop cycles, 2026-11-14: a plugin watcher survived Ctrl+C.)
process_group() {
  ps -o pgid= -p "$$" 2>/dev/null | tr -d ' '
}

signal_group() {
  local signal="$1" pgid
  pgid="$(process_group)"
  [ -n "$pgid" ] || return 0
  pkill -"$signal" -g "$pgid" 2>/dev/null
}

stop_children() {
  [ "${#children[@]}" -eq 0 ] && return 0
  say "stopping the ${#children[@]} development processes"
  signal_tree TERM
  # TERM is ignored for this script while the undo runs (see `cleanup`), so the group signal cannot
  # answer itself; KILL is not ignorable, so it is only used after the undo is finished.
  signal_group TERM
  local waited=0
  while [ "$waited" -lt "$STOP_GRACE_SECONDS" ]; do
    children_alive || return 0
    sleep 1
    waited=$((waited + 1))
  done
  say "the processes ignored the stop; ending them"
  signal_tree CONT
  signal_tree KILL
  signal_group KILL
}

# Whether this script's port is still in the serve config: 0 clear, 1 still served, 2 tailscale did not
# answer. The config is read back because the removal command's exit code is not a report of the state:
# on a config with nothing on the port, `tailscale serve --https=PORT off` answers "handler does not
# exist" and exits 1, which is the outcome the cleanup wanted. A shell that treated that exit code as a
# failure made a clean shutdown look like a broken one (2026-11-14).
serve_mapping_state() {
  local status
  if ! status="$(tailscale serve status </dev/null 2>&1)"; then
    [ -n "$status" ] && trouble "$status"
    return 2
  fi
  if printf '%s\n' "$status" | grep -qE -- ":${DEV_PORT}([[:space:]]|\$)"; then return 1; fi
  return 0
}

tailscale_serve_off() {
  [ "$serve_mapping_mine" = true ] || return 0
  serve_mapping_mine=false
  say "removing the tailscale serve mapping for https on ${DEV_PORT}"
  # The stack tears itself down with `kill 0` (`trap "kill 0" EXIT` inside `pnpm run dev:web`), so a
  # removal during shutdown sits in the path of that signal storm: a `tailscale` client killed
  # mid-request leaves the mapping configured while this script believes it is gone. INT and TERM are
  # ignored for the undo - SIG_IGN survives exec, so the clients are shielded too - and the SIGKILL
  # that ends the process group is only ever issued after this function returns. (2026-11-14)
  trap '' INT TERM
  local attempt output state
  for attempt in 1 2 3; do
    output="$(tailscale serve --https="$DEV_PORT" off </dev/null 2>&1)"
    state=0
    serve_mapping_state || state=$?
    if [ "$state" = 2 ]; then
      trouble "tailscale did not answer, so the serve mapping for ${DEV_PORT} is not confirmed clear; check with: tailscale serve status"
      return 0
    fi
    # A `--bg` serve is settled by tailscaled in the background, so a config read a moment after the
    # removal can be a snapshot taken mid-flight: the mapping is applied again after the removal was
    # acknowledged. The clear answer is therefore read again after a settle, and the mapping is removed
    # once more when it is back (live start/stop cycles, 2026-11-14).
    if [ "$state" = 0 ]; then
      sleep 1
      state=0
      serve_mapping_state || state=$?
      if [ "$state" = 0 ]; then
        rm -f "$serve_owner_file" 2>/dev/null
        return 0
      fi
    fi
  done
  trouble "the tailscale serve mapping for ${DEV_PORT} is still configured${output:+: ${output}}; clear it with: tailscale serve --https=${DEV_PORT} off"
}

# The undo, run once, whatever ended the command: a child dying, Ctrl+C, a signal, a failed start.
#
# INT and TERM are ignored for the whole undo. The stack stops itself with `kill 0` (`trap "kill 0" EXIT`
# inside `pnpm run dev:web`), so a Ctrl+C reaches this script as SIGINT and then as a SIGTERM from the
# child it is supervising; while TERM was at its default disposition that signal killed the script in
# the middle of `stop_children`, and the serve mapping was left behind - intermittently, depending on
# which signal won. Ignoring both for the undo is what makes the removal unconditional; the SIGKILL that
# ends the process group is issued on purpose, after the undo, by the force path. (2026-11-14)
cleanup() {
  [ "$cleanup_ran" = true ] && return 0
  cleanup_ran=true
  trap '' INT TERM
  phase=stopping
  # The serve mapping first: it is the only part of this command that is visible from outside the
  # process group, it is fast, and a stop that ends in `kill -KILL` of the group takes this script with
  # it. The processes are then stopped, and a group signal catches what the tree walk cannot.
  tailscale_serve_off
  stop_children
  phase=stopped
}

stop_forced() {
  [ "${#children[@]}" -eq 0 ] && return 0
  signal_tree KILL
  signal_group KILL
}

# Ctrl+C twice stops waiting: a child that will not die must not trap the reader at a prompt.
#
# The stack signals this script twice on its own. `pnpm run dev:web` ends with `trap "kill 0" EXIT`, so
# the Ctrl+C that reaches every process in the foreground group also makes that child SIGTERM the whole
# group - including this script, one step behind its own SIGINT. Counting that pair as two reader
# requests killed this process before its undo ran, and the serve mapping survived the shutdown
# (2026-11-14). The force path therefore removes the mapping before it kills, because `kill -KILL 0`
# includes this process and nothing after it runs.
on_stop_signal() {
  local code="$1"
  stop_signals=$((stop_signals + 1))
  if [ "$stop_signals" -gt 1 ]; then
    trouble "second stop request: clearing the serve mapping, then ending the process group"
    tailscale_serve_off
    stop_forced
    trap - INT TERM EXIT
    kill -KILL 0 2>/dev/null
    exit "$code"
  fi
  cleanup
  exit "$code"
}

wait_for_sessiond() {
  local timeout="${PI_WEB_DEV_BACKEND_WAIT_SECONDS:-90}" waited=0 socket_path
  if [ -n "${PI_WEB_SESSIOND_PORT:-}" ]; then
    while [ "$waited" -lt "$timeout" ]; do
      if nc -z "${PI_WEB_SESSIOND_HOST:-127.0.0.1}" "$PI_WEB_SESSIOND_PORT" 2>/dev/null; then return 0; fi
      if ! children_alive; then trouble "the session daemon exited before becoming ready"; return 1; fi
      sleep 1; waited=$((waited + 1))
    done
  elif [ -n "${PI_WEB_SESSIOND_URL:-}" ]; then
    while [ "$waited" -lt "$timeout" ]; do
      if curl -ksS --max-time 1 "${PI_WEB_SESSIOND_URL%/}/" >/dev/null 2>&1; then return 0; fi
      if ! children_alive; then trouble "the session daemon exited before becoming ready"; return 1; fi
      sleep 1; waited=$((waited + 1))
    done
  else
    socket_path="${PI_WEB_SESSIOND_SOCKET:-${PI_WEB_DATA_DIR:-$HOME/.pi-web}/sessiond.sock}"
    case "$socket_path" in /*) : ;; *) socket_path="$PWD/$socket_path" ;; esac
    while [ "$waited" -lt "$timeout" ]; do
      if nc -U -z "$socket_path" 2>/dev/null; then return 0; fi
      if ! children_alive; then trouble "the session daemon exited before creating its socket"; return 1; fi
      sleep 1; waited=$((waited + 1))
    done
  fi
  trouble "the session daemon did not become ready within ${timeout}s"
  return 1
}

wait_for_web_api() {
  local timeout="${PI_WEB_DEV_BACKEND_WAIT_SECONDS:-90}" waited=0 port scheme
  port="${PI_WEB_PORT:-${PORT:-8504}}"
  scheme="${PI_WEB_DEV_API_SCHEME:-http}"
  while [ "$waited" -lt "$timeout" ]; do
    if curl -ksS --max-time 1 "${scheme}://127.0.0.1:${port}/api/config" >/dev/null 2>&1; then return 0; fi
    if ! children_alive; then trouble "the web/API process exited before becoming ready"; return 1; fi
    sleep 1; waited=$((waited + 1))
  done
  trouble "the web/API server on port ${port} did not become ready within ${timeout}s"
  return 1
}

start_children() {
  # Start dependencies before Vite. Otherwise the browser requests arrive as soon as Vite
  # listens and generate a screenful of ECONNREFUSED proxy errors while the API and daemon boot.
  pnpm run dev:sessiond &
  children+=("$!")
  wait_for_sessiond || return 1

  pnpm run dev:web &
  children+=("$!")
  wait_for_web_api || return 1

  pnpm run dev:client &
  children+=("$!")
}

# A child that dies takes the stack down: a UI over a half-started stack reads as a broken UI, and a
# serve mapping pointing at nothing reads as a Tailscale problem.
watch_children() {
  while :; do
    local pid
    for pid in "${children[@]}"; do
      if ! process_running "$pid"; then
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

# The mapping's owner is this process, and its loss must not leave the mapping behind. When the
# supervisor is killed by a signal it cannot answer - the stack tears itself down with `kill 0`, and a
# live start/stop cycle showed that killing the supervisor mid-shutdown left an HTTPS mapping pointed
# at a dead port (2026-11-14) - this watcher, running in a process group of its own so no `kill 0`
# reaches it, notices the supervisor is gone and clears the mapping. It acts only while the owner file
# says the mapping is this run's, so a serve config made by anything else is never touched.
start_serve_watchdog() {
  local owner_file="$1" parent="$$"
  set -m
  (
    trap '' HUP INT TERM
    # The supervisor's pid is the fact to watch, and a pid is reused sooner than a watchdog may be
    # waiting on it, so liveness alone is not enough: the command line has to say the same thing. (A
    # first version watched this subshell's own parent through `ps -o ppid=`, which on bash 3.2 names a
    # command-substitution pid that is already gone - the watchdog read an empty answer, concluded the
    # supervisor had died, and cleared the mapping about a second after startup. Live cycles, 2026-11-14.)
    lifetime=$((SECONDS + WATCHDOG_LIFETIME_SECONDS))
    while [ "$SECONDS" -lt "$lifetime" ]; do
      state="$(ps -o stat= -p "$parent" 2>/dev/null | tr -d ' ')"
      case "$state" in
        "" | Z*) break ;;
      esac
      command="$(ps -o command= -p "$parent" 2>/dev/null)"
      case "$command" in
        *"scripts/dev.sh"*) : ;;
        *) break ;;
      esac
      sleep 1
    done
    [ "$(cat "$owner_file" 2>/dev/null)" = "mine" ] || exit 0
    tailscale serve --https="$DEV_PORT" off </dev/null >/dev/null 2>&1
    rm -f "$owner_file"
  ) &
  watchdog_pid="$!"
  set +m
}

apply_serve_mapping() {
  serve_owner_file="$(mktemp "${TMPDIR:-/tmp}/pi-web-dev-serve.XXXXXX")" || serve_owner_file=""
  say "tailscale serve --bg --https=${DEV_PORT} http://127.0.0.1:${DEV_PORT}"
  if ! tailscale serve --bg --https="$DEV_PORT" "http://127.0.0.1:${DEV_PORT}" </dev/null; then
    trouble "tailscale serve refused the https mapping on ${DEV_PORT}. Check 'tailscale serve status', or run the stack without it: PI_WEB_DEV_SKIP_TAILSCALE=1 pnpm run dev"
    return 1
  fi
  serve_mapping_mine=true
  if [ -n "$serve_owner_file" ]; then
    printf 'mine\n' >"$serve_owner_file" 2>/dev/null
    start_serve_watchdog "$serve_owner_file"
  fi
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

  say "building plugin artifacts once"
  if ! pnpm run build:plugins; then
    trouble "the plugin build failed; the development stack was not started"
    return 1
  fi
  export PI_WEB_DEV_SKIP_PLUGIN_BUILD=1

  say "starting the session daemon, the web/API process, the Vite UI and the plugin watchers"
  start_children || return 1
  watch_children
  return $?
}

main
exit_code=$?
cleanup
exit "$exit_code"
