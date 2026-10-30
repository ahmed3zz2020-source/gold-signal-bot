@echo off
REM ============================================================
REM  setup-and-test.bat  -  same thing as DO-IT-ALL.bat
REM
REM  This file used to be a SECOND copy of the setup script.
REM  Now there is only ONE setup: DO-IT-ALL.bat.
REM  Everything here just calls it, so there is nothing to
REM  keep in sync and nothing to get wrong.
REM
REM  It NEVER places an order.
REM ============================================================
setlocal
cd /d "%~dp0"

echo.
echo   setup-and-test.bat is now the same as DO-IT-ALL.bat.
echo   running it for you...
echo.
timeout /t 1 /nobreak >nul

call "%~dp0DO-IT-ALL.bat"
exit /b %ERRORLEVEL%
