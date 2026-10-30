@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Fix MetaTrader 5 - use the Exness terminal

echo ============================================================
echo   FIX METATRADER 5
echo   Closes every MT5, finds the right terminal64.exe,
echo   writes its path into the .env and opens it.
echo   This can take one minute while it searches the disk.
echo ============================================================
echo.

set "PF86=%ProgramFiles(x86)%"
set "LIST=%TEMP%\mt5-list.txt"
if exist "%LIST%" del "%LIST%" >nul 2>&1

echo   closing any running MetaTrader 5...
taskkill /IM terminal64.exe /F >nul 2>&1
timeout /t 2 /nobreak >nul

REM ---- fast targeted search ----
call :scan "%ProgramFiles%\Exness*"
call :scan "%ProgramFiles%\*MetaTrader*"
call :scan "%PF86%\Exness*"
call :scan "%PF86%\*MetaTrader*"
call :scan "%LOCALAPPDATA%\Programs\Exness*"
call :scan "%LOCALAPPDATA%\Programs\*MetaTrader*"
call :scan "%APPDATA%\MetaQuotes\Terminal"
call :scan "%LOCALAPPDATA%\MetaQuotes\Terminal"

REM ---- deep search as a fallback ----
if not exist "%LIST%" (
  call :scan "%ProgramFiles%"
  call :scan "%PF86%"
)

if not exist "%LIST%" goto none

set "PICK="
for /f "usebackq delims=" %%F in ("%LIST%") do (
  if not defined PICK set "PICK=%%F"
  echo %%F | findstr /i "exness" >nul && set "PICK=%%F"
)

if not defined PICK goto none

echo.
echo   MT5 copies found on this computer:
for /f "usebackq delims=" %%F in ("%LIST%") do echo     %%F
echo.
echo   using this one: %PICK%
echo.

if not exist ".env" goto noenv
copy ".env" ".env.bak" >nul 2>&1
powershell -NoProfile -Command "$p='%PICK%'; $c=Get-Content '.env' -Encoding UTF8; $c=$c -replace '^MT5_PATH=.*$',('MT5_PATH='+$p); Set-Content -Path '.env' -Value $c -Encoding UTF8"
echo   MT5_PATH was written into the .env file.
echo.

echo   starting MetaTrader 5...
start "" "%PICK%"
echo.
echo ============================================================
echo   DONE. Now do these 4 things:
echo     1. log in to Exness-MT5Real34  (login 253734295)
echo     2. make the Algo Trading button GREEN
echo     3. copy the MCP key - Tools then Options then MCP
echo     4. run GET-MCP-KEY.bat
echo   then run START-BOT.bat
echo ============================================================
pause
exit /b 0

:scan
if not exist "%~1" exit /b
for /f "delims=" %%F in ('dir /b /s "%~1\terminal64.exe" 2^>nul') do echo %%F>>"%LIST%"
exit /b

:none
echo.
echo   No terminal64.exe was found on this computer.
echo   If you installed MetaTrader 5 somewhere unusual,
echo   put its full path in the .env file on the MT5_PATH line.
echo.
pause
exit /b 1

:noenv
echo.
echo   The .env file is missing in this folder.
echo   Run DO-IT-ALL.bat first.
echo.
pause
exit /b 1
