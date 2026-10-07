# ============================================================================
# MBUMAH HARDWARE POS - One-click database backup (Windows, no Docker)
# ============================================================================
# Copies the single SQLite database file (plus its -wal/-shm sidecars when
# present, plus the .env configuration) into Desktop\MbumahBackups\ with a
# timestamp. Safe, simple, no technical knowledge needed.
#
# Two ways to run:
#   1. By hand (double-click "Backup POS Data" / this script): asks for a
#      confirmation and waits for Enter before closing.
#   2. Unattended (the "Mbumah POS Nightly Backup" scheduled task, 02:30):
#      ... -Unattended   -> no prompts at all, just backs up and exits.
# ============================================================================
param(
  [switch]$Unattended
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$db   = Join-Path $HOME 'mbumah-pos-data\pos.db'

Write-Host ''
Write-Host '=============================================================='
Write-Host '  MBUMAH HARDWARE POS - BACKUP'
Write-Host '=============================================================='
Write-Host ''

if (-not (Test-Path $db)) {
  Write-Host "[FAIL] Database not found at: $db" -ForegroundColor Red
  Write-Host '       Install the POS first, or ask your developer.'
  if (-not $Unattended) { Read-Host 'Press Enter to close' }
  exit 1
}

if (-not $Unattended) {
  Write-Host 'IMPORTANT: for the safest backup, close the POS black windows first.'
  $answer = Read-Host 'Continue with backup? (Y = yes)'
  if ($answer -ne 'Y' -and $answer -ne 'y') {
    Write-Host 'Backup cancelled.'
    Read-Host 'Press Enter to close'
    exit 0
  }
}

$destDir = Join-Path ([Environment]::GetFolderPath('Desktop')) 'MbumahBackups'
New-Item -ItemType Directory -Force -Path $destDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

Copy-Item $db (Join-Path $destDir "pos-$stamp.db") -Force
Write-Host "[OK] Database backed up:  $destDir\pos-$stamp.db"

# SQLite sidecars (write-ahead log / shared memory) - copy them too when the
# POS is running, otherwise the .db copy alone may be missing recent writes.
foreach ($side in @('pos.db-wal', 'pos.db-shm')) {
  $sidePath = Join-Path $HOME ('mbumah-pos-data\' + $side)
  if (Test-Path $sidePath) {
    Copy-Item $sidePath (Join-Path $destDir "$side-$stamp") -Force
    Write-Host "[OK] Sidecar backed up:   $destDir\$side-$stamp"
  }
}

$envFile = Join-Path $root '.env'
if (Test-Path $envFile) {
  Copy-Item $envFile (Join-Path $destDir "env-$stamp.bak") -Force
  Write-Host "[OK] Configuration backed up:  $destDir\env-$stamp.bak"
}

Write-Host ''
Write-Host 'Now copy the MbumahBackups folder to a USB stick or OneDrive.'
Write-Host '(A backup that only lives on the same laptop is not a backup!)'
if (-not $Unattended) { Read-Host 'Press Enter to close' }
