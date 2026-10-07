# MBUMAH HARDWARE POS - Uninstaller (Windows, no Docker)
#
# Called by Uninstall-Mbumah-POS.bat at the repo root (or run directly:
#   powershell -ExecutionPolicy Bypass -File deploy\nodocker\uninstall-nodocker.ps1
# )
#
# What it does (in order, with confirmation at every destructive step):
#   1. Offers one final data backup (Desktop\MbumahBackups) before removing anything.
#   2. Stops the running Mbumah POS server / cron background jobs (node processes
#      started from THIS app folder only - it never touches unrelated node apps).
#   3. Removes the desktop shortcuts ("Mbumah POS", "Backup POS Data").
#   4. Asks before deleting the app folder itself.
# The backup folder (Desktop\MbumahBackups) is NEVER deleted - your data outlives the app.

$ErrorActionPreference = 'Stop'

# ── Locate the app root (folder that contains deploy\nodocker) ──────────────
$root = Split-Path -Parent $PSScriptRoot   # deploy/nodocker -> deploy
$root = Split-Path -Parent $root           # deploy -> app root
if (-not (Test-Path (Join-Path $root 'deploy\nodocker'))) {
  Write-Host ''
  Write-Host '[ERROR] This script must live in <app folder>\deploy\nodocker.' -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}

Write-Host ''
Write-Host '============================================================' -ForegroundColor Yellow
Write-Host '  MBUMAH HARDWARE POS - UNINSTALL' -ForegroundColor Yellow
Write-Host '  This removes the POS app from this computer.' -ForegroundColor Yellow
Write-Host '============================================================' -ForegroundColor Yellow
Write-Host ''
Write-Host "App folder : $root"
Write-Host 'Your sales data lives in the database inside that folder,'
Write-Host 'so we will offer a final backup first.'
Write-Host ''

# ── Step 1: offer a final backup ────────────────────────────────────────────
$answer = Read-Host 'Back up your data one last time before uninstalling? (Y = yes, strongly recommended)'
if ($answer -match '^[Yy]') {
  & (Join-Path $PSScriptRoot 'backup-pos.ps1')
}

# ── Step 2: stop Mbumah POS background jobs (node from THIS folder only) ────
Write-Host ''
Write-Host '[1/3] Stopping the Mbumah POS background jobs...'
try {
  $rootForMatch = $root.Replace('\', '\\')
  $procs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and ($_.CommandLine -like "*$root*start-server.mjs*" -or $_.CommandLine -like "*$root*cron-local.mjs*") }
  if ($procs) {
    foreach ($p in $procs) {
      try {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
        Write-Host ("       stopped node process " + $p.ProcessId)
      } catch { }
    }
  } else {
    Write-Host '       no running Mbumah POS processes found.'
  }
} catch {
  Write-Host '       (could not query running processes - continuing.)' -ForegroundColor Yellow
}

# ── Step 3: desktop shortcuts ───────────────────────────────────────────────
Write-Host '[2/3] Removing desktop shortcuts...'
$desktop = [Environment]::GetFolderPath('Desktop')
foreach ($name in @('Mbumah POS', 'Backup POS Data')) {
  $lnk = Join-Path $desktop "$name.lnk"
  if (Test-Path $lnk) {
    Remove-Item $lnk -Force
    Write-Host "       removed  $name.lnk"
  }
}

# ── Step 4: the app folder itself ───────────────────────────────────────────
Write-Host '[3/3] Removing the app folder...'
$answer = Read-Host "Delete the app folder and its database?  $root  (type DELETE in capitals to confirm)"
if ($answer -ceq 'DELETE') {
  try {
    Remove-Item -LiteralPath $root -Recurse -Force
    Write-Host ''
    Write-Host '============================================================' -ForegroundColor Green
    Write-Host '  MBUMAH HARDWARE POS HAS BEEN UNINSTALLED' -ForegroundColor Green
    Write-Host '  Your backups are safe in  Desktop\MbumahBackups' -ForegroundColor Green
    Write-Host '============================================================' -ForegroundColor Green
  } catch {
    Write-Host ''
    Write-Host "[WARN] Some files could not be deleted (a window may still be open)." -ForegroundColor Yellow
    Write-Host "       Close every black Mbumah window and delete this folder manually:" -ForegroundColor Yellow
    Write-Host "       $root"
  }
} else {
  Write-Host ''
  Write-Host 'App folder KEPT - nothing was deleted.' -ForegroundColor Yellow
  Write-Host 'Shortcuts and background jobs were removed, so the app will not start anymore.'
  Write-Host "If you change your mind, delete this folder manually: $root"
}

Write-Host ''
Read-Host 'Press Enter to close'
