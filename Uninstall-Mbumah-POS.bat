@echo off
setlocal EnableDelayedExpansion
title MBUMAH HARDWARE POS - Uninstaller
color 0C

echo.
echo  ============================================================
echo    MBUMAH HARDWARE POS  -  UNINSTALL
echo    Removes the app, shortcuts and background jobs
echo    (offers one final backup first - your data stays safe)
echo  ============================================================
echo.

REM Locate the app source (same logic as the installer).
set "ROOT=%cd%"
if exist "deploy\nodocker\uninstall-nodocker.ps1" (
  echo [1/2] Found the app in this folder.
) else (
  if exist "%USERPROFILE%\mbumah-hardware-pos\deploy\nodocker\uninstall-nodocker.ps1" (
    set "ROOT=%USERPROFILE%\mbumah-hardware-pos"
    echo [1/2] Found the app in !ROOT!.
  ) else (
    color 0C
    echo.
    echo  Could not find the Mbumah POS app on this computer.
    echo  Open the folder where you installed it and double-click
    echo  Uninstall-Mbumah-POS.bat inside that folder.
    echo.
    pause
    exit /b 1
  )
)

cd /d "!ROOT!"

echo [2/2] Starting the uninstaller...
powershell -NoProfile -ExecutionPolicy Bypass -File "deploy\nodocker\uninstall-nodocker.ps1"
if %errorlevel% neq 0 (
  color 0C
  echo.
  echo  Uninstall hit a problem. Take a photo of the screen and
  echo  send it to your developer.
  echo.
  pause
  exit /b 1
)
