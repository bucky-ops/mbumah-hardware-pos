# ============================================================================
# MBUMAH HARDWARE POS - Rollback to a previous version (Windows, no-Docker)
# ============================================================================
# Thin interactive wrapper around update-pos.ps1:
#   1. Reads the update ledger (%USERPROFILE%\mbumah-pos-data\update-ledger.jsonl)
#      and lists the last 20 successful updates/rollbacks.
#   2. You pick the version you want to go back TO.
#   3. It calls update-pos.ps1 -ToVersion <tag> -Force, which takes a fresh
#      backup, installs the older code, rebuilds and health-checks it - the
#      same safe path as a normal update.
# Your DATA is never changed: versions are forward-compatible, so the database
# always stays as it is (a pre-update backup is taken anyway).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File deploy\nodocker\rollback-pos.ps1
#   ... -ToVersion v2.8.0        skip the menu and roll straight back
# ============================================================================
param(
  [string]$ToVersion = ""
)

$ErrorActionPreference = 'Stop'
$ledgerPath = Join-Path $HOME 'mbumah-pos-data\update-ledger.jsonl'
$updateScript = Join-Path $PSScriptRoot 'update-pos.ps1'

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Yellow
Write-Host '  MBUMAH HARDWARE POS - ROLLBACK TO A PREVIOUS VERSION' -ForegroundColor Yellow
Write-Host '  Your sales data is NOT touched by a rollback.' -ForegroundColor Yellow
Write-Host '==============================================================' -ForegroundColor Yellow
Write-Host ''

if (-not (Test-Path $updateScript)) {
  Write-Host '[FAIL] update-pos.ps1 not found next to this script.' -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}

# -- Resolve the target version when it was not given on the command line ----
if ($ToVersion -eq "") {
  $entries = @()
  try {
    if (Test-Path $ledgerPath) {
      $lines = Get-Content $ledgerPath -ErrorAction SilentlyContinue | Select-Object -Last 100
      foreach ($line in $lines) {
        try {
          $e = $line | ConvertFrom-Json
          if ($e.event -eq 'UPDATE_SUCCESS' -or $e.event -eq 'ROLLBACK_SUCCESS') { $entries += $e }
        } catch { }
      }
      if ($entries.Count -gt 20) { $entries = $entries | Select-Object -Last 20 }
    }
  } catch { $entries = @() }

  # Newest first: the ledger is chronological, so walk it backwards.
  $entries = @($entries); [array]::Reverse($entries)

  if ($entries.Count -gt 0) {
    Write-Host 'Versions this POS has been on (newest first):'
    Write-Host ''
    $n = 0
    foreach ($e in $entries) {
      $n++
      $when = ""
      try { $when = ([datetime]$e.ts).ToString('yyyy-MM-dd HH:mm') } catch { $when = "$($e.ts)" }
      Write-Host ("  {0,2}. {1}  ->  {2}   ({3})" -f $n, $e.from, $e.to, $when)
    }
    Write-Host ''
    Write-Host 'A rollback installs the version in the FROM column of the row you pick.'
    $answer = Read-Host 'Enter the number to roll back to (or press Enter to cancel)'
    if ($answer -match '^\d+$') {
      $idx = [int]$answer
      if ($idx -ge 1 -and $idx -le $entries.Count) {
        $picked = $entries[$idx - 1]
        $ToVersion = "$($picked.from)"
      }
    }
    if ($ToVersion -eq "") {
      Write-Host 'Rollback cancelled - nothing was changed.'
      Read-Host 'Press Enter to close'
      exit 0
    }
  } else {
    # Empty / missing ledger: fall back to the previous git tag, else manual reinstall.
    Write-Host '[INFO] No update history found yet (the ledger is created by updates).'
    $prevTag = ""
    try {
      $tags = git tag --sort=-creatordate 2>$null
      if ($tags -and $tags.Count -ge 2) { $prevTag = $tags[1] }
    } catch { $prevTag = "" }
    if ($prevTag -ne "") {
      Write-Host "[INFO] Based on the git history, the previous version is: $prevTag"
      $answer = Read-Host "Roll back to $prevTag now? (y/N)"
      if ($answer -match '^[Yy]') { $ToVersion = $prevTag }
    } else {
      Write-Host '[INFO] This copy was installed from a ZIP, so there is no local version history.'
      Write-Host '       To go back to an older version: uninstall (Uninstall-Mbumah-POS.bat),'
      Write-Host '       then re-install from the release ZIP you want (Install-Mbumah-POS.bat).'
      Read-Host 'Press Enter to close'
      exit 0
    }
    if ($ToVersion -eq "") {
      Write-Host 'Rollback cancelled - nothing was changed.'
      Read-Host 'Press Enter to close'
      exit 0
    }
  }
}

if (-not $ToVersion.StartsWith('v')) { $ToVersion = 'v' + $ToVersion }

Write-Host ''
Write-Host "[ROLLBACK] Going back to $ToVersion (a fresh backup is taken first)..."
Write-Host ''

# Run the updater as a separate process so its exit code is unambiguous.
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $updateScript -ToVersion $ToVersion -Force
$code = $LASTEXITCODE

Write-Host ''
if ($code -eq 0) {
  Write-Host "[OK] Rollback to $ToVersion finished successfully." -ForegroundColor Green
} else {
  Write-Host "[FAIL] Rollback had a problem - see the messages above." -ForegroundColor Red
  Write-Host '       Take a photo of the screen and send it to your developer.'
}
Read-Host 'Press Enter to close'
exit $code
