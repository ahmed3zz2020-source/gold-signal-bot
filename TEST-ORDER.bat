@echo off
REM ============================================================
REM  TEST-ORDER.bat  -  sends ONE real order and closes it.
REM
REM  This is the end-to-end proof on the REAL account:
REM  connect -> read the account -> send a 0.01 lot order with a stop
REM  and a target -> wait 10 seconds -> close it -> print what happened.
REM
REM   It is a REAL order. It costs the spread twice (~60 USC = $0.06)
REM     and, if gold moves against you, up to the stop (200 USC = $2).
REM   It uses its own magic number, so it does NOT touch the daily counters.
REM
REM  Run DO-IT-ALL.bat and BRIDGE-SELFTEST.bat first.
REM ============================================================
setlocal
cd /d "%~dp0"

echo.
echo ============================================================
echo   REAL ORDER TEST  -  one small order, then it closes it
echo ============================================================
echo.

set "PY="
if exist ".venv\Scripts\python.exe" set "PY=.venv\Scripts\python.exe"
if not defined PY (
  where python >nul 2>&1
  if not errorlevel 1 set "PY=python"
)
if not defined PY (
  echo   Python was not found on this computer - run DO-IT-ALL.bat once.
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

echo   sending the order in a few seconds...
echo.
timeout /t 5 /nobreak >nul

"%PY%" bridge\test_order.py > "test-order.txt" 2>&1
type "test-order.txt"
echo ---------------------------------------------------------------
echo.
echo The same output is saved in test-order.txt and opens in Notepad.
start notepad "test-order.txt"
echo.
echo Send me the TEXT of this file.
pause
exit /b 0
