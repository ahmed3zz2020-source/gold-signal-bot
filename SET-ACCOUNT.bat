@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Set the trading account

echo ============================================================
echo   SET THE TRADING ACCOUNT
echo   Writes the new login number and the new server
echo   into the .env file. Nothing else changes.
echo ============================================================
echo.

if not exist ".env" (
  echo   .env is missing - run DO-IT-ALL.bat first.
  echo.
  pause
  exit /b 1
)

set "NEW_LOGIN=253734295"
set "NEW_SERVER=Exness-MT5Real34"

copy ".env" ".env.bak" >nul 2>&1
powershell -NoProfile -Command "$c=Get-Content '.env'; $c=$c -replace '^MT5_LOGIN=.*$',('MT5_LOGIN='+$env:NEW_LOGIN); $c=$c -replace '^MT5_SERVER=.*$',('MT5_SERVER='+$env:NEW_SERVER); Set-Content -Path '.env' -Value $c -Encoding ASCII"

echo.
echo   the .env now says:
findstr /i "MT5_LOGIN MT5_SERVER MT5_SYMBOL" ".env"
echo.
echo ============================================================
echo   DONE. Next: run START-BOT.bat
echo   It will print your account - login / balance / currency
echo   / server. Send me what it prints.
echo ============================================================
pause
exit /b 0
