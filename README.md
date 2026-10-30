# gold-signal-bot — XAUUSD liquidity/MSS scanner → Telegram alerts

Finds XAUUSD trade setups using the same gate the analyst applies by hand, and sends a
**5-line alert to Telegram** when a setup clears it. No chart, no screenshots, no log dumps.

```
spot (Swissquote/gold-api) → 1m bars → M5/M15/M1 structure → MSS → retest → SL/TP → RR gate → Telegram
```

كل الرسائل **عربي بسيط**: الدخول · وقف الخسارة · المخاطرة · الأهداف · العائد لكل مخاطرة · السبب · الإبطال.
ومفيش مصطلحات إنجليزي متروكة لوحدها (كل رقم جنبه شرحه).

---

## الشكل العام (مهم)

فيه **قطعتين**، ومشوا في مكانين مختلفين:

| القطعة | مكانها | وش بتعمل |
|---|---|---|
| **محرك الإشارات** | السيرفر (داخل Railway) | بيبص على الذهب ويطلّع الإشارات وبيبعتها للحافلة |
| **الجسر** | جهازك (ويندوز) | بيسحب الإشارات من الحافلة وبيبعت الأوامر لـ MT5 |

Between them: **الحافلة (the bus)** — Worker اسمه `gold-engine` على `https://gold-engine.octashares.com`.
الجسر بيسحب `/next-signal` من نفس الرابط، والاتنين بيقفلوا بعض بكلمة سر واحدة
اسمها `BRIDGE_TOKEN` — دي موجودة **في ملف `.env` المُسلَّم بس** (مش في الكود ولا في README ولا في GitHub).

⛔ **ما تشغيلش محرك إشارات تاني على جهازك.** لو شغّلت المحرك المحلي وهو شغال على السيرفر،
هيتبعتوا إشارات اتنين للحافلة نفسها والاثنين هيتصارعوا. على جهازك: `RUN-BRIDGE.bat` وبس.

---

## الأرقام الثابتة (مرجع واحد — أي ملف تاني فيه اختلاف يرجع هنا)

| الحاجة | القيمة | فين اتكتبت |
|---|---|---|
| الحساب | `253734295` | `.env` · `bridge/.env.example` · `SET-ACCOUNT.bat` |
| السيرفر | `Exness-MT5Real34` (Standard Cent — الرصيد بالـ cents) | نفس الملفات |
| رمز الذهب | `XAUUSDc` — والجسر **بيكتشفه لوحده** من الـMT5 | `.env` (السطر `MT5_SYMBOL` فاضي) |
| حجم الصفقة | `0.01` لوت ثابت (مش نسبة من الرصيد) | `.env` (`FIXED_VOLUME`) |
| عدد الصفقات في اليوم | `10` | `.env` (`MAX_TRADES_PER_DAY`) · `config.json` |
| وضع التشغيل | `DRY_RUN=1` — بيكتب اللي كان هيعمله بس | `.env` |
| نافذة التداول | `09:00` → `18:00` القاهرة | `config.json` (`session`) |
| تسخين المحرك | **~10 ساعات** (40 شمعة M15 مقفولة) | `config.json` (`signals.m15History`) |
| رابط الحافلة | `https://gold-engine.octashares.com` | `.env` (`ENGINE_URL`) |

⚠️ لو لقيت رقم مختلف في أي ملف، الملف الأحدث هو الصح والقديم لازم يتحدّث.

---

## 🖥️ التشغيل على جهازك (الطريقة السريعة — ملف واحد لكل خطوة)

الترتيب بالظبط:

1. `DO-IT-ALL.bat` — **مرة واحدة**: بايثون + مكتبة MT5 + فتح `.env` للباسورد + فتح MT5 + اختبار الاتصال.
2. في MT5: **Tools ← Options ← MCP ← + Add new MCP server ← Copy**.
3. `GET-MCP-KEY.bat` — يلصق المفتاح في `.env` لوحده.
4. `MCP-TEST.bat` — يتأكد إن MT5 بيجاوب (قراءة بس، من غير أي أمر).
5. `RUN-BRIDGE.bat` — **اتركه مفتوح**. ده البوت الفعلي على جهازك.

ولو في أي تعب: `GET-DIAG.bat` → بيكتب تشخيص كامل في `mt5-diag.txt` وبيفتحه في Notepad → ابعتهولي.

| الملف | بيعمل إيه | لما تحتاجه |
|---|---|---|
| `DO-IT-ALL.bat` | التجهيز كله (مرة واحدة) | أول مرة |
| `GET-MCP-KEY.bat` | يلصق مفتاح MCP في `.env` | مرة واحدة (بعد كل تحديث للـMT5) |
| `MCP-TEST.bat` | اختبار MCP (قراءة بس) | مرة واحدة |
| `RUN-BRIDGE.bat` | **الجسر** — بيسحب الإشارات وبيبعت الأوامر | كل يوم، واتركه مفتوح |
| `GET-DIAG.bat` | تشخيص كامل (ويندوز + MT5 + الحساب) | لما في مشكلة |
| `BRIDGE-SELFTEST.bat` | يثبت إن الجسر شغال — **مافيش أي أمر** | قبل ما تبدأ |
| `MCP-DEEP.bat` | فحص عميق للـMCP (قراءة بس) | لما في مشكلة في الـMCP |
| `TEST-API.bat` | ليه بايثون مش بيوصل لـMT5 | لما في مشكلة في الاتصال |
| `INSTALL-MT5.bat` | ينزّل MT5 ويثبّته | لو MT5 مش موجود |
| `FIX-MT5.bat` | يلاقي MT5 صح ويكتب مكانه في `.env` | لو MT5 مش بيشتغل |
| `SET-ACCOUNT.bat` | يكتب رقم الحساب والسيرفر في `.env` | لو الحساب اتغيّر |
| `UPDATE.bat` | ينزّل آخر نسخة من GitHub (ويسيب `.env` زي ما هو) | لما يطلع تحديث |
| `START-BOT.bat` | فحص سريع + الجسر (Shortcut لـ`RUN-BRIDGE.bat`) | بديل مختصر |
| `RUN-ENGINE.bat` | **للسيرفر بس** — مش محتاجه على جهازك | للمشرف |
| `TEST-ORDER.bat` | ⛔ **أمر حقيقي واحد** (0.01 لوت) | **بس لما أطلب** |
| `INSTALL-ADDON.bat` | إضافة قديمة — مش محتاجها | نادراً |

⚠️ **الوضع الآمن هو `DRY_RUN=1`**: الجسر بيكتب في السجل إيه اللي كان هيعمله وبيرسمه على الشارت،
**من غير ما يبعت أي أمر**. متحوّلهش لـ`0` غير لما أقول.

⚠️ **المحرك محتاج ~10 ساعات تسخين** (40 شمعة M15 مقفولة) قبل ما يقدر يقرأ البنية.
والنافذة المسموح التداول فيها من **09:00 لـ 18:00 القاهرة** بس.

---

## What fires (and what doesn't)

A signal needs **all** of:
1. **MSS** — an M15 close beyond a confirmed swing high/low (a real structure break).
2. **Retest** — price comes back into the broken zone *after* the M15 closes, and an M5 bar
   rejects it (closes back beyond the level, wick or body).
3. **A fill that pays** — RR to the 2nd target ≥ 2.0 and blended RR ≥ 2.0.
4. **No news blackout** — 30 min before → 15 min after a high-impact US release
   (60/45 min for PCE·GDP·CPI·NFP·FOMC); EUR high impact 30/30.
5. **Session window** — 09:00–18:00 Africa/Cairo (DST-safe: the offset changes on 30 Oct).
6. **Risk caps** — 0.3%/trade, 1.0% daily loss cap, max **10** trades/day, never stack trades
   (these are the engine's numbers, in `config.json`; the bridge re-checks them locally
   before it touches the broker — and it always trades the fixed 0.01 lot).

Grade **A+** / **A** → Telegram alert. Grade **B** → optional "watch" message only.

## 1) The engine (on the server)

1. Open Telegram → **@BotFather** → `/newbot` → name + username → copy the **token**.
2. Open your bot → **Start** (so it can message you).
3. Get your chat id: open `https://api.telegram.org/bot<TOKEN>/getUpdates` after sending
   `/start` → find `"chat":{"id": 123456789}`.

Put both in env vars (never in the repo):
```
TELEGRAM_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=123456789
```

## 2) Run it (on the server)

```bash
cd gold-signal-bot
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
Set the env vars in the Railway dashboard (the values are secrets — متكتبهاش في الكود):
- `TELEGRAM_TOKEN` = توكن البوت من @BotFather
- `TELEGRAM_CHAT_ID` = 2073907990
- `BRIDGE_TOKEN` = نفس كلمة السر اللي في `.env` على جهازك
- `BUS_URL` = `https://gold-engine.octashares.com`

The service stays on 24/7. After the deploy, open @gold_scout_xau_bot and send `/status` —
it should answer right away. Without doing anything else, the bot sends the **morning map**
as soon as the Cairo window opens (09:00 Cairo) and warns you about any A or A+ trade.

## Files

| file | what it does |
|---|---|
| `src/market.js` | spot feeds, bar builder, EMA/ATR/RSI, Cairo-time helpers |
| `src/strategy.js` | swings → MSS → retest → SL/TP → RR → grade; news blackout |
| `src/telegram.js` | كل قوالب الرسائل بالعربي (تنبيه · مراقبة · خريطة · ملخص · تحديث صفقة) |
| `src/bus.js` | يبعت الإشارة للحافلة (`BUS_URL`) |
| `src/api.js` | بوابة الإشارة العامة `/next-signal` (دي اللي بتتفتح على النت) |
| `src/index.js` | the live loop, trade tracking, daily summary, /commands |
| `src/replay.js` | tick-file backtest harness |
| `src/selftest.js` | positive controls |
| `src/journal.js` | سجل التعلّم (كل بنية شافها البوت) |
| `bridge/mt5_bridge.py` | **الجسر**: بيسحب الإشارة وبيبعت الأمر (ده اللي على جهازك) |
| `bridge/validate.py` | إعادة التحقق من كل إشارة **محلياً** قبل أي أمر |
| `bridge/mt5_conn.py` | الاتصال بـMT5 (MCP أو IPC) وقراءة الحساب |
| `bridge/setup_mcp_key.ps1` | يلصق مفتاح MCP في `.env` |
| `scripts/voice-alert.sh` | تنبيه **صوتي** عربي (TTS) على تليجرام |
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

## الأسرار (Secrets)
- كلمة سر الحافلة (`BRIDGE_TOKEN`) موجودة **في `.env` المُسلَّم بس**.
- `.env` و`.bridge-token` مستبعدين من GitHub (`.gitignore`) ومستبعدين من نسخة التحديث
  (`release/gold-signal-bot.zip`) عشان ما يتسرّبوش.
- باسورد Exness **مش** موجود في أي ملف — بتكتبه بإيدك مرة واحدة في `.env`.
