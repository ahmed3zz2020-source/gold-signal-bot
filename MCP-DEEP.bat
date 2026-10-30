@echo off
REM ============================================================
REM  MCP-DEEP.bat  -  the deep read-only probe of the MT5 MCP server.
REM  It reads the account, the gold symbol, the broker's own margin
REM  and profit maths, checks the order without sending it, and shows
REM  today's history and the M15 candles.
REM  NO order is sent.
REM ============================================================
setlocal
cd /d "%~dp0"
title Gold Signal Bot - MCP deep probe

echo.
echo ============================================================
echo   MT5 MCP DEEP PROBE  -  read only, no order
echo ============================================================
echo.
echo   Make sure MetaTrader 5 is open and logged in first.
echo.

if not exist ".venv\Scripts\python.exe" (
  echo   .venv is missing - run DO-IT-ALL.bat first.
  echo.
  pause
  exit /b 1
)

".venv\Scripts\python.exe" bridge\mcp_probe2.py > "mcp-deep.txt" 2>&1
type "mcp-deep.txt"
echo ---------------------------------------------------------------
echo.
echo The same output is saved in mcp-deep.txt and opens in Notepad.
start notepad "mcp-deep.txt"
echo.
echo Send me the text of that file.
pause
exit /b 0
