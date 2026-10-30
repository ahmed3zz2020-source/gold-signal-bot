#!/usr/bin/env bash
# keepalive.sh — the heartbeat of the gold signal engine.
#
# Why this script exists:
#   The /workspace volume is WIPED between sessions (every new session gets a fresh,
#   empty volume: /<session-id>/workspace). The container itself survives for hours.
#   So the engine must NOT live in /workspace — its state (state.json, history.json,
#   journal.jsonl, outcomes.jsonl) would vanish and the engine would restart cold
#   every time: no warm-up, no learning, and the daily summary would be re-sent
#   over and over (spam). /opt/gold-signal-bot is container-local and survives.
#
# What it does (safe to run every few minutes, no side effects if all is well):
#   1. makes sure the project exists in the persistent folder (clones it if not)
#   2. makes sure the bridge token is in place
#   3. starts the engine ONLY if it is not running already
#   4. waits until /health answers 200
#
# Exit code 0 = the engine is up and healthy. 1 = it could not be brought up.

set -uo pipefail

REPO="${GOLD_HOME:-/opt/gold-signal-bot}"
PORT="${PORT:-8080}"
HEALTH="http://127.0.0.1:${PORT}/health"
REPO_URL="https://${GITHUB_TOKEN:-}@github.com/ahmed3zz2020-source/gold-signal-bot.git"
LOGFILE="$REPO/bot.log"
PIDFILE="$REPO/bot.pid"
WORKSPACE_TOKEN="/workspace/bridge-token.txt"

say() { printf '%s\n' "$*"; }
die() { say "FAIL: $*"; exit 1; }

# ── 1. the project must be in a folder that survives the session ──────────────
if [ ! -f "$REPO/src/index.js" ]; then
  mkdir -p "$(dirname "$REPO")" || die "cannot create $(dirname "$REPO")"
  if git -c http.sslVerify=false clone --depth 1 "$REPO_URL" "$REPO" >/dev/null 2>&1; then
    say "cloned the project into $REPO"
  else
    die "cannot clone the project into $REPO (no GITHUB_TOKEN?)"
  fi
fi
cd "$REPO" || die "no $REPO"

# ── 2. the bridge token (the shared secret with the MT5 bridge) ───────────────
# The API only starts when BRIDGE_TOKEN is set, so the token is not optional.
if [ -z "${BRIDGE_TOKEN:-}" ]; then
  if [ -f "$REPO/.bridge-token" ]; then
    BRIDGE_TOKEN="$(cat "$REPO/.bridge-token")"
  elif [ -f "$WORKSPACE_TOKEN" ]; then
    BRIDGE_TOKEN="$(cat "$WORKSPACE_TOKEN")"
    printf '%s' "$BRIDGE_TOKEN" > "$REPO/.bridge-token"
    chmod 600 "$REPO/.bridge-token"
  else
    die "no BRIDGE_TOKEN (not in the environment, not in $REPO/.bridge-token, not in $WORKSPACE_TOKEN)"
  fi
else
  printf '%s' "$BRIDGE_TOKEN" > "$REPO/.bridge-token"
  chmod 600 "$REPO/.bridge-token"
fi
# the cron job's original start command reads the token from the workspace path
if [ -f "$WORKSPACE_TOKEN" ] && [ "$(cat "$WORKSPACE_TOKEN")" != "$BRIDGE_TOKEN" ]; then
  printf '%s' "$BRIDGE_TOKEN" > "$WORKSPACE_TOKEN"
  chmod 600 "$WORKSPACE_TOKEN"
fi

# ── 3. the telegram credentials (the engine is useless without them) ──────────
# The telegram token must NEVER be written to a file. If this session does not have
# it in the environment, take it from the engine that is already running (its own
# /proc environment) — that is the last copy that exists without writing it down.
if [ -z "${TELEGRAM_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
  for pid in $(pgrep -f "node src/index.js" 2>/dev/null); do
    [ "$pid" = "$$" ] && continue
    env_file="/proc/$pid/environ"
    [ -r "$env_file" ] || continue
    t="$(tr '\0' '\n' < "$env_file" 2>/dev/null | sed -n 's/^TELEGRAM_TOKEN=//p' | head -1)"
    c="$(tr '\0' '\n' < "$env_file" 2>/dev/null | sed -n 's/^TELEGRAM_CHAT_ID=//p' | head -1)"
    [ -n "$t" ] && [ -n "$c" ] && { TELEGRAM_TOKEN="$t"; TELEGRAM_CHAT_ID="$c"; break; }
  done
fi
if [ -z "${TELEGRAM_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
  die "TELEGRAM_TOKEN / TELEGRAM_CHAT_ID are not available (the engine would run blind)"
fi

# ── 4. is it already running? ────────────────────────────────────────────────
# The health endpoint is the only trustworthy liveness signal here: a pgrep on the
# command line also matches the very shell that runs this script.
health_code() { curl -s -m 5 -o /dev/null -w "%{http_code}" "$HEALTH" 2>/dev/null || echo "000"; }
port_pid() { lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null | head -1; }

if [ "$(health_code)" = "200" ]; then
  say "OK — the engine is already up and /health answers 200"
  exit 0
fi

# something is holding the port but the engine is not answering: clear it first
if [ -n "$(port_pid)" ]; then
  say "port ${PORT} is held by pid $(port_pid) but /health does not answer — clearing it"
  kill "$(port_pid)" 2>/dev/null
  sleep 2
fi

# ── 5. start it (detached, survives the shell) ────────────────────────────────
say "starting the engine..."
BRIDGE_TOKEN="$BRIDGE_TOKEN" PORT="$PORT" \
  TELEGRAM_TOKEN="$TELEGRAM_TOKEN" TELEGRAM_CHAT_ID="$TELEGRAM_CHAT_ID" \
  setsid nohup node src/index.js >> "$LOGFILE" 2>&1 < /dev/null &
echo $! > "$PIDFILE"

# ── 6. wait for it ───────────────────────────────────────────────────────────
code="000"
for _ in $(seq 1 30); do
  sleep 1
  code="$(health_code)"
  [ "$code" = "200" ] && break
done

if [ "$code" = "200" ]; then
  say "RESTARTED — /health answers 200"
  exit 0
fi

say "FAIL — /health answered '$code' after 30s. Last lines of $LOGFILE:"
tail -n 15 "$LOGFILE" 2>/dev/null
exit 1
