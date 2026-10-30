@echo off
REM ============================================================
REM  START-BOT.bat  -  ONE click and the whole bot runs.
REM
REM  It:
REM    1. loads the .env
REM    2. checks MetaTrader 5 and the MCP server
REM    3. starts the signal engine (Node.js) if it is not running
REM    4. starts the bridge (it watches MT5 and trades the signals)
REM
REM  Leave this window open. To stop: close it.
REM ============================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Gold Signal Bot

echo.
echo ============================================================
echo   GOLD SIGNAL BOT  -  starting
echo ============================================================
echo.

if not exist ".env" (
  echo   .env is missing - run DO-IT-ALL.bat first.
  echo.
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" (
  echo   .venv is missing - run DO-IT-ALL.bat first.
  echo.
  pause
  exit /b 1
)

REM ---- load the .env ----
for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do set "%%A=%%B"

REM ---- 1) MetaTrader 5 must be running ----
tasklist /fi "imagename eq terminal64.exe" | find /i "terminal64.exe" >nul
if errorlevel 1 (
  echo   MetaTrader 5 is NOT running - open it and log in first.
  echo.
  pause
  exit /b 1
)
echo   MetaTrader 5 is running.

REM ---- 2) the MCP server must answer ----
echo   checking the MT5 connection...
".venv\Scripts\python.exe" -c "import sys;sys.path.insert(0,'bridge');from mcp_client import McpClient;import os;c=McpClient(os.environ.get('MT5_MCP_URL','http://127.0.0.1:22346/mcp'),os.environ.get('MT5_MCP_KEY',''));c.initialize();a=c.call('get_trading_account_info',{});t=' | '.join(x.get('text','') for x in (a.get('content') or []));print(t[:600])" > "mt5-check.txt" 2>&1
if errorlevel 1 (
  echo   the MT5 MCP server did not answer - see mt5-check.txt
  type "mt5-check.txt"
  echo.
  pause
  exit /b 1
)
echo   MT5 answered - the account is:
findstr /i "login balance currency server" "mt5-check.txt"

REM ---- 3) the engine ----
netstat -an | find ":8080" | find "LISTENING" >nul
if not errorlevel 1 (
  echo   the engine is already running on port 8080.
) else (
  echo   starting the engine...
  where node >nul 2>&1
  if not errorlevel 1 (
    start "Gold Engine" /min node src\index.js
  ) else (
    if exist "tools\node\node-v22.19.0-win-x64\node.exe" (
      start "Gold Engine" /min "tools\node\node-v22.19.0-win-x64\node.exe" src\index.js
    ) else (
      echo   Node.js is missing - run RUN-ENGINE.bat once to download it.
      echo.
      pause
      exit /b 1
    )
  )
  timeout /t 8 /nobreak >nul
)

REM ---- 4) the bridge ----
echo.
echo   starting the bridge - it will now watch gold and trade the signals.
echo   leave this window open. To stop, close it.
echo.
echo ---------------------------------------------------------------
echo.
".venv\Scripts\python.exe" bridge\mt5_bridge.py

echo.
echo   the bot stopped.
pause
exit /b 0
