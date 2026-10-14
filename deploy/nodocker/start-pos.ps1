# ============================================================================
# MBUMAH HARDWARE POS - Start the POS (Windows, no Docker)
# ============================================================================
# Opens TWO console windows:
#   1. This one  - the POS server itself (closing it stops the POS)
#   2. "Background jobs" - hourly/nightly maintenance (keep it open too)
# The browser opens ONLY after the server reports healthy.
# ============================================================================
param(
  # -NoBrowser: start everything but do NOT auto-open the browser (used by
  # the nightly updater, which restarts the POS at 23:00 - a browser popping
  # up would be surprising). Interactive users: just run without arguments.
  [switch]$NoBrowser,
  # -NoUpdate: skip the one-time update check this launch (normal users never
  # need it - the check itself is controlled by UPDATE_ON_START in .env).
  [switch]$NoUpdate
)
$ErrorActionPreference = 'Stop'

try {
  $root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  Set-Location $root

  # Refresh standalone static/public copies (idempotent, cheap - needed after
  # rebuilds). v2.18.0.2: only relevant when a standalone output exists
  # (Docker / Linux). Windows laptops build NORMAL output (started via
  # `next start` by start-server.mjs), so a .next/BUILD_ID is enough here.
  if (Test-Path '.next\standalone') {
    if (Test-Path '.next\static') {
      New-Item -ItemType Directory -Force -Path '.next\standalone\.next' | Out-Null
      Copy-Item '.next\static' '.next\standalone\.next\' -Recurse -Force
    }
    if (Test-Path 'public') { Copy-Item 'public' '.next\standalone\' -Recurse -Force }
  } elseif (-not (Test-Path '.next\BUILD_ID')) {
    Write-Host '[FAIL] No build found. Run the installer first:' -ForegroundColor Red
    Write-Host '       powershell -ExecutionPolicy Bypass -File deploy\nodocker\install-nodocker.ps1'
    Read-Host 'Press Enter to close'
    exit 1
  }

  # ------------------------------------------------------------------
  # UPDATE ON STARTUP (v2.10.1): every launch checks GitHub for a newer
  # release and installs it BEFORE the POS starts. This is the catch-up
  # path for installs that were off at 23:00 (the nightly task) - and for
  # installs created before the nightly updater existed: with internet,
  # every copy converges to the latest release the next time it is opened.
  # The updater is safe here: it backs up the database first, never touches
  # data, and rolls the CODE back automatically if any step fails.
  # Disable with UPDATE_ON_START=0 in .env (or skip once with -NoUpdate).
  # ------------------------------------------------------------------
  if (-not $NoBrowser -and -not $NoUpdate) {
    $updateOnStart = $true
    $uosLine = Get-Content (Join-Path $root '.env') -ErrorAction SilentlyContinue |
      Where-Object { $_ -match '^UPDATE_ON_START=(.*)$' } | Select-Object -First 1
    if ("$uosLine" -match '^UPDATE_ON_START=(.*)$') {
      $v = $Matches[1].Trim().Trim('"').Trim("'")
      if ($v -eq '0' -or $v -ieq 'false' -or $v -ieq 'no' -or $v -ieq 'off') { $updateOnStart = $false }
    }
    if ($updateOnStart) {
      $pkgBefore = ""
      try {
        # v2.18.0.1: prefer the four-part correction version so the
        # "was updated to vX.Y.Z.W" message is accurate for hotfix releases.
        $p = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
        $pkgBefore = if ($p.mbumah -and $p.mbumah.releaseVersion) { "$($p.mbumah.releaseVersion)" } else { "$($p.version)" }
      } catch { }
      Write-Host ''
      Write-Host 'Checking for updates... (disable with UPDATE_ON_START=0 in .env)'
      try {
        # -Quiet: short network timeouts; -NoStart: WE start the POS below,
        # on the updated code (prevents two servers on one port).
        & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'update-pos.ps1') -Quiet -NoStart
      } catch {
        Write-Host "[WARN] Update check could not run: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host '       Starting the POS anyway.'
      }
      $pkgAfter = ""
      try {
        $p2 = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
        $pkgAfter = if ($p2.mbumah -and $p2.mbumah.releaseVersion) { "$($p2.mbumah.releaseVersion)" } else { "$($p2.version)" }
      } catch { }
      if ($pkgAfter -and $pkgBefore -and ($pkgAfter -ne $pkgBefore)) {
        Write-Host "[OK] Mbumah POS was updated to v$pkgAfter." -ForegroundColor Green
      }
    }
  }

  # Background jobs in their own window
  Start-Process powershell -ArgumentList '-NoExit','-ExecutionPolicy','Bypass','-Command',
    "Set-Location '$root'; Write-Host 'Mbumah POS - background jobs (keep open)'; node deploy\nodocker\cron-local.mjs"

  # Port from .env (default 3000)
  $port = 3000
  $appPortLine = Get-Content (Join-Path $root '.env') -ErrorAction SilentlyContinue |
    Where-Object { $_ -match '^APP_PORT=(\d+)' } | Select-Object -First 1
  if ($appPortLine -match '^APP_PORT=(\d+)') { $port = [int]$Matches[1] }

  # Start the server IN THIS WINDOW (background job, output visible here)
  Write-Host ''
  Write-Host 'Starting MBUMAH HARDWARE POS... (keep this window open - closing it stops the POS)'
  $server = Start-Process -FilePath 'node' -ArgumentList 'deploy\nodocker\start-server.mjs' `
            -WorkingDirectory $root -NoNewWindow -PassThru

  # Wait until the server is healthy AND the database actually answers
  # (a 200 from /api/health alone also happens on an EMPTY database, which
  # renders as "backend unavailable / all modules unavailable" in the UI).
  Write-Host 'Waiting for the POS to become ready (this can take up to a minute)...'
  $ready = $false
  $dbEmpty = $false
  $dbError = ''
  for ($i = 0; $i -lt 30; $i++) {
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 3
      if ($r.StatusCode -eq 200) {
        $h = $r.Content | ConvertFrom-Json
        $stats = $h.checks.database_stats.status
        if ($stats -eq 'ok') { $ready = $true; break }
        if ($h.checks.database -and $h.checks.database.status -eq 'ok') {
          # Server is up and connected, but table queries fail → empty/mismatched DB
          $dbEmpty = $true
          if ($h.checks.database_stats.detail) { $dbError = $h.checks.database_stats.detail }
        }
      }
    } catch { Start-Sleep -Seconds 2; continue }
    Start-Sleep -Seconds 2
  }

  if ($ready) {
    Write-Host ''
    if ($NoBrowser) {
      Write-Host 'POS is ready. (-NoBrowser: not opening a browser window.)' -ForegroundColor Green
    } else {
      Write-Host 'POS is ready - opening your browser...' -ForegroundColor Green
      Start-Process "http://localhost:$port"
    }
  } elseif ($dbEmpty) {
    Write-Host ''
    Write-Host 'WARNING: the server is running but the DATABASE is not ready.' -ForegroundColor Yellow
    if ($dbError) { Write-Host "  Detail: $dbError" -ForegroundColor Yellow }
    Write-Host '  The screen may say "backend unavailable" and every module may be unavailable.'
    Write-Host '  Fix: close this window, then re-run the installer'
    Write-Host '    powershell -ExecutionPolicy Bypass -File deploy\nodocker\install-nodocker.ps1'
    Write-Host '  (it will re-create the schema and seed the admin account).'
    Write-Host '  You can also diagnose with: node deploy\nodocker\verify-db.mjs'
  } else {
    Write-Host ''
    Write-Host 'WARNING: the server did not respond within 60 seconds.' -ForegroundColor Yellow
    Write-Host 'Check the errors above, take a photo and send it to your developer.'
    Write-Host "You can also open http://localhost:$port manually in a moment."
  }

  # Keep this window open while the server runs. v2.18.0.1: if the server
  # process already exited (it printed a startup error and quit), plain
  # Wait-Process used to throw the scary red "[ERROR] Cannot find a process
  # with the process identifier ..." line - explain calmly instead.
  try {
    Wait-Process -Id $server.Id -ErrorAction Stop
  } catch {
    Write-Host ''
    Write-Host 'The POS server process exited early. Scroll up for the reason' -ForegroundColor Yellow
    Write-Host '(a line starting with an X or a WARNING). Most common fixes:'
    Write-Host '  - "Build output missing": run Update-Mbumah-POS.bat once with internet'
    Write-Host '  - database problems:   node deploy\nodocker\verify-db.mjs'
  }
} catch {
  Write-Host ''
  Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Take a photo of this screen and send it to your developer.'
  Read-Host 'Press Enter to close'
}
