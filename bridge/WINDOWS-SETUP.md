# تشغيل الجسر على جهاز Windows (خطوة خطوة)

الجسر هو الجزء اللي على جهازك: بيسحب الإشارات من محرك الإشارات (اللي شغال على السيرفر)
وبيبعت الأوامر لـ MT5. المحرك نفسه **مش** بيشتغل على جهازك.

## ١) جهّز الـMT5
1. افتح MetaTrader 5 وسجّل دخول بالحساب:
   - Login: `253734295`
   - Server: `Exness-MT5Real34` (الحساب Standard Cent — الرصيد بالـ cents)
   - Password: باسورد Exness بتاعك
2. اتأكد إن **رمز الذهب ظاهر**: Market Watch ← بحث `XAU` ← اسحبه على شارت (الاسم عندك `XAUUSDc`).
3. من Tools ← Options ← **Expert Advisors**: فعّل **Allow algorithmic trading** (وخلّي «Disable automatic trading via external Python API» **مفقول») — من غيرها المتجر هترجع "Automated trading is not enabled".
4. من Tools ← Options ← **MCP**: زرار **+ Add new MCP server** ← بعدين **Copy** (المفتاح بينكتب في `.env` بملف `GET-MCP-KEY.bat`).

## ٢) جهّز بايثون
```
py -m venv .venv
.venv\Scripts\python.exe -m pip install --upgrade pip MetaTrader5
```

## ٣) حطّ المتغيرات
الملف `.env` موجود جاهز في نفس المجلد (فيه الحساب ورابط المحرك وكلمة السر بينكم).
اللي ينقص منه بس: **باسورد Exness** و **مفتاح MCP**.
لو هتصدّر المتغيرات في PowerShell بدل الملف:
```powershell
$env:MT5_LOGIN="253734295"; $env:MT5_PASSWORD="..."; $env:MT5_SERVER="Exness-MT5Real34"
$env:ENGINE_URL="https://gold-engine.octashares.com"; $env:BRIDGE_TOKEN="..."; $env:DRY_RUN="1"
```
⚠️ الباسورد في متغير بيئة على جهازك — **مش في الشات ولا في الكود ولا في GitHub**.

## ٤) شغّل
```
.venv\Scripts\python.exe bridge\mt5_bridge.py
```
- هتشوف في `bridge.jsonl` كل قرار: `signal` (قبل) · `dry_run_trade` (اللي كان هيتداول) · `order_check` / `order_send` (لو DRY_RUN=0).
- **بأول مرة خلّي DRY_RUN=1** — الجسر يسجّل «كان هيتداول» ويطبع الأوامر على الشارت، **من غير أي أمر حقيقي**.
- لما تبقى مرتاح: `DRY_RUN=0` ⇔ الأوامر بتبعت فعليًا (والـSL/ـTP معاها ⇒ Broker يدير الخروج).

## ٥) أوقف فورًا
اضغط `/stop` للبوت على تيليجرام، أو اقفل الـMT5.
