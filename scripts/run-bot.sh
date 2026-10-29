#!/usr/bin/env bash
# run-bot.sh — start/stop/status the bot without pkill (pkill -f matches this script itself)
set -euo pipefail
cd "$(dirname "$0")/.."
PIDFILE=bot.pid
case "${1:-start}" in
  start)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat $PIDFILE)" 2>/dev/null; then echo "already running: $(cat $PIDFILE)"; exit 0; fi
    : "${TELEGRAM_TOKEN:?set TELEGRAM_TOKEN}"
    : "${TELEGRAM_CHAT_ID:?set TELELEGRAM_CHAT_ID}"
    TICK_SEED="${TICK_SEED:-/workspace/gold/spot_ticks.csv}"
    nohup node src/index.js > bot.log 2>&1 &
    echo $! > "$PIDFILE"
    echo "started pid $(cat $PIDFILE) — log: bot.log"
    ;;
  stop)
    if [ -f "$PIDFILE" ]; then kill "$(cat $PIDFILE)" && echo "stopped $(cat $PIDFILE)"; rm -f "$PIDFILE"; else echo "not running"; fi
    ;;
  status)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat $PIDFILE)" 2>/dev/null; then echo "running: $(cat $PIDFILE)"; else echo "not running"; fi
    tail -5 bot.log 2>/dev/null || true
    ;;
esac
