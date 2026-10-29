# تشغيل الجسر على جهاز Windows (خطوة خطوة)

## ١) جهّز الـMT5
1. نزّل MetaTrader 5 من metatrader5.com (أو Exness Terminal من المتجر) وثبّته.
2. افتحه و **File → Login to Trade Account**: اكتب رقم حسابك + الباسورد + **السيرفر بالظبط** (`Exness-MT5Real50`).
3. اتأكد إن **رمز الذهب ظاهر**: Market Watch →بحث `XAU` → اسحبه على شارت.
4. ⚠️ من Tools → Options → **Expert Advisors**: فعّل **Allow algorithmic trading** (وخلّي «Disable automatic trading via external Python API» **مقفول**) — من غيرها المتجر هترجع "Automated trading is not enabled".

## ٢) جهّز بايثون
```
py -m venv .venv
.venv\Scripts\python.exe -m pip install --upgrade pip MetaTrader5
```

## ٣) حطّ المتغيرات
انسخ `.env.example`的文件 إلى `.env` واملاه، أو صدّر المتغيرات في PowerShell:
```powershell
$env:MT5_LOGIN="458089169"; $env:MT5_PASSWORD="..."; $env:MT5_SERVER="Exness-MT5Real50"
$env:ENGINE_URL="http://SEU-BOT:8099"; $env:BRIDGE_TOKEN="..."; $env:DRY_RUN="1"
```
⚠️ الباسورد في متغير بيئة على جهازك — **مش في الشات ولا في الكود ولا في GitHub**.

## ٤) شغّل
```
.venv\Scripts\python.exe bridge\mt5_bridge.py
```
- هتشوف في `bridge.jsonl` كل قرار: `signal` (قبل) · `dry_run_trade` (اللي كان هيتداول) · `order_check` / `order_send` (لو DRY_RUN=0).
- **بأول مرة خلّي DRY_RUN=1** — الجسر يسجّل «كان هيتداول» ويطبع الأوامر على الشارت، **من غير أي أمر حقيقي**.
- لما تبقى مرتاح: `DRY_RUN=0` ⇔ الأوامر بتبعت فعليًا (والـSL/ـTP معاها ⇒ البroker يدير الخروج).

## ٥) أوقف فورًا
اضغط `/stop` للبوت على تليجرام، أو اقفل الـMT5.
