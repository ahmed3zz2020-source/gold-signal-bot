@echo off
REM ============================================================
REM  TEST-API.bat  -  why can't the Python API reach MetaTrader 5?
REM
REM  It tries every way of connecting and prints what each one says.
REM  The output is saved in test-api.txt and opens in Notepad.
REM ============================================================
setlocal
cd /d "%~dp0"
title Gold Signal Bot - MT5 API test

echo.
echo ============================================================
echo   MT5 API DIAGNOSTIC
echo ============================================================
echo.

if not exist ".venv\Scripts\python.exe" (
  echo   .venv is missing - run DO-IT-ALL.bat first.
  echo.
  pause
  exit /b 1
)

echo   checking whether MetaTrader 5 is running...
tasklist /fi "imagename eq terminal64.exe" | find /i "terminal64.exe" >nul
if errorlevel 1 (
  echo   MetaTrader 5 is NOT running - open it and log in first.
  echo   Then run this file again.
  echo.
  pause
  exit /b 1
) else (
  echo   MetaTrader 5 is running.
)

echo.
echo   trying to connect - this can take a minute...
echo.

".venv\Scripts\python.exe" bridge\test_api.py > "test-api.txt" 2>&1
type "test-api.txt"
echo ---------------------------------------------------------------
echo.
echo The same output is saved in test-api.txt and opens in Notepad.
start notepad "test-api.txt"
echo.
echo Send me the text of that file.
pause
exit /b 0
