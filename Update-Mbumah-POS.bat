@echo off
setlocal EnableDelayedExpansion
title MBUMAH HARDWARE POS - Update
color 0A

echo.
echo  ============================================================
echo    MBUMAH HARDWARE POS  -  UPDATE
echo    Checks GitHub for a newer version, backs up your data,
echo    installs it and restarts the POS.
echo    (The nightly automatic update runs at 23:00 - this is the
echo     same thing, started by hand.)
echo  ============================================================
echo.

REM Locate the app source (same logic as the installer).
set "ROOT=%cd%"
if exist "deploy\nodocker\update-pos.ps1" (
  echo [1/2] Found the app in this folder.
) else (
  if exist "%USERPROFILE%\mbumah-hardware-pos\deploy\nodocker\update-pos.ps1" (
    set "ROOT=%USERPROFILE%\mbumah-hardware-pos"
    echo [1/2] Found the app in !ROOT!.
  ) else (
    color 0C
    echo.
    echo  Could not find the Mbumah POS app on this computer.
    echo  Open the folder where you installed it and double-click
    echo  Update-Mbumah-POS.bat inside that folder.
    echo.
    pause
    exit /b 1
  )
)

cd /d "!ROOT!"

echo [2/2] Checking GitHub for a newer version...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "deploy\nodocker\update-pos.ps1" %*
if %errorlevel% neq 0 (
  color 0C
  echo.
  echo  The update hit a problem. Nothing was lost:
  echo    - your data was backed up before the update started
  echo    - if the new version failed its checks, the previous
  echo      version was put back automatically.
  echo  Scroll up for the red [FAIL] lines, take a photo of the
  echo  screen and send it to your developer.
  echo.
  pause
  exit /b 1
)

echo.
echo  Update finished. If a new version was installed, start the
echo  POS again with the "Mbumah POS" desktop icon.
echo.
pause
