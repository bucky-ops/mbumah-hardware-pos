# ============================================================================
# MBUMAH HARDWARE POS - One-click database backup (Windows, no Docker)
# ============================================================================
# Copies the single SQLite database file (plus .env configuration) into
# Desktop\MbumahBackups\ with a timestamp. Safe, simple, no technical
# knowledge needed. Run it after closing the shop (POS windows closed).
# ============================================================================
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
  Read-Host 'Press Enter to close'
  exit 1
}

Write-Host 'IMPORTANT: for a safe backup, close the POS black windows first.'
$answer = Read-Host 'Continue with backup? (Y = yes)'
if ($answer -ne 'Y' -and $answer -ne 'y') {
  Write-Host 'Backup cancelled.'
  Read-Host 'Press Enter to close'
  exit 0
}

$destDir = Join-Path ([Environment]::GetFolderPath('Desktop')) 'MbumahBackups'
New-Item -ItemType Directory -Force -Path $destDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

Copy-Item $db (Join-Path $destDir "pos-$stamp.db") -Force
Write-Host "[OK] Database backed up:  $destDir\pos-$stamp.db"

$envFile = Join-Path $root '.env'
if (Test-Path $envFile) {
  Copy-Item $envFile (Join-Path $destDir "env-$stamp.bak") -Force
  Write-Host "[OK] Configuration backed up:  $destDir\env-$stamp.bak"
}

Write-Host ''
Write-Host 'Now copy the MbumahBackups folder to a USB stick or OneDrive.'
Write-Host '(A backup that only lives on the same laptop is not a backup!)'
Read-Host 'Press Enter to close'
