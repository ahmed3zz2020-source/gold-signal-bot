@echo off
REM ============================================================
REM  GET-MCP-KEY.bat  -  copies the MT5 MCP key into the .env
REM
REM  In MetaTrader 5: Tools > Options > MCP -> press the Copy
REM  button next to the API Key, then run this file.
REM ============================================================
setlocal
cd /d "%~dp0"
title Get the MT5 MCP key

echo.
echo ============================================================
echo   GET THE MT5 MCP KEY
echo ============================================================
echo.
echo   step 1 - in MetaTrader 5: Tools > Options > MCP tab
echo   step 2 - press the Copy button next to the API Key
echo   step 3 - come back and press any key here
echo.
pause
powershell -NoProfile -ExecutionPolicy Bypass -File "bridge\setup_mcp_key.ps1"
echo.
pause
exit /b 0
