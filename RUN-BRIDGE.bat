@echo off
REM ============================================================
REM  RUN-BRIDGE.bat  -  runs the bridge (the part that talks to MT5).
REM
REM  It pulls the signals from the engine (ENGINE_URL) and, after
REM  checking every rule again locally, sends the order to Exness.
REM
REM   LEAVE THIS WINDOW OPEN. Closing it stops the bridge.
REM   DRY_RUN=1 in the .env => it only LOGS what it would do (safe).
REM     DRY_RUN=0              => it sends REAL orders.
REM ============================================================
setlocal
cd /d "%~dp0"

echo.
echo ============================================================
echo   GOLD BRIDGE  -  the part that talks to MetaTrader 5
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

REM ---- load the .env into this session ----
for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do set "%%A=%%B"

if not defined ENGINE_URL set "ENGINE_URL=http://127.0.0.1:8080"
set "SELFTEST_SIGNAL=0"

echo   engine    : %ENGINE_URL%
echo   dry run   : %DRY_RUN%   1 = logs only, 0 = real orders
echo   lot       : %FIXED_VOLUME%
echo   per day   : %MAX_TRADES_PER_DAY%
echo.
echo   leaving this window open keeps the bridge running.
echo ---------------------------------------------------------------
echo.

".venv\Scripts\python.exe" bridge\mt5_bridge.py

echo.
echo   the bridge stopped.
pause
exit /b 0
