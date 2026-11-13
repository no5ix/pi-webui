#!/usr/bin/env bash
#
# An isolated PI WEB stack for testing device notifications on a Mac, plus the
# Tailscale publishing an iPhone needs.
#
# Why it is a separate stack and not `pnpm run dev`: a push subscription belongs to the
# server that minted the VAPID key it was created with, and the session daemon is the
# process that sends. Pointing a phone at a development stack that proxies /api to the
# PI WEB you already run would register the phone against that server and record every
# test against it. This stack runs the web/API and the session daemon itself, on its own
# port (8506), with its own data directory, its own config file and its own socket, so a
# device list, a VAPID key pair and a delivery log live here and touch nothing else.
#
# It never kills by process name. It stops only the tmux sessions it created, and it
# refuses to start when something it did not start already answers on its port: a stack
# adopted from a stranger tests someone else's code.
#
# Usage:
#   scripts/push-test-stack.sh up [--no-build]   build (unless --no-build), start, prove health
#   scripts/push-test-stack.sh down              stop this stack's tmux sessions only
#   scripts/push-test-stack.sh status            PIDs, health, tailscale mapping
#   scripts/push-test-stack.sh restart           down, then up --no-build
#   scripts/push-test-stack.sh urls              the loopback and tailnet addresses to open
#   scripts/push-test-stack.sh serve-add         publish the port over Tailscale (HTTPS, tailnet only)
#   scripts/push-test-stack.sh serve-remove      remove that Tailscale mapping
#   scripts/push-test-stack.sh serve-status      what Tailscale publishes for this port
#   scripts/push-test-stack.sh state             what the server can send, and every registered device
#   scripts/push-test-stack.sh test [ID]         send a test push (all devices, or one by id)
#   scripts/push-test-stack.sh probe-dev [svc]   register a synthetic device (apple|fcm|mozilla|wns)
#   scripts/push-test-stack.sh forget ID         revoke one device
#   scripts/push-test-stack.sh task [DIR]        create a session for a real run, print its URL
#   scripts/push-test-stack.sh watch [N]         the daemon's delivery lines, redacted
#   scripts/push-test-stack.sh logs              where the logs are
#
# Environment: PI_WEB_PUSHTEST_PORT, PI_WEB_PUSHTEST_DATA_DIR, PI_WEB_PUSHTEST_CONFIG,
# PI_WEB_PUSHTEST_AGENT_DIR (give the stack its own pi agent dir to keep its sessions out
# of the shared session store).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PI_WEB_PUSHTEST_PORT:-8506}"
DATA_DIR="${PI_WEB_PUSHTEST_DATA_DIR:-$HOME/.pi-web-pushtest}"
SOCKET="$DATA_DIR/sessiond.sock"
CONFIG_FILE="${PI_WEB_PUSHTEST_CONFIG:-$DATA_DIR/config.json}"
LOG_DIR="$DATA_DIR/logs"
SESSIOND_TMUX=pi-web-pushtest-sessiond
WEB_TMUX=pi-web-pushtest-web
LOOPBACK="http://127.0.0.1:$PORT"
READY_TIMEOUT_SECONDS=120
PROBE=(node scripts/push-probe.mjs --origin "$LOOPBACK")
AGENT_ENV="${PI_WEB_PUSHTEST_AGENT_DIR:+PI_WEB_PUSHTEST_AGENT_DIR=$PI_WEB_PUSHTEST_AGENT_DIR PI_CODING_AGENT_DIR=$PI_WEB_PUSHTEST_AGENT_DIR }"

usage() {
  awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "${BASH_SOURCE[0]}"
}

# Tailscale reports the DNS name fully qualified ("host.tailnet.ts.net."); a URL drops the last dot.
tailnet_host() {
  tailscale status --peers=false --json 2>/dev/null | sed -n 's/.*"DNSName": *"\([^"]*\)".*/\1/p' | head -1 | sed 's/\.$//'
}

tailnet_url() {
  local host
  host="$(tailnet_host)"
  [ -n "$host" ] || return 0
  echo "https://${host}:${PORT}/"
}

tmux_running() {
  tmux has-session -t "$1" >/dev/null 2>&1
}

stack_running() {
  tmux_running "$SESSIOND_TMUX" || tmux_running "$WEB_TMUX"
}

# Someone else's server on this port is a test of someone else's code. The stack's own
# processes are the ones its tmux sessions started; anything else is reported and left alone.
foreign_listener() {
  local holder pane_pids pid ok
  holder="$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1)"
  [ -n "$holder" ] || return 0
  pane_pids="$(tmux list-panes -s -t "$SESSIOND_TMUX" -F '#{pane_pid}' 2>/dev/null; tmux list-panes -s -t "$WEB_TMUX" -F '#{pane_pid}' 2>/dev/null)"
  pid="$holder"
  while [ -n "$pid" ] && [ "$pid" -gt 1 ] 2>/dev/null; do
    ok=0
    if printf '%s\n' "$pane_pids" | grep -qx "$pid"; then ok=1; break; fi
    pid="$(ps -p "$pid" -o ppid= 2>/dev/null | tr -d ' ')"
  done
  [ "$ok" = "1" ] && return 0
  printf '%s %s\n' "$holder" "$(ps -p "$holder" -o command= 2>/dev/null | cut -c1-120)"
}

stop_stack() {
  tmux kill-session -t "$SESSIOND_TMUX" 2>/dev/null || true
  tmux kill-session -t "$WEB_TMUX" 2>/dev/null || true
  # A dead daemon leaves its socket behind, and a stale socket makes the readiness
  # wait true before the new daemon ever binds. Remove it only once nothing holds it.
  if [ -S "$SOCKET" ] && [ -z "$(lsof -t -- "$SOCKET" 2>/dev/null)" ]; then
    rm -f -- "$SOCKET"
  fi
}

start_stack() {
  mkdir -p "$DATA_DIR" "$LOG_DIR"
  if [ ! -f "$CONFIG_FILE" ]; then
    # Its own config file: the stack is not reading (or writing) the global one, and
    # push needs no keys here - the session daemon mints a VAPID pair on first start.
    printf '{\n  "port": %s\n}\n' "$PORT" >"$CONFIG_FILE"
  fi
  tmux new-session -d -s "$SESSIOND_TMUX" -c "$REPO_ROOT" \
    "PI_WEB_CONFIG=$CONFIG_FILE PI_WEB_DATA_DIR=$DATA_DIR PI_WEB_SESSIOND_SOCKET=$SOCKET ${AGENT_ENV}node dist/server/sessiond.js 2>&1 | tee -a $LOG_DIR/sessiond.log"
  tmux set-option -t "$SESSIOND_TMUX" remain-on-exit on >/dev/null
  local waited=0
  while [ ! -S "$SOCKET" ]; do
    if [ "$waited" -ge 30 ]; then
      echo "FAIL: the session daemon's socket $SOCKET never appeared" >&2
      tmux capture-pane -p -t "$SESSIOND_TMUX" | tail -20 >&2
      exit 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  tmux new-session -d -s "$WEB_TMUX" -c "$REPO_ROOT" \
    "PI_WEB_CONFIG=$CONFIG_FILE PI_WEB_DATA_DIR=$DATA_DIR PI_WEB_SESSIOND_SOCKET=$SOCKET PI_WEB_PORT=$PORT ${AGENT_ENV}node dist/server/index.js 2>&1 | tee -a $LOG_DIR/web.log"
  tmux set-option -t "$WEB_TMUX" remain-on-exit on >/dev/null

  waited=0
  while [ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$LOOPBACK/" 2>/dev/null || echo 000)" != "200" ]; do
    if [ "$waited" -ge "$READY_TIMEOUT_SECONDS" ]; then
      echo "FAIL: $LOOPBACK never answered 200" >&2
      tmux capture-pane -p -t "$WEB_TMUX" | tail -20 >&2
      exit 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  local foreign
  foreign="$(foreign_listener)"
  if [ -n "$foreign" ]; then
    echo "FAIL: pid $foreign answers on $PORT and was not started by this script" >&2
    exit 1
  fi
}

report_urls() {
  local url
  echo "loopback  $LOOPBACK/"
  url="$(tailnet_url)"
  if [ -n "$url" ]; then
    echo "tailnet   $url (needs the serve mapping: scripts/push-test-stack.sh serve-add)"
  else
    echo "tailnet   (Tailscale is not up on this machine)"
  fi
}

serve_status() {
  tailscale serve status 2>&1 | grep -E ":${PORT}( |$)|:${PORT} \(" || echo "Tailscale publishes nothing on $PORT"
}

case "${1:-}" in
  up)
    if [ "${2:-}" != "--no-build" ]; then (cd "$REPO_ROOT" && pnpm run build) >/dev/null; fi
    stop_stack
    start_stack
    echo "up: $LOOPBACK (data dir $DATA_DIR)"
    report_urls
    "${PROBE[@]}" state
    ;;
  down)
    stop_stack
    echo "down: tmux sessions $SESSIOND_TMUX and $WEB_TMUX stopped"
    ;;
  restart)
    "$0" down
    "$0" up --no-build
    ;;
  status)
    for session in "$SESSIOND_TMUX" "$WEB_TMUX"; do
      if tmux_running "$session"; then
        echo "$session running (pane pids: $(tmux list-panes -s -t "$session" -F '#{pane_pid}' | tr '\n' ' '))"
      else
        echo "$session not running"
      fi
    done
    echo "http $LOOPBACK/ -> $(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$LOOPBACK/" 2>/dev/null || echo 000)"
    foreign="$(foreign_listener)"
    [ -z "$foreign" ] || echo "NOTE: pid $foreign answers on $PORT and is not this stack"
    report_urls
    serve_status
    ;;
  urls)
    report_urls
    ;;
  serve-add)
    tailscale serve --bg --https="$PORT" "http://127.0.0.1:$PORT"
    serve_status
    report_urls
    ;;
  serve-remove)
    tailscale serve --https="$PORT" off
    serve_status
    ;;
  serve-status)
    serve_status
    ;;
  state)
    "${PROBE[@]}" state
    ;;
  test)
    session="${PI_WEB_PUSHTEST_SESSION:-push-test-session}"
    if [ -n "${2:-}" ]; then
      "${PROBE[@]}" test --session "$session" --name "PI WEB push test" --device "$2"
    else
      "${PROBE[@]}" test --session "$session" --name "PI WEB push test"
    fi
    ;;
  probe-dev)
    "${PROBE[@]}" register-probe --service "${2:-apple}"
    ;;
  forget)
    [ -n "${2:-}" ] || { echo "forget needs a device id" >&2; exit 2; }
    "${PROBE[@]}" forget "$2"
    ;;
  task)
    cwd="${2:-$DATA_DIR/workspace}"
    mkdir -p "$cwd"
    "${PROBE[@]}" session --cwd "$cwd"
    echo "send a prompt in that page, then run: scripts/push-test-stack.sh watch"
    ;;
  watch)
    "${PROBE[@]}" watch --file "$LOG_DIR/sessiond.log" --lines "${2:-20}"
    ;;
  logs)
    echo "$LOG_DIR/sessiond.log"
    echo "$LOG_DIR/web.log"
    ;;
  *)
    usage
    exit 1
    ;;
esac
