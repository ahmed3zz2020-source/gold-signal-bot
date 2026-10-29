# gold-signal-bot — XAUUSD liquidity/MSS scanner → Telegram alerts

Finds XAUUSD trade setups using the same gate the analyst applies by hand, and sends a
**5-line alert to Telegram** when a setup clears it. No chart, no screenshots, no log dumps.

```
spot (Swissquote/gold-api) → 1m bars → M5/M15/M1 structure → MSS → retest → SL/TP → RR gate → Telegram
```

كل الرسائل **عربي بسيط**: الدخول · وقف الخسارة · المخاطرة · الأهداف · العائد لكل مخاطرة · السبب · الإبطال.
ومفيش مصطلحات إنجليزي متروكة لوحدها (كل رقم جنبه شرحه).

## What fires (and what doesn't)

A signal needs **all** of:
1. **MSS** — an M15 close beyond a confirmed swing high/low (a real structure break).
2. **Retest** — price comes back into the broken zone *after* the M15 closes, and an M5 bar
   rejects it (closes back beyond the level, wick or body).
3. **A fill that pays** — RR to the 2nd target ≥ 2.0 and blended RR ≥ 2.0.
4. **No news blackout** — 30 min before → 15 min after a high-impact US release
   (60/45 min for PCE·GDP·CPI·NFP·FOMC); EUR high impact 30/30.
5. **Session window** — 09:00–18:00 Africa/Cairo (DST-safe: the offset changes on 30 Oct).
6. **Risk caps** — 0.5%/trade, 1.5% daily loss cap, max 2 trades/day, never stack trades.

Grade **A+** / **A** → Telegram alert. Grade **B** → optional "watch" message only.

## 1) Create the bot (5 minutes, once)

1. Open Telegram → **@BotFather** → `/newbot` → name + username → copy the **token**.
2. Open your bot → **Start** (so it can message you).
3. Get your chat id: open `https://api.telegram.org/bot<TOKEN>/getUpdates` after sending
   `/start` → find `"chat":{"id": 123456789}`.

Put both in env vars (never in the repo):
```
TELEGRAM_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=123456789
```

## 2) Run it locally (2 minutes)

```bash
cd gold-bot
export TELEGRAM_TOKEN=... TELEGRAM_CHAT_ID=...
node src/index.js
```

Check: `/ping`, `/status`, `/levels` in the chat.

## 3) Validate it before trusting it (5 minutes)

The engine ships with two harnesses. **Do not skip this** — it is what stops the bot
from becoming a random-entry machine.

```bash
node src/selftest.js   # positive controls: a clean MSS+retest MUST fire (long & short)
node src/replay.js     # replays 2026-10-29 tick-by-tick; that day's correct answer is ZERO trades
```
`replay.js` prints `VERDICT: PASS` when the engine stays silent on a day whose correct
answer was *no trade*. If it ever prints FAIL, the engine is too loose — tighten
`config.json` before deploying.

## 4) Deploy (Railway — same stack as OCTA)

```bash
railway init && railway up
```
Set the two env vars in the Railway dashboard → the service stays on 24/7.

## Files

| file | what it does |
|---|---|
| `src/market.js` | spot feeds, bar builder, EMA/ATR/RSI, Cairo-time helpers |
| `src/strategy.js` | swings → MSS → retest → SL/TP → RR → grade; news blackout |
| `src/telegram.js` | كل قوالب الرسائل بالعربي (تنبيه · مراقبة · خريطة · ملخص · تحديث صفقة) |
| `scripts/voice-alert.sh` | تنبيه **صوتي** عربي (TTS) على تليجرام |
| `src/index.js` | the live loop, trade tracking, daily summary, /commands |
| `src/replay.js` | tick-file backtest harness |
| `src/selftest.js` | positive controls |
| `config.json` | thresholds, risk, session times, key levels |

## Backfill / warm-up

```bash
TICK_SEED=/path/to/ticks.csv node src/index.js   # csv: ts_seconds,bid,ask
```
The bot replays the tick file at boot so the M15/M5 structure is already there when it goes live.

## Voice alert (Arabic TTS)

Needs the `mcode-tools` CLI (available in the assistant sandbox, **not** on Railway):

```bash
scripts/voice-alert.sh "صفقة شراء. الدخول أربعة ألف وثلاثون..."   # text + voice note
```
Voice: `Arabic_FriendlyGuy` (or `Arabic_CalmWoman`) — set `TTS_VOICE` to switch.

## Tuning

`config.json` → `signals`:
- `minRR2` / `minBlendedRR` — the RR gate (2.0). Raise to be more selective.
- `retestBufferAtr` — how deep into the zone the retest may go (0.15 ATR).
- `stopBufferAtr5` — stop distance beyond the structure (0.30 ATR).
- `minTp1Atr15` — a target closer than this is noise, not a target (0.60 ATR).
- `maxTpAtr15` — how far a target may be (4.0 ATR).
- `keyLevels` — hand-mapped levels the bot treats as liquidity (e.g. 4015.4, 4000).

## Hard rules the code enforces
- Spot only. Never Yahoo GC=F (a distorted futures premium).
- Never fire a closed bar decision on a forming bar.
- Never fire the same setup twice (`firedKeys`).
- Never fire inside a news blackout or outside the Cairo session.
- Never open a second trade while one is live.
- One reply per Telegram command (the update offset is `lastUpdateId + 1` — Telegram only
  confirms updates *below* the offset, so using the raw id re-delivers the same command).
