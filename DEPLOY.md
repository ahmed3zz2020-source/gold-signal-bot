# نشر البوت ٢٤/٧ — gold-signal-bot

البوت Node.js صفر مكتبات (zero deps) ⇒ بيشتغل على أي استضافة Node 20+.

## ١) Railway (الأسهل)
1. سجّل دخولك على railway.app وافتح **New Project → Deploy from GitHub Repo** واختار مستودع `gold-signal-bot`.
2. Railway هيقرا `railway.json` ويشغّل `node src/index.js` تلقائيًا.
3. من تبويب **Variables** ضيف متغيرين (القيم سر — متكتبهاش في الكود):
   - `TELEGRAM_TOKEN` = توكن البوت من @BotFather
   - `TELEGRAM_CHAT_ID` = 2073907990
4. بعد النشر، افتح @gold_scout_xau_bot وابعته `/status` — المفروض يرد فورًا.
5. من غير ما تشغّل حاجة، البوت هيبعت **خريطة الصباح** أول ما تبدأ نافذة القاهرة (09:00 القاهرة) وينبّهك على أي صفقة A أو A+.

## ٢) أي استضافة تانية
- Node.js ≥ 20 ⇒ `npm start`
- نفس المتغيرين في الـenv
- لازم العملية تفضل شغالة (systemd / pm2 / Docker)

## التشغيل المحلي
```bash
export TELEGRAM_TOKEN=... TELEGRAM_CHAT_ID=2073907990
node src/index.js
```
خيارات: `TICK_SEED=/path/ticks.csv` (يعيد بناء التاريخ من ملف تِكات) · `STATE_FILE` / `HISTORY_FILE` (مسار الحفظ).

## قبل أي نشر: اختبارات القبول
```bash
node src/selftest.js   # لازم: ALL CHECKS PASSED
node src/replay.js     # لازم: VERDICT: PASS (يوم 2026-10-29 = صفر إشارات)
```
