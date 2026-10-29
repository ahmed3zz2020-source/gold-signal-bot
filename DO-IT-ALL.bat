@echo off
REM ============================================================
REM  DO-IT-ALL.bat  —  one click, the whole setup
REM
REM  It does EVERYTHING by itself:
REM    1. creates the virtual environment + installs the MetaTrader5 package
REM    2. opens MetaTrader 5
REM    3. opens Notepad so you can paste your Exness password (once)
REM    4. logs into Exness and prints the account / gold symbol / risk maths
REM
REM  It NEVER places an order.
REM ============================================================
setlocal
cd /d "%~dp0"

echo.
echo ============================================================
echo   GOLD SIGNAL BOT  -  one-click setup
echo ============================================================
echo.

REM ---------- 1) python -------------------------------------------------
echo [1/5] python...
set "PY=%LOCALAPPDATA%\Programs\Python\Python314\python.exe"
if not exist "%PY%" set "PY=py"
"%PY%" --version || goto :fail

REM ---------- 2) venv + package -----------------------------------------
echo.
echo [2/5] virtual environment + MetaTrader5 package (takes a minute)...
if not exist ".venv\Scripts\python.exe" (
  "%PY%" -m venv .venv || goto :fail
) else (
  echo   .venv already exists
)
".venv\Scripts\python.exe" -m pip install --upgrade pip --quiet
".venv\Scripts\python.exe" -m pip install MetaTrader5 --quiet || goto :fail
echo   done

REM ---------- 3) the .env with the password -------------------------------
echo.
echo [3/5] the local settings file (.env)...
if not exist ".env" copy /y "bridge\.env.example" ".env" >nul
findstr /c:"your-password-here" ".env" >nul
if not errorlevel 1 (
  echo   Notepad is opening. Put your Exness password on the line
  echo     MT5_PASSWORD=...
  echo   then press Ctrl+S and close Notepad.
  start /wait notepad ".env"
) else (
  echo   .env already has a password - skipping Notepad
)

REM ---------- 4) start MetaTrader 5 --------------------------------------
echo.
echo [4/5] starting MetaTrader 5...
tasklist /fi "imagename eq terminal64.exe" | find /i "terminal64.exe" >nul
if errorlevel 1 (
  start "" "C:\Program Files\MetaTrader 5\terminal64.exe"
  echo   starting it - waiting 15 seconds...
  timeout /t 15 /nobreak >nul
) else (
  echo   MetaTrader 5 is already running
)

REM ---------- 5) the connection test -------------------------------------
echo.
echo [5/5] testing the connection (read-only, NO orders)...
echo ---------------------------------------------------------------
".venv\Scripts\python.exe" bridge\test_connection.py
echo ---------------------------------------------------------------
echo.
echo Send me the output above (a photo of this window is perfect).
pause
exit /b 0

:fail
echo.
echo SOMETHING FAILED - send me a photo of this window.
pause
exit /b 1
