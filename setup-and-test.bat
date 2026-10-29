@echo off
REM ============================================================
REM  gold-signal-bot : one-click setup + connection test
REM  double-click this file. It installs the bridge deps and
REM  prints the MT5 account / gold symbol / risk maths.
REM  It NEVER places an order.
REM ============================================================
setlocal
set "PY=%LOCALAPPDATA%\Programs\Python\Python314\python.exe"
cd /d "%~dp0"

echo.
echo [1/4] checking python...
if not exist "%PY%" (
  echo   python not found at %PY%
  echo   trying the py launcher...
  set "PY=py"
)
"%PY%" --version || goto :fail

echo.
echo [2/4] creating the virtual environment...
if not exist ".venv\Scripts\python.exe" (
  "%PY%" -m venv .venv || goto :fail
) else (
  echo   .venv already exists - reusing it
)

echo.
echo [3/4] installing the MetaTrader5 package...
".venv\Scripts\python.exe" -m pip install --upgrade pip --quiet || goto :fail
".venv\Scripts\python.exe" -m pip install MetaTrader5 --quiet || goto :fail
echo   done

echo.
echo [4/4] testing the MT5 connection (read-only, no orders)...
if not exist ".env" (
  echo   NOTE: no .env found. Run make-env.bat once (it asks for the Exness
  echo   password and saves it LOCALLY) so the script can log in by itself.
)
".venv\Scripts\python.exe" bridge\test_connection.py > "bridge-report.txt" 2>&1
type "bridge-report.txt"
echo.
echo   (the same output is saved in bridge-report.txt and opens in Notepad)
start notepad "bridge-report.txt"
echo.
echo ALL DONE. Send me the output above.
pause
exit /b 0

:fail
echo.
echo SOMETHING FAILED - copy the red lines and send them to me.
pause
exit /b 1
