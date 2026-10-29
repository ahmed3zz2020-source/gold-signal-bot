@echo off
REM ============================================================
REM  BRIDGE-SELFTEST.bat  -  proves the WHOLE chain without trading.
REM
REM  It logs into MT5, reads the account + the gold symbol, computes the
REM  lot size for 0.5% risk and prints the plan it WOULD trade.
REM
REM  DRY_RUN=1 + SELFTEST_SIGNAL=1  =>  NO order is ever sent.
REM  The output is saved in bridge-selftest.log and opens in Notepad.
REM
REM  Run DO-IT-ALL.bat first (this needs the .env + the .venv).
REM ============================================================
setlocal
cd /d "%~dp0"

echo.
echo ============================================================
echo   BRIDGE SELFTEST  -  no order will be sent
echo ============================================================
echo.

if not exist ".venv\Scripts\python.exe" (
  echo   .venv is missing - run DO-IT-ALL.bat first.
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  echo   .env is missing - run DO-IT-ALL.bat first.
  echo.
  pause
  exit /b 1
)

set "SELFTEST_SIGNAL=1"
set "DRY_RUN=1"
set "BRIDGE_LOG=bridge-selftest.jsonl"

del /q "bridge-selftest.log" >nul 2>&1
del /q "bridge-selftest.err" >nul 2>&1

echo   running for 45 seconds...
echo.

powershell -NoProfile -Command "$p = Start-Process -FilePath '.\.venv\Scripts\python.exe' -ArgumentList 'bridge\mt5_bridge.py' -PassThru -NoNewWindow -RedirectStandardOutput 'bridge-selftest.log' -RedirectStandardError 'bridge-selftest.err'; Start-Sleep -Seconds 45; if (-not $p.HasExited) { $p.Kill() }" >nul 2>&1

echo.
echo ---------------------------------------------------------------
if exist "bridge-selftest.log" (
  type "bridge-selftest.log"
) else (
  echo   (no output - open bridge-selftest.err)
)
echo ---------------------------------------------------------------
echo.
echo The same output is saved in bridge-selftest.log and opens in Notepad.
start notepad "bridge-selftest.log"
echo.
echo Send me the TEXT of this file (copy + paste is perfect).
pause
exit /b 0
