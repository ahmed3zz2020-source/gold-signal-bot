@echo off
REM ============================================================
REM  START-BOT.bat  -  checks MetaTrader 5, then starts the bridge.
REM
REM  What it does:
REM    1. loads the .env
REM    2. checks MetaTrader 5 is running and the MCP server answers
REM    3. starts the BRIDGE (it pulls the signals from the engine
REM       on the server and sends the orders to MT5)
REM
REM  The signal engine does NOT run on this computer - it runs on
REM  the server (gold-engine.octashares.com). Never start it here:
REM  a second engine would push its own signals into the same bus
REM  and the two would fight over the trades.
REM
REM  Leave this window open. To stop: close it.
REM ============================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Gold Signal Bot

echo.
echo ============================================================
echo   GOLD SIGNAL BOT  -  starting the bridge
echo ============================================================
echo.

if not exist ".env" (
  echo   .env is missing - it comes with the package.
  echo   Unzip the whole folder again - run DO-IT-ALL.bat first.
  echo.
  pause
  exit /b 1
)
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
"%PY%" -c "import sys;sys.path.insert(0,'bridge');from mcp_client import McpClient;import os;c=McpClient(os.environ.get('MT5_MCP_URL','http://127.0.0.1:22346/mcp'),os.environ.get('MT5_MCP_KEY',''));c.initialize();a=c.call('get_trading_account_info',{});t=' | '.join(x.get('text','') for x in (a.get('content') or []));print(t[:600])" > "mt5-check.txt" 2>&1
if errorlevel 1 (
  echo   the MT5 MCP server did not answer - see mt5-check.txt
  type "mt5-check.txt"
  echo.
  pause
  exit /b 1
)
echo   MT5 answered - the account is:
findstr /i "login balance currency server" "mt5-check.txt"

REM ---- 3) the bridge (the engine is on the server) ----
echo.
echo   starting the bridge - it will now watch gold and trade the signals.
echo   leave this window open. To stop, close it.
echo.
echo ---------------------------------------------------------------
echo.

call "%~dp0RUN-BRIDGE.bat"

echo.
echo   the bot stopped.
pause
exit /b 0
