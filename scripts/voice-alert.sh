#!/usr/bin/env bash
# voice-alert.sh — ينتج تنبيه صوتي عربي (TTS) ويرسله على تليجرام
# الاستخدام:  scripts/voice-alert.sh "نص التنبيه" [chat_id]
# المتطلبات: mcode-tools (متاح في بيئة المساعد) + TELEGRAM_TOKEN
set -euo pipefail

TEXT="${1:?اكتب نص التنبيه}"
CHAT="${2:-${TELEGRAM_CHAT_ID:-}}"
VOICE="${TTS_VOICE:-Arabic_FriendlyGuy}"
TOKEN="${TELEGRAM_TOKEN:-${TELEGRAM_BOT_TOKEN:-}}"
[ -n "$TOKEN" ] || { echo "TELEGRAM_TOKEN مفقود"; exit 1; }
[ -n "$CHAT" ]  || { echo "chat id مفقود"; exit 1; }

OUT=$(mcode-tools connector call connector__matrix__synthesize_speech \
        --args "$(node -e 'console.log(JSON.stringify({text:process.argv[1],voice_id:process.argv[2],speed:1.0}))' "$TEXT" "$VOICE")")
echo "$OUT"
NODE_ID=$(echo "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.node_id||"")})')
[ -n "$NODE_ID" ] || { echo "فشل توليد الصوت"; exit 1; }

URL=$(mcode-tools get_asset_url "$NODE_ID" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.download_url||j.url||"")})')
[ -n "$URL" ] || { echo "فشل جلب رابط الصوت"; exit 1; }

CAPTION="${3:-🎧 تنبيه صوتي — التفاصيل في الرسالة}"
curl -sS -X POST "https://api.telegram.org/bot${TOKEN}/sendVoice" \
  -H 'Content-Type: application/json' \
  -d "$(node -e 'console.log(JSON.stringify({chat_id:process.argv[1],voice:process.argv[2],caption:process.argv[3]}))' "$CHAT" "$URL" "$CAPTION")"
echo
