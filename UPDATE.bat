@echo off
REM ============================================================
REM  UPDATE.bat  —  pulls the LATEST version from GitHub over this folder.
REM
REM  Your .env (the password) and your .venv are kept.
REM  After it finishes, run DO-IT-ALL.bat.
REM ============================================================
setlocal
cd /d "%~dp0"

echo.
echo   Downloading the latest version from GitHub...
echo.
curl -sL -o update.zip "https://github.com/ahmed3zz2020-source/gold-signal-bot/archive/refs/heads/main.zip"
if not exist update.zip goto :fail

echo   Unpacking...
powershell -NoProfile -Command "Expand-Archive -Path 'update.zip' -DestinationPath '.' -Force" >nul 2>&1
if not exist "gold-signal-bot-main" goto :fail

echo   Updating your folder (your .env and .venv are kept)...
xcopy /E /Y /I /Q /EXCLUDE:exclude.txt "gold-signal-bot-main\*" "." >nul
del /q update.zip >nul 2>&1
rd /s /q "gold-signal-bot-main" >nul 2>&1

echo.
echo   DONE - this folder is now the latest version.
echo   Now double-click  DO-IT-ALL.bat
echo.
pause
exit /b 0

:fail
echo.
echo   The download failed - check the internet and try again.
echo.
pause
exit /b 1
