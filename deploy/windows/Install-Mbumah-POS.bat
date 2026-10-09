@echo off
setlocal EnableDelayedExpansion
title MBUMAH HARDWARE POS - Full System Installer
color 0A

echo.
echo  ============================================================
echo    MBUMAH HARDWARE POS  -  FULL SYSTEM INSTALLER
echo    Installs everything: app + database + desktop shortcuts
echo    (Node.js + SQLite - no Docker needed)
echo  ============================================================
echo.

REM ==========================================================================
REM STEP 1 of 4 - Locate the application source (this folder, or download it)
REM ==========================================================================
set "ROOT=%cd%"
if exist "deploy\nodocker\install-nodocker.ps1" (
  echo [1/4] Using the app source found in this folder.
) else (
  if exist "%USERPROFILE%\mbumah-hardware-pos\deploy\nodocker\install-nodocker.ps1" (
    set "ROOT=%USERPROFILE%\mbumah-hardware-pos"
    echo [1/4] Using the app source found in !ROOT!.
  ) else (
    echo [1/4] Downloading the latest Mbumah POS from GitHub...
    powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue';[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;$z="$env:TEMP\mbumah-pos.zip";$d="$env:TEMP\mbumah-pos-src";iwr https://codeload.github.com/bucky-ops/mbumah-hardware-pos/zip/refs/heads/main -OutFile $z;if(test-path $d){ri $d -r -fo};Expand-Archive $z $d -Force;$s=(gci $d -Directory|select -First 1).FullName;if(test-path "$env:USERPROFILE\mbumah-hardware-pos"){ri "$env:USERPROFILE\mbumah-hardware-pos" -r -fo};mi $s "$env:USERPROFILE\mbumah-hardware-pos""
    if not exist "%USERPROFILE%\mbumah-hardware-pos\deploy\nodocker\install-nodocker.ps1" (
      color 0C
      echo.
      echo  Download failed. Do it manually:
      echo   1. Open  https://github.com/bucky-ops/mbumah-hardware-pos
      echo   2. Click Code ^> Download ZIP, then extract it
      echo   3. Double-click Install-Mbumah-POS.bat inside the extracted folder
      echo.
      pause
      exit /b 1
    )
    set "ROOT=%USERPROFILE%\mbumah-hardware-pos"
    echo [1/4] Download complete.
  )
)

cd /d "!ROOT!"

REM ==========================================================================
REM STEP 2 of 4 - Node.js 20+ (auto-install if missing)
REM ==========================================================================
set "NODEV="
for /f "delims=" %%v in ('node -v 2^>nul') do set "NODEV=%%v"
if not defined NODEV (
  echo [2/4] Installing Node.js LTS ^(one-time, needs internet^)...
  winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
  set "PATH=!PATH!;%ProgramFiles%\nodejs;%APPDATA%\npm"
)
set "NODEV="
for /f "delims=" %%v in ('node -v 2^>nul') do set "NODEV=%%v"
if not defined NODEV (
  color 0C
  echo.
  echo  Node.js could not be installed automatically.
  echo    1. Download the LTS version from  https://nodejs.org
  echo    2. Install it ^(Next, Next, Finish^)
  echo    3. Run this installer again.
  echo.
  pause
  exit /b 1
)
echo [2/4] Node.js is ready ^(!NODEV!^).

REM ==========================================================================
REM STEP 3 of 4 - Full install: dependencies + database + build
REM ==========================================================================
echo [3/4] Installing the complete system ^(5-20 minutes - keep this window open^)...
powershell -NoProfile -ExecutionPolicy Bypass -File "deploy\nodocker\install-nodocker.ps1" %*
if %errorlevel% neq 0 (
  color 0C
  echo.
  echo  Installation hit a problem. Scroll up for the red [FAIL] line,
  echo  take a photo of the screen and send it to your developer.
  echo.
  pause
  exit /b 1
)

REM ==========================================================================
REM STEP 4 of 4 - Desktop shortcuts
REM ==========================================================================
echo [4/4] Creating desktop shortcuts...
powershell -NoProfile -ExecutionPolicy Bypass -File "deploy\nodocker\create-shortcuts.ps1"

color 0A
echo.
echo  ============================================================
echo    INSTALL COMPLETE
echo.
echo    Every morning : double-click  "Mbumah POS"  on the Desktop
echo    Every evening : close the black windows, then double-click
echo                    "Backup POS Data"
echo  ============================================================
echo.
pause
