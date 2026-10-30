@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title MT5 diagnostics

echo ============================================================
echo   MT5 DIAGNOSTICS
echo   Collects: windows version + the MT5 journal + the account
echo   into one file:  mt5-diag.txt   (it opens by itself)
echo ============================================================
echo.

set "OUT=mt5-diag.txt"
if exist "%OUT%" del "%OUT%" >nul 2>&1

echo 1) windows version...
call :add "=== WINDOWS ==="
ver >> "%OUT%" 2>&1
call :add ""

echo 2) the MT5 account (MCP)...
call :add "=== ACCOUNT VIA MCP ==="
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" -c "import sys;sys.path.insert(0,'bridge');from mcp_client import McpClient;import os;c=McpClient(os.environ.get('MT5_MCP_URL','http://127.0.0.1:22346/mcp'),os.environ.get('MT5_MCP_KEY',''));c.initialize();a=c.call('get_trading_account_info',{});print(' '.join(x.get('text','') for x in (a.get('content') or [])))" >> "%OUT%" 2>&1
) else (
  echo venv missing - run DO-IT-ALL.bat first >> "%OUT%"
)

echo 3) the MT5 journal...
call :add ""
call :add "=== JOURNAL (last 80 lines) ==="
set "TD="
for /f "usebackq delims=" %%D in (`dir /b /ad /o-d "%APPDATA%\MetaQuotes\Terminal" 2^>nul`) do (
  if not defined TD set "TD=%%D"
)
if not defined TD (
  echo no terminal folder >> "%OUT%"
) else (
  set "JDIR=%APPDATA%\MetaQuotes\Terminal\!TD!\logs\JOURNAL"
  powershell -NoProfile -Command "$f=Get-ChildItem -Path '%JDIR%' -Filter '*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1; if($f){ Get-Content $f.FullName -Tail 80 } else { 'no journal log file' }" >> "%OUT%" 2>&1
)

echo 4) opening the file...
start "" notepad.exe "%OUT%"
echo.
echo   DONE - the file mt5-diag.txt is open in Notepad.
echo   Please send me its content.
echo.
pause
exit /b 0

:add
echo %*>> "%OUT%"
exit /b
