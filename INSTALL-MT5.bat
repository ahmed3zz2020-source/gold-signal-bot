@echo off
REM ============================================================
REM  INSTALL-MT5.bat  -  downloads MetaTrader 5, installs it, opens it.
REM
REM  One click. It:
REM    1. downloads the official MetaQuotes installer (24 MB)
REM    2. runs it  (you press: Next - Next - Finish)
REM    3. waits for MetaTrader 5 to appear, writes its path into the .env
REM    4. opens MetaTrader 5 so you can log in
REM
REM  After you log in: run DO-IT-ALL.bat
REM ============================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "URL=https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe"
set "EXE=%~dp0mt5setup.exe"

echo.
echo ============================================================
echo   installing MetaTrader 5
echo ============================================================
echo.

if not exist "%EXE%" (
  echo   downloading (24 MB, one time)...
  where curl >nul 2>&1
  if not errorlevel 1 (
    curl -L --max-time 900 -o "%EXE%" "%URL%"
  ) else (
    powershell -NoProfile -Command "Invoke-WebRequest -Uri '%URL%' -OutFile '%EXE%'"
  )
)

if not exist "%EXE%" (
  echo.
  echo   the download failed. Open this link in your browser instead:
  echo     %URL%
  echo   install it, then run DO-IT-ALL.bat again.
  echo.
  pause
  exit /b 1
)

echo   running the installer...
start "" "%EXE%"
echo.
echo   ---------------------------------------------------------------
echo    In the installer press:  Next  -  Next  -  Finish
echo   ---------------------------------------------------------------
echo.
echo   waiting for MetaTrader 5 to be installed (up to 8 minutes)...

set "FOUND="
for /l %%i in (1,1,48) do (
  if not defined FOUND (
    if exist "%LOCALAPPDATA%\MetaTrader 5\terminal64.exe" set "FOUND=%LOCALAPPDATA%\MetaTrader 5\terminal64.exe"
    if not defined FOUND if exist "C:\Program Files\MetaTrader 5\terminal64.exe" set "FOUND=C:\Program Files\MetaTrader 5\terminal64.exe"
    if not defined FOUND if exist "%APPDATA%\MetaTrader 5\terminal64.exe" set "FOUND=%APPDATA%\MetaTrader 5\terminal64.exe"
    if not defined FOUND (
      for /f "delims=" %%P in ('where /r "%LOCALAPPDATA%" terminal64.exe 2^>nul') do (
        if not defined FOUND set "FOUND=%%P"
      )
    )
    if not defined FOUND timeout /t 10 /nobreak >nul
  )
)

if not defined FOUND (
  echo.
  echo   I could not find terminal64.exe yet.
  echo   If the installer is still open, finish it, then run DO-IT-ALL.bat.
  echo.
  pause
  exit /b 1
)

echo   found: %FOUND%
set "MT5_FOUND=%FOUND%"
powershell -NoProfile -Command "$p=$env:MT5_FOUND; if($p){ (Get-Content '.env') -replace '^MT5_PATH=.*', ('MT5_PATH=' + $p) | Set-Content '.env' -Encoding UTF8 }" >nul 2>&1

echo.
echo   opening MetaTrader 5...
start "" "%FOUND%"
echo.
echo   ---------------------------------------------------------------
echo    Log in with:
echo      Login   : 458089169
echo      Server  : Exness-MT5Real50   (search "Exness" in the list)
echo      Password: your Exness password
echo   ---------------------------------------------------------------
echo.
echo   After you are logged in: run DO-IT-ALL.bat
echo.
pause
exit /b 0
