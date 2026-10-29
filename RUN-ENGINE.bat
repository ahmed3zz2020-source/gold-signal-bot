@echo off
REM ============================================================
REM  RUN-ENGINE.bat  -  runs the signal engine on THIS computer.
REM
REM  It needs Node.js 20+. If Node is not installed, it downloads a
REM  portable copy into the folder (no admin rights, one time only).
REM
REM  Then it starts the engine: it watches gold and sends the alerts
REM  to Telegram. It also opens the API on port 8080 so the bridge
REM  (the same folder) can pull the signals from it.
REM
REM  ⛔ LEAVE THIS WINDOW OPEN. Closing it stops the engine.
REM  ⛔ The first 4-5 hours it only warms up (it needs 20 closed
REM     15-minute candles before it can read the structure).
REM ============================================================
setlocal
cd /d "%~dp0"

set "NODE_VERSION=v22.19.0"
set "NODE_DIR=%~dp0tools\node"
set "NODE_EXE=%NODE_DIR%\node-v%NODE_VERSION%-win-x64\node.exe"

echo.
echo ============================================================
echo   GOLD SIGNAL ENGINE
echo ============================================================
echo.

where node >nul 2>&1
if not errorlevel 1 (
  set "NODE=node"
  for /f "delims=" %%i in ('node --version') do echo   Node.js found: %%i
  goto :run
)

if exist "%NODE_EXE%" (
  echo   using the portable Node.js in the folder
  goto :run
)

echo   Node.js not found - downloading a portable copy (one time, ~30 MB)...
if not exist "%NODE_DIR%" mkdir "%NODE_DIR%" >nul 2>&1
powershell -NoProfile -Command "$u='https://nodejs.org/dist/%NODE_VERSION%/node-%NODE_VERSION%-win-x64.zip'; $f=Join-Path $env:TEMP 'node.zip'; Invoke-WebRequest -Uri $u -OutFile $f; Expand-Archive -Path $f -DestinationPath '%NODE_DIR%' -Force; Remove-Item $f" >nul 2>&1

if not exist "%NODE_EXE%" (
  echo.
  echo   the download failed - install Node.js 20+ from nodejs.org and run this again
  echo.
  pause
  exit /b 1
)
echo   Node.js downloaded.

:run
if not exist ".env" (
  echo   .env is missing - run DO-IT-ALL.bat first.
  echo.
  pause
  exit /b 1
)

REM ---- load the .env into this session ----
for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do set "%%A=%%B"

if not defined BRIDGE_TOKEN (
  echo.
  echo   BRIDGE_TOKEN is missing from the .env - the bridge cannot talk to the engine.
  echo.
  pause
  exit /b 1
)

echo.
echo   the engine is starting. Leave this window OPEN.
echo   the bridge (RUN-BRIDGE.bat) talks to it on http://127.0.0.1:%PORT%
echo   to stop: close this window.
echo.
echo ---------------------------------------------------------------
echo.

if "%NODE%"=="" (
  "%NODE_EXE%" src\index.js
) else (
  %NODE% src\index.js
)

echo.
echo   the engine stopped.
pause
exit /b 0
