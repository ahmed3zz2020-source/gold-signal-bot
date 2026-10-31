#!/usr/bin/env bash
# keepalive.sh — the heartbeat of the gold signal engine.   (v2 · 30 Oct 2026)
#
# WHY v2 EXISTS
#   /opt is container-local: when the container is recycled, /opt is wiped. The engine
#   used to keep everything there (bars, journal, trading counters), so every recycled
#   container came back COLD — no bars (it needs ~10h of live ticks before the gate can
#   run), no learning journal, no counters — and the daily summary was sent again.
#
#   Now the state also lives in a Cloudflare KV namespace, which is OUTSIDE the
#   container, and it is restored on every boot:
#     state.json      trades · dailyR · firedKeys · the daily-summary flag
#     journal.jsonl   every structure the gate saw (the learning's raw material)
#     outcomes.jsonl  the judged results (the learning table)
#     history.json    the M1 bars (this is what makes the engine warm again)
#
#   Safe to run every few minutes: if the engine is healthy it only re-uploads the
#   state and exits.
#
# EXIT: 0 = the engine is up and the state is saved. 1 = it could not be brought up.

set -uo pipefail

REPO="${GOLD_HOME:-/opt/gold-signal-bot}"
PORT="${PORT:-8080}"
HEALTH="http://127.0.0.1:${PORT}/health"
REPO_URL="https://${GITHUB_TOKEN:-}@github.com/ahmed3zz2020-source/gold-signal-bot.git"
LOGFILE="$REPO/bot.log"
PIDFILE="$REPO/bot.pid"
WORKSPACE_TOKEN="/workspace/bridge-token.txt"

# ---- the durable store (Cloudflare KV) — lives outside the container ----------
CF_ACCOUNT="${CF_ACCOUNT:-74e046678adabf0706024b97b205882b}"
CF_NS="${CF_NS:-f39b746eed6c4671959bc710d82fcbc1}"
CF_BASE="https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/storage/kv/namespaces/${CF_NS}"
KV_FILES="state.json journal.jsonl outcomes.jsonl history.json"
KV_HISTORY_INTERVAL="${KV_HISTORY_INTERVAL:-600}"   # seconds between history uploads
SYNC_MARKER="$REPO/.kv-synced-at"

# The bus is where the engine reports from. If its heartbeat is fresh, the engine is
# alive in ANOTHER container - and starting a second one here would double every
# signal (two engines, two firedKeys, two positions). So: ask the bus first.
BUS_URL="${BUS_URL:-https://gold-engine.octashares.com}"

remote_alive() {
  local raw ts now diff
  raw=$(curl -s -m 12 -H "Authorization: Bearer ${BRIDGE_TOKEN:-}" "${BUS_URL}/status" 2>/dev/null) || return 1
  ts=$(printf '%s' "$raw" | grep -o '"ts":[0-9]*' | head -1 | cut -d: -f2)
  [ -n "$ts" ] || return 1
  now=$(( $(date +%s) * 1000 ))
  diff=$(( now - ts ))
  [ "$diff" -ge 0 ] || return 1
  [ "$diff" -lt 180000 ] || return 1
  return 0
}

say() { printf '%s\n' "$*"; }
die() { say "FAIL: $*"; exit 1; }

# ------------------------------------------------------------------ the store
kv_ready() { [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; }

kv_get() {                       # key -> stdout
  kv_ready || return 1
  curl -s -m 60 "$CF_BASE/values/$1" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" 2>/dev/null
}

kv_put() {                       # key file
  kv_ready || return 1
  curl -s -m 120 -X PUT "$CF_BASE/values/$1" \
       -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
       --data-binary "@$2" >/dev/null 2>&1
}

# Pull the state back after a container recycle. A local copy is always fresher than
# the store, so only files that are missing locally are restored.
restore_state() {
  if ! kv_ready; then say "warn: no CLOUDFLARE_API_TOKEN in this session — the state stays local"; return 0; fi
  local restored="" tmp="$REPO/.kv-restore.tmp"
  for f in $KV_FILES; do
    [ -s "$REPO/$f" ] && continue
    if kv_get "$f" > "$tmp" 2>/dev/null && [ -s "$tmp" ]; then
      if grep -q '"success":false' "$tmp" 2>/dev/null; then rm -f "$tmp"; continue; fi
      mv "$tmp" "$REPO/$f" && restored="$restored $f"
    else
      rm -f "$tmp"
    fi
  done
  [ -n "$restored" ] && say "restored from the durable store:$restored"
  return 0
}

# Upload the state. history.json is big and changes every minute, so it goes up on a
# slower cadence; the small files go up every time.
sync_state() {
  kv_ready || return 0
  local now_s last=0
  now_s=$(date +%s)
  if [ -f "$SYNC_MARKER" ]; then last=$(cat "$SYNC_MARKER" 2>/dev/null || echo 0); fi
  case "$last" in ''|*[!0-9]*) last=0 ;; esac
  for f in $KV_FILES; do
    [ -f "$REPO/$f" ] || continue
    # history.json belongs to the ENGINE now: it uploads the live bars every 10
    # minutes. Uploading the local copy from here would overwrite the fresh
    # series with a stale one - that is exactly what froze the bars before.
    if [ "$f" = "history.json" ]; then
      continue
    fi
    kv_put "$f" "$REPO/$f" || say "warn: could not upload $f"
  done
  echo "$now_s" > "$SYNC_MARKER"
  return 0
}

# ── 1. the project must be in a folder that survives the session ──────────────
if [ -f "$REPO/src/index.js" ]; then
  # the folder is already there: pull the newest code so a restart runs the fix
  git -C "$REPO" -c http.sslVerify=false pull --ff-only >/dev/null 2>&1 && say "pulled the newest code" || say "warn: could not pull (using what is on disk)"
else
  mkdir -p "$(dirname "$REPO")" || die "cannot create $(dirname "$REPO")"
  if git -c http.sslVerify=false clone --depth 1 "$REPO_URL" "$REPO" >/dev/null 2>&1; then
    say "cloned the project into $REPO"
  else
    die "cannot clone the project into $REPO (no GITHUB_TOKEN?)"
  fi
fi
cd "$REPO" || die "no $REPO"

# ── 2. the bridge token (the shared secret with the MT5 bridge) ───────────────
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
if [ -f "$WORKSPACE_TOKEN" ] && [ "$(cat "$WORKSPACE_TOKEN")" != "$BRIDGE_TOKEN" ]; then
  printf '%s' "$BRIDGE_TOKEN" > "$WORKSPACE_TOKEN"
  chmod 600 "$WORKSPACE_TOKEN"
fi

# ── 3. the telegram credentials (the engine is useless without them) ──────────
# The telegram token must NEVER be written to a file. If this session does not have
# it in the environment, take it from the engine that is already running (its own
# /proc environment) — the last copy that exists without writing it down.
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
  sync_state
  exit 0
fi

# the engine may be alive in a different container (the cron session gets a fresh
# one every time). If the bus heartbeat is fresh, it is alive - sync and leave it.
if remote_alive; then
  say "OK - the engine is alive elsewhere (fresh heartbeat); not starting a second one"
  sync_state
  exit 0
fi

# something is holding the port but the engine is not answering: clear it first
if [ -n "$(port_pid)" ]; then
  say "port ${PORT} is held by pid $(port_pid) but /health does not answer — clearing it"
  kill "$(port_pid)" 2>/dev/null
  sleep 2
fi

# ── 5. restore the state BEFORE the engine boots ─────────────────────────────
restore_state

# ── 6. start it (detached, survives the shell) ────────────────────────────────
say "starting the engine..."
BRIDGE_TOKEN="$BRIDGE_TOKEN" PORT="$PORT" \
  TELEGRAM_TOKEN="$TELEGRAM_TOKEN" TELEGRAM_CHAT_ID="$TELEGRAM_CHAT_ID" \
  setsid nohup node src/index.js >> "$LOGFILE" 2>&1 < /dev/null &
echo $! > "$PIDFILE"

# ── 7. wait for it ───────────────────────────────────────────────────────────
code="000"
for _ in $(seq 1 30); do
  sleep 1
  code="$(health_code)"
  [ "$code" = "200" ] && break
done

if [ "$code" = "200" ]; then
  say "RESTARTED — /health answers 200"
  sync_state
  exit 0
fi

say "FAIL — /health answered '$code' after 30s. Last lines of $LOGFILE:"
tail -n 15 "$LOGFILE" 2>/dev/null
exit 1
