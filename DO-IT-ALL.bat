@echo off
REM ============================================================
REM  DO-IT-ALL.bat  -  one click, the whole setup
REM
REM  1. creates the virtual environment + installs MetaTrader5
REM  2. opens the .env in Notepad so you can paste the password
REM  3. finds MetaTrader 5 and opens it
REM  4. tests the connection and prints the account + the gold symbol
REM
REM  It NEVER places an order.
REM ============================================================
setlocal
cd /d "%~dp0"
title Gold Signal Bot - setup

echo.
echo ============================================================
echo   GOLD SIGNAL BOT  -  one-click setup
echo ============================================================
echo.

REM ---------- 0) the .env ----------
if not exist ".env" (
  echo   .env is missing - copy it from bridge\.env.example first.
  echo.
  pause
  exit /b 1
)

REM ---------- 1) python -------------------------------------------------
echo [1/5] python...
set "PY=%LOCALAPPDATA%\Programs\Python\Python314\python.exe"
if not exist "%PY%" set "PY=py"
"%PY%" --version || goto :fail

REM ---------- 2) venv + package -----------------------------------------
echo.
echo [2/5] virtual environment + MetaTrader5 package - takes a minute...
if not exist ".venv\Scripts\python.exe" (
  "%PY%" -m venv .venv || goto :fail
) else (
  echo   .venv already exists
)
".venv\Scripts\python.exe" -m pip install --upgrade pip --quiet
".venv\Scripts\python.exe" -m pip install MetaTrader5 --quiet || goto :fail
echo   done

REM ---------- 3) the password -------------------------------------------
echo.
echo [3/5] the Exness password...
powershell -NoProfile -Command "$c = Get-Content '.env' -Raw -ErrorAction SilentlyContinue; if($c -match 'your-password-here'){ exit 1 } else { exit 0 }" >nul 2>&1
if errorlevel 1 (
  echo   Notepad is opening. Put your Exness password on the line
  echo     MT5_PASSWORD=...
  echo   then press Ctrl+S and close Notepad.
  start /wait notepad ".env"
) else (
  echo   .env already has a password - skipping Notepad
)

REM ---------- 4) find MetaTrader 5 --------------------------------------
echo.
echo [4/5] looking for MetaTrader 5...
set "MT5_EXE="
if exist "C:\Program Files\MetaTrader 5\terminal64.exe" set "MT5_EXE=C:\Program Files\MetaTrader 5\terminal64.exe"
if not defined MT5_EXE if exist "C:\Program Files (x86)\MetaTrader 5\terminal64.exe" set "MT5_EXE=C:\Program Files (x86)\MetaTrader 5\terminal64.exe"
if not defined MT5_EXE if exist "%LOCALAPPDATA%\MetaTrader 5\terminal64.exe" set "MT5_EXE=%LOCALAPPDATA%\MetaTrader 5\terminal64.exe"
if not defined MT5_EXE if exist "%APPDATA%\MetaTrader 5\terminal64.exe" set "MT5_EXE=%APPDATA%\MetaTrader 5\terminal64.exe"
if not defined MT5_EXE if exist "C:\Program Files\Exness\MetaTrader 5\terminal64.exe" set "MT5_EXE=C:\Program Files\Exness\MetaTrader 5\terminal64.exe"
if not defined MT5_EXE if exist "C:\Program Files (x86)\Exness\MetaTrader 5\terminal64.exe" set "MT5_EXE=C:\Program Files (x86)\Exness\MetaTrader 5\terminal64.exe"

if not defined MT5_EXE (
  echo   searching the whole disk...
  for /f "delims=" %%P in ('where /r "C:\Program Files" terminal64.exe 2^>nul') do if not defined MT5_EXE set "MT5_EXE=%%P"
)

if not defined MT5_EXE goto :nomt5

echo   found: %MT5_EXE%
set "MT5_FOUND=%MT5_EXE%"
powershell -NoProfile -Command "$p=$env:MT5_FOUND; if($p){ (Get-Content '.env') -replace '^MT5_PATH=.*', ('MT5_PATH=' + $p) | Set-Content '.env' -Encoding UTF8 }" >nul 2>&1

tasklist /fi "imagename eq terminal64.exe" | find /i "terminal64.exe" >nul
if errorlevel 1 (
  start "" "%MT5_EXE%"
  echo   starting it - waiting 15 seconds...
  timeout /t 15 /nobreak >nul
) else (
  echo   MetaTrader 5 is already running
)

REM ---------- 5) the connection test -------------------------------------
echo.
echo [5/5] testing the connection - read only, NO orders...
echo ---------------------------------------------------------------
".venv\Scripts\python.exe" bridge\test_connection.py > "bridge-report.txt" 2>&1
type "bridge-report.txt"
echo ---------------------------------------------------------------
echo.
echo The same output is saved in bridge-report.txt and opens in Notepad.
start notepad "bridge-report.txt"
echo.
echo Send me the text above - copy and paste is perfect.
pause
exit /b 0

:nomt5
echo.
echo   MetaTrader 5 was not found on this computer.
echo.
echo   Press Y and I will download and install it for you.
echo   Or install it from the Exness app - account screen - the MT5 button.
echo   Or from: https://www.metatrader5.com/en
echo.
set /p "ANSWER=   Install MetaTrader 5 now? Y/N : "
if /i "%ANSWER%"=="Y" (
  echo.
  call "%~dp0INSTALL-MT5.bat"
  echo.
  echo   After the installation finishes, run DO-IT-ALL.bat again.
  goto :fail
)
echo.
echo   OK - install MetaTrader 5, then run DO-IT-ALL.bat again.
echo.
pause
exit /b 1

:fail
echo.
echo SOMETHING FAILED - send me a photo of this window.
pause
exit /b 1
