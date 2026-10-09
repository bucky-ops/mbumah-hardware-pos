@echo off
setlocal EnableDelayedExpansion
title MBUMAH HARDWARE POS - Rollback
color 0E

echo.
echo  ============================================================
echo    MBUMAH HARDWARE POS  -  ROLLBACK TO A PREVIOUS VERSION
echo    Puts an older version of the app back if an update caused
echo    trouble. Your sales data is NEVER changed by a rollback.
echo  ============================================================
echo.

REM Locate the app source (same logic as the installer).
set "ROOT=%cd%"
if exist "deploy\nodocker\rollback-pos.ps1" (
  echo [1/2] Found the app in this folder.
) else (
  if exist "%USERPROFILE%\mbumah-hardware-pos\deploy\nodocker\rollback-pos.ps1" (
    set "ROOT=%USERPROFILE%\mbumah-hardware-pos"
    echo [1/2] Found the app in !ROOT!.
  ) else (
    color 0C
    echo.
    echo  Could not find the Mbumah POS app on this computer.
    echo  Open the folder where you installed it and double-click
    echo  Rollback-Mbumah-POS.bat inside that folder.
    echo.
    pause
    exit /b 1
  )
)

cd /d "!ROOT!"

echo [2/2] Looking up the update history...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "deploy\nodocker\rollback-pos.ps1" %*
if %errorlevel% neq 0 (
  color 0C
  echo.
  echo  The rollback hit a problem. Scroll up for the red [FAIL]
  echo  lines, take a photo of the screen and send it to your
  echo  developer. Your data is safe (backups are in the
  echo  MbumahBackups folder on the Desktop).
  echo.
  pause
  exit /b 1
)

echo.
echo  Rollback finished. Start the POS again with the
echo  "Mbumah POS" desktop icon.
echo.
pause
