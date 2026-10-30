@echo off
REM ============================================================
REM  make-env.bat  -  prepares the local .env (one click)
REM
REM  What it does:
REM    1. copies bridge\.env.example  ->  .env   (next to this file)
REM    2. opens .env in Notepad so you can paste your Exness password
REM    3. saves nothing anywhere else - .env is git-ignored and never uploaded
REM
REM  The MT5 password stays on YOUR machine only.
REM  It is never typed on a command line and never sent to anyone.
REM ============================================================
setlocal
cd /d "%~dp0"

if exist ".env" (
  echo.
  echo   .env already exists - opening it so you can check it.
) else (
  copy /y "bridge\.env.example" ".env" >nul
  echo.
  echo   created .env
)

echo.
echo   ---------------------------------------------------------------
echo   In Notepad: put your Exness password on the line
echo     MT5_PASSWORD=...
echo   Leave everything else as it is. Then save Ctrl+S and close.
echo   ---------------------------------------------------------------
echo.

notepad ".env"

echo.
echo   done. Now double-click  setup-and-test.bat
echo   the script logs into Exness by itself - no manual login needed
echo.
pause
