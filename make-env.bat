@echo off
REM ============================================================
REM  make-env.bat  -  same thing as DO-IT-ALL.bat
REM
REM  The .env already comes inside the package: it holds the
REM  link to the signal engine and the shared password.
REM  This file used to create a SECOND .env from a template -
REM  which would have wiped the engine link.
REM
REM  Now there is only ONE setup: DO-IT-ALL.bat.
REM  It opens the .env for your Exness password (and only that).
REM
REM  The MT5 password stays on YOUR machine only.
REM  It is never typed on a command line and never sent to anyone.
REM ============================================================
setlocal
cd /d "%~dp0"

echo.
echo   make-env.bat is now the same as DO-IT-ALL.bat.
echo   running it for you...
echo.
timeout /t 1 /nobreak >nul

call "%~dp0DO-IT-ALL.bat"
exit /b %ERRORLEVEL%
