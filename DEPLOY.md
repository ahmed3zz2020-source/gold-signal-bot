# نشر البوت — gold-signal-bot

البوت Node.js صفر مكتبات (zero deps) ⇒ بيشتغل على أي استضافة Node 20+.

## الشكل العام

| القطعة | مكانها | إزاي بتشغّلها |
|---|---|---|
| محرك الإشارات | Railway (أو أي استضافة Node) | `node src/index.js` |
| الحافلة (Worker) | `https://gold-engine.octashares.com` | Worker جاهز — اسمه `gold-engine` |
| الجسر | جهاز أحمد (ويندوز) | `RUN-BRIDGE.bat` |

المحرك **مش** بيشتغل على جهاز أحمد. جهازه فيه الجسر بس.

---

## ١) المحرك على Railway (الأسهل)

1. سجّل دخولك على railway.app وافتح **New Project → Deploy from GitHub Repo** واختار مستودع `gold-signal-bot`.
2. Railway هيقرا `railway.json` ويشغّل `node src/index.js` تلقائيًا.
3. من تبويب **Variables** ضيف المتغيرات دي (القيم سر — متكتبهاش في الكود):
   - `TELEGRAM_TOKEN` = توكن البوت من @BotFather
   - `TELEGRAM_CHAT_ID` = 2073907990
   - `BRIDGE_TOKEN` = **نفس** كلمة السر اللي في `.env` على جهاز أحمد
   - `BUS_URL` = `https://gold-engine.octashares.com`
4. بعد النشر، افتح @gold_scout_xau_bot وابعته `/status` — المفروض يرد فورًا.
5. من غير ما تشغّل حاجة، البوت هيبعت **خريطة الصباح** أول ما تبدأ نافذة القاهرة (09:00 القاهرة)
   وينبّهك على أي صفقة A أو A+.

## ٢) أي استضافة تانية
- Node.js ≥ 20 ⇒ `npm start`
- نفس المتغيرات في الـenv
- لازم العملية تفضل شغالة (systemd / pm2 / Docker)
- `scripts/keepalive.sh` بيعمل كده: بيحفظ الحالة بره الـcontainer (Cloudflare KV)
  عشان المحرك ما يرجعش من الصفر كل ما الـcontainer يتعمله recycle.

## التشغيل المحلي (للتطوير)
```bash
export TELEGRAM_TOKEN=... TELEGRAM_CHAT_ID=2073907990
node src/index.js
```
خيارات: `TICK_SEED=/path/ticks.csv` (يعيد بناء التاريخ من ملف تِكات) · `STATE_FILE` / `HISTORY_FILE` (مسار الحفظ).

---

## ٣) الجسر على جهاز أحمد (الجزء الحقيقي على اللاب)

الجهاز بيحتاج **نسخة واحدة** من المجلد (فيها `.env`) و **MT5 متسجّل دخول** بالحساب الجديد.

الحساب: `253734295` · السيرفر: `Exness-MT5Real34` · Standard Cent · رمز الذهب `XAUUSDc`
(الجسر **بيكتشف** الرمز لوحده من الـMT5 — السطر `MT5_SYMBOL` في `.env` فاضي).

المهم في `.env`:

```
ENGINE_URL=https://gold-engine.octashares.com
BRIDGE_TOKEN=...            # نفس كلمة سر الـWorker — متكتبشها في أي ملف تاني
MT5_LOGIN=253734295
MT5_SERVER=Exness-MT5Real34
FIXED_VOLUME=0.01           # لوت ثابت
MAX_TRADES_PER_DAY=10
DRY_RUN=1                   # بيكتب اللي كان هيعمله بس
```

خطوات الجهاز بالترتيب: `DO-IT-ALL.bat` ← (في MT5: **+ Add new MCP server** وبعدين **Copy**) ←
`GET-MCP-KEY.bat` ← `MCP-TEST.bat` ← `RUN-BRIDGE.bat` (اتركه مفتوح).

التفاصيل الكاملة في `START-HERE.txt`.

⛔ **ما تحوّلش `DRY_RUN` لـ`0` من غير طلب.** في الوضع ده الجسر بيبعت أوامر حقيقية.

---

## قبل أي نشر: اختبارات القبول
```bash
node src/selftest.js   # لازم: ALL CHECKS PASSED
node src/replay.js     # لازم: VERDICT: PASS (يوم 2026-10-29 = صفر إشارات)
```

## الأسرار
- `BRIDGE_TOKEN` في `.env` المُسلَّم بس.
- `.env` و`.bridge-token` في `.gitignore` ومستبعدين من `release/gold-signal-bot.zip`.
- باسورد Exness بيكتبه صاحب الحساب بإيده — مش موجود في أي ملف في الريبو.
