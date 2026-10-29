@echo off
REM ============================================================
REM  INSTALL-MT5.bat  -  downloads and installs MetaTrader 5 (Windows).
REM
REM  You only need this once, and only if MetaTrader 5 is not
REM  installed yet. After it finishes, open MetaTrader 5 and log in
REM  with your Exness numbers (the .env already has them).
REM ============================================================
setlocal
cd /d "%~dp0"

set "URL=https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe"
set "EXE=%~dp0mt5setup.exe"

echo.
echo ============================================================
echo   installing MetaTrader 5
echo ============================================================
echo.

if exist "%EXE%" (
  echo   the installer is already downloaded - running it
) else (
  echo   downloading (24 MB)...
  where curl >nul 2>&1
  if not errorlevel 1 (
    curl -L --max-time 600 -o "%EXE%" "%URL%"
  ) else (
    powershell -NoProfile -Command "Invoke-WebRequest -Uri '%URL%' -OutFile '%EXE%'"
  )
)

if not exist "%EXE%" (
  echo.
  echo   the download failed. Open this link in your browser instead:
  echo     %URL%
  echo   and install it, then run DO-IT-ALL.bat again.
  echo.
  pause
  exit /b 1
)

echo   running the installer...
start "" "%EXE%"

echo.
echo   ---------------------------------------------------------------
echo    In the installer: press Next - Next - Finish.
echo    Then open MetaTrader 5 and log in:
echo      Login  : 458089169
echo      Server : Exness-MT5Real50   (search "Exness" in the list)
echo      Password: your Exness password
echo   ---------------------------------------------------------------
echo.
echo   After that: run DO-IT-ALL.bat again.
echo.
pause
exit /b 0
