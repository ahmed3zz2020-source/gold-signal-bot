@echo off
REM ============================================================
REM  INSTALL-MT5.bat  -  downloads MetaTrader 5, installs it, opens it.
REM  Everything it does is written to install-mt5.log
REM ============================================================
setlocal
cd /d "%~dp0"
title Install MetaTrader 5

echo.
echo ============================================================
echo   INSTALLING META TRADER 5
echo ============================================================
echo.
echo   if this window closes by itself, open install-mt5.log
echo    and send me that file
echo.

if exist "install-mt5.log" del /q "install-mt5.log" >nul 2>&1
echo started %date% %time% >> "install-mt5.log"

REM ---------- 1) already installed? ----------
set "MT5_EXE="
if exist "%LOCALAPPDATA%\MetaTrader 5\terminal64.exe" set "MT5_EXE=%LOCALAPPDATA%\MetaTrader 5\terminal64.exe"
if not defined MT5_EXE if exist "C:\Program Files\MetaTrader 5\terminal64.exe" set "MT5_EXE=C:\Program Files\MetaTrader 5\terminal64.exe"
if not defined MT5_EXE if exist "%APPDATA%\MetaTrader 5\terminal64.exe" set "MT5_EXE=%APPDATA%\MetaTrader 5\terminal64.exe"

if defined MT5_EXE goto :found

REM ---------- 2) download ----------
echo   downloading MetaTrader 5 24 MB...
echo downloading >> "install-mt5.log"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest -Uri 'https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe' -OutFile 'mt5setup.exe' -UseBasicParsing; Write-Host 'downloaded OK' } catch { Write-Host ('FAILED: ' + $_.Exception.Message) }" 2>&1 | findstr /i "OK FAILED" >> "install-mt5.log"

if not exist "mt5setup.exe" goto :fail
echo   downloaded.
echo downloaded >> "install-mt5.log"

REM ---------- 3) run the installer ----------
echo.
echo   the installer is opening now.
echo   press:  Next  -  Next  -  Finish
echo.
start "" "mt5setup.exe"
echo installer started >> "install-mt5.log"
echo   waiting 30 seconds for the installer...
timeout /t 30 /nobreak >nul

REM ---------- 4) look for it again ----------
set "MT5_EXE="
if exist "%LOCALAPPDATA%\MetaTrader 5\terminal64.exe" set "MT5_EXE=%LOCALAPPDATA%\MetaTrader 5\terminal64.exe"
if not defined MT5_EXE if exist "C:\Program Files\MetaTrader 5\terminal64.exe" set "MT5_EXE=C:\Program Files\MetaTrader 5\terminal64.exe"
if not defined MT5_EXE if exist "%APPDATA%\MetaTrader 5\terminal64.exe" set "MT5_EXE=%APPDATA%\MetaTrader 5\terminal64.exe"

if not defined MT5_EXE goto :notyet
goto :found

:notyet
echo.
echo   MetaTrader 5 is not there yet.
echo   If the installer is still open, finish it, then run DO-IT-ALL.bat.
echo   send me install-mt5.log if it fails
echo.
pause
exit /b 1

:found
echo.
echo   FOUND: %MT5_EXE%
echo FOUND: %MT5_EXE% >> "install-mt5.log"
set "MT5_FOUND=%MT5_EXE%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:MT5_FOUND; if($p){ (Get-Content '.env' -Encoding UTF8) -replace '^MT5_PATH=.*', ('MT5_PATH=' + $p) | Set-Content '.env' -Encoding UTF8 }" >nul 2>&1

echo.
echo   opening MetaTrader 5...
start "" "%MT5_EXE%"
echo.
echo   ---------------------------------------------------------------
echo    Log in with:
echo      Login   : 253734295
echo      Server  : Exness-MT5Real34   search "Exness" in the list
echo      Account : Standard Cent  (the balance is in cents)
echo      Gold    : XAUUSDc
echo      Password: your Exness password
echo   ---------------------------------------------------------------
echo.
echo   After you log in: run DO-IT-ALL.bat
echo.
pause
exit /b 0

:fail
echo.
echo   THE DOWNLOAD FAILED.
echo   Open this link in your browser and install it manually:
echo     https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe
echo   then run DO-IT-ALL.bat again.
echo   send me install-mt5.log if it keeps failing
echo.
pause
exit /b 1
