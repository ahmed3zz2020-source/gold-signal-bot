@echo off
REM ============================================================
REM  MCP-TEST.bat  -  talks to MetaTrader 5 over its built-in MCP
REM  server and prints every tool it exposes.
REM  Read only - no order is sent.
REM ============================================================
setlocal
cd /d "%~dp0"
title Gold Signal Bot - MCP test

echo.
echo ============================================================
echo   MT5 MCP TEST
echo ============================================================
echo.

if not exist ".venv\Scripts\python.exe" (
  echo   .venv is missing - run DO-IT-ALL.bat first.
  echo.
  pause
  exit /b 1
)

".venv\Scripts\python.exe" bridge\mcp_probe.py > "mcp-probe.txt" 2>&1
type "mcp-probe.txt"
echo ---------------------------------------------------------------
echo.
echo The same output is saved in mcp-probe.txt and opens in Notepad.
start notepad "mcp-probe.txt"
echo.
echo Send me the text of that file.
pause
exit /b 0
