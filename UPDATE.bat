@echo off
REM ============================================================
REM  UPDATE.bat  -  pulls the LATEST version into this folder.
REM
REM  It tries several download mirrors (campus networks sometimes block
REM  one of them) and uses the first one that works.
REM  Your .env (the password) and your .venv are always kept.
REM  After it finishes, run DO-IT-ALL.bat.
REM ============================================================
setlocal
cd /d "%~dp0"

set "REPO=ahmed3zz2020-source/gold-signal-bot"
set "U1=https://github.com/%REPO%/archive/refs/heads/main.zip"
set "U2=https://codeload.github.com/%REPO%/zip/refs/heads/main"
set "U3=https://cdn.jsdelivr.net/gh/%REPO%@main/release/gold-signal-bot.zip"

echo.
echo   Downloading the latest version...
echo.
del /q update.zip >nul 2>&1

for %%U in ("%U1%" "%U2%" "%U3%") do (
  if not exist update.zip (
    echo   trying %%~U
    curl -sL --max-time 120 -o update.zip "%%~U"
    if exist update.zip if %%~zU LSS 20000 del /q update.zip
  )
)

if not exist update.zip goto :fail

echo   Unpacking...
powershell -NoProfile -Command "Expand-Archive -Path 'update.zip' -DestinationPath '.' -Force" >nul 2>&1

if exist "gold-signal-bot-main" (
  echo   Updating your folder (your .env and .venv are kept)...
  xcopy /E /Y /I /Q /EXCLUDE:exclude.txt "gold-signal-bot-main\*" "." >nul
  rd /s /q "gold-signal-bot-main" >nul 2>&1
) else (
  echo   Unpacked directly (no inner folder).
  xcopy /E /Y /I /Q /EXCLUDE:exclude.txt "*" "." >nul
)

del /q update.zip >nul 2>&1

echo.
echo   DONE - this folder is now the latest version.
echo   Now double-click  DO-IT-ALL.bat
echo.
pause
exit /b 0

:fail
echo.
echo   The download failed - all mirrors were blocked or offline.
echo   Try: open Telegram and ask for "/update" - the bot sends the file directly.
echo.
pause
exit /b 1
