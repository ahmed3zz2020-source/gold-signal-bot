@echo off
REM ============================================================
REM  INSTALL-ADDON.bat  -  copies the add-on into your project
REM  folder (the one that has the .env) and starts the bot.
REM
REM  Put this zip NEXT TO the gold-signal-bot folder and run it.
REM ============================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo ============================================================
echo   INSTALLING THE ADD-ON
echo ============================================================
echo.

REM ---- find the project folder: the nearest folder that has a .env ----
set "PROJ="
if exist ".env" set "PROJ=%~dp0"
if not defined PROJ (
  for /d %%D in ("%~dp0..\*") do (
    if exist "%%~fD\.env" if not defined PROJ set "PROJ=%%~fD"
  )
)
if not defined PROJ (
  for /d %%D in ("%~dp0..\*") do (
    for /d %%E in ("%%~fD\*") do (
      if exist "%%~fE\.env" if not defined PROJ set "PROJ=%%~fE"
    )
  )
)

if not defined PROJ (
  echo   I could not find your project folder.
  echo.
  echo   Do this: put this folder NEXT TO the gold-signal-bot folder
  echo   (the one that has the .env file inside it) and run this again.
  echo.
  pause
  exit /b 1
)

echo   project folder: %PROJ%
echo   copying the files...
copy /y "%~dp0*.bat" "%PROJ%\" >nul
if not exist "%PROJ%\bridge" mkdir "%PROJ%\bridge" >nul 2>&1
copy /y "%~dp0bridge\*" "%PROJ%\bridge\" >nul
echo   done.
echo.
echo   starting the bot from: %PROJ%
echo.
timeout /t 2 /nobreak >nul

call "%PROJ%\START-BOT.bat"
exit /b 0
