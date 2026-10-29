#!/usr/bin/env bash
# Rebuild the release ZIP that the bot pushes over Telegram (/update).
set -e
ROOT=/workspace/gold-bot
OUT=/workspace/output
rm -rf "$OUT/gold-signal-bot"
mkdir -p "$OUT/gold-signal-bot"
tar -C "$ROOT" \
  --exclude='.git' --exclude='.venv' --exclude='node_modules' --exclude='__pycache__' \
  --exclude='*.pyc' --exclude='.env' --exclude='state.json' --exclude='history.json' \
  --exclude='*.log' --exclude='journal.jsonl' --exclude='outcomes.jsonl' \
  --exclude='bridge.jsonl' --exclude='bridge-report.txt' --exclude='*.zip' \
  -cf - . | tar -C "$OUT/gold-signal-bot" -xf -
cd "$OUT" && rm -f gold-signal-bot.zip && zip -qr gold-signal-bot.zip gold-signal-bot
ls -lh "$OUT/gold-signal-bot.zip"
