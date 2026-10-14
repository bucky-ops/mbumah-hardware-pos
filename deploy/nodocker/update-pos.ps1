# ============================================================================
# MBUMAH HARDWARE POS - Automatic Updater (Windows, no-Docker laptop install)
# ============================================================================
# Downloads and installs the newest release from GitHub during DORMANT hours
# (default 22:00-06:00), with:
#   1. A pre-update backup of the database + .env  (Desktop\MbumahBackups\pre-update)
#   2. Code update (git checkout of the release tag, or ZIP when no .git)
#   3. The exact rebuild sequence the installer uses
#      (npm install -> db:push -> build -> verify-db -> assemble standalone)
#      where db:push is the SELF-HEALING schema converge (v2.15.2:
#      scripts/ensure-schema.mjs - backs up SQLite data and converges with
#      --accept-data-loss when adding unique indexes is refused), so
#      databases that lagged the code repair themselves during the update.
#   4. Server restart + health gate (database must answer, not just HTTP 200)
#   5. AUTOMATIC CODE ROLLBACK if any step fails (data is never touched -
#      SQLite schemas in this project are forward-compatible)
#
# Every decision is recorded (one JSON line per event) in the update ledger:
#   %USERPROFILE%\mbumah-pos-data\update-ledger.jsonl
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File deploy\nodocker\update-pos.ps1
#   ... -Force                update NOW, ignore the dormant window
#   ... -ToVersion v2.9.0     install a specific release tag instead of latest
#   ... -SkipBackup           do not take the pre-update backup (not recommended)
#   ... -WindowStart 22:00 -WindowEnd 06:00     custom dormant window
#   ... -Quiet                scripted mode (start-pos.ps1 calls this on every
#                             launch): shorter network timeouts, no interactive
#                             assumptions, harmless exit codes
#   ... -NoStart              do NOT auto-start the POS after the update - the
#                             caller does it (start-pos.ps1 continues its normal
#                             startup on the NEW code; avoids double servers)
#
# Designed for Task Scheduler ("Mbumah POS Nightly Update", 23:00, hidden):
# it NEVER prompts, never fails loudly when offline, and exits 0 on the
# harmless outcomes (skipped window, offline check, already up to date).
# ============================================================================
param(
  [switch]$Force,
  [string]$ToVersion = "",
  [switch]$SkipBackup,
  [string]$WindowStart = "22:00",
  [string]$WindowEnd = "06:00",
  [switch]$Quiet,
  [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Old Windows shells may default to TLS 1.0 - releases need TLS 1.2 (same as installer)
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $root
$repoSlug = 'bucky-ops/mbumah-hardware-pos'

# -- Helpers ------------------------------------------------------------------

function Write-Ledger([string]$Event, [string]$From, [string]$To, [string]$Detail) {
  # One JSON line per event. NEVER throws - the ledger must not break updates.
  try {
    $dir = Join-Path $HOME 'mbumah-pos-data'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $entry = [ordered]@{
      ts     = (Get-Date).ToString('o')
      event  = $Event
      from   = $From
      to     = $To
      detail = $Detail
    }
    $line = ConvertTo-Json -InputObject $entry -Compress
    Add-Content -Path (Join-Path $dir 'update-ledger.jsonl') -Value $line -Encoding UTF8
  } catch { }
}

# v2.18.0.2: machine-local update state for the script updaters, using the
# same schema as the staged updater's updater/update-state.json
# (src/lib/updater/state.ts). The server-triggered staged flow owns the repo
# file; the nightly/startup updaters own this one. Best effort only - a
# state write must never break an update.
$script:StateFrom = ''
$script:StateTo = ''
$script:StateStartedAt = (Get-Date).ToString('o')
$script:StateBackupPath = ''
$script:StateBuildLog = ''
$script:StateRollbackAvail = $false
$script:StateChannel = 'stable'

function Write-UpdateState([string]$State, [int]$Progress, [string]$Detail) {
  try {
    $dir = Join-Path $HOME 'mbumah-pos-data'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $entry = [ordered]@{
      currentVersion      = $script:StateFrom
      pendingVersion      = $script:StateTo
      state               = $State
      progress            = $Progress
      phase               = $State
      detail              = $Detail
      startedAt           = $script:StateStartedAt
      updatedAt           = (Get-Date).ToString('o')
      backupPath          = $script:StateBackupPath
      buildLogPath        = $script:StateBuildLog
      verificationLogPath = ''
      error               = ''
      rollbackAvailable   = $script:StateRollbackAvail
      channel             = $script:StateChannel
    }
    $json = ConvertTo-Json -InputObject $entry -Compress
    Set-Content -Path (Join-Path $dir 'update-state.json') -Value $json -Encoding UTF8
  } catch { }
}

function Write-UpdateStateError([string]$State, [int]$Progress, [string]$Detail) {
  try {
    $dir = Join-Path $HOME 'mbumah-pos-data'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $entry = [ordered]@{
      currentVersion      = $script:StateFrom
      pendingVersion      = $script:StateTo
      state               = $State
      progress            = $Progress
      phase               = $State
      detail              = ''
      startedAt           = $script:StateStartedAt
      updatedAt           = (Get-Date).ToString('o')
      backupPath          = $script:StateBackupPath
      buildLogPath        = $script:StateBuildLog
      verificationLogPath = ''
      error               = $Detail
      rollbackAvailable   = $script:StateRollbackAvail
      channel             = $script:StateChannel
    }
    $json = ConvertTo-Json -InputObject $entry -Compress
    Set-Content -Path (Join-Path $dir 'update-state.json') -Value $json -Encoding UTF8
  } catch { }
}

function Get-EnvValue([string]$Name) {
  $line = Get-Content (Join-Path $root '.env') -ErrorAction SilentlyContinue |
    Where-Object { $_ -match ('^' + $Name + '=(.*)$') } | Select-Object -First 1
  if ($line -match ('^' + $Name + '=(.*)$')) {
    $v = $Matches[1].Trim().Trim('"').Trim("'")
    return $v
  }
  return ""
}

function Get-AppProcs {
  # Only node processes started from THIS app folder (same rule as the uninstaller).
  # v2.18.0.2: on Windows the server can run as `next start` (normal build
  # mode) - a CHILD of start-server.mjs. Match that command line too so a
  # crashed launcher cannot leave an orphaned server holding port 3000.
  $found = $null
  try {
    $found = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
      Where-Object {
        $_.CommandLine -and (
          ($_.CommandLine -like "*$root*start-server.mjs*") -or
          ($_.CommandLine -like "*$root*cron-local.mjs*") -or
          ($_.CommandLine -like "*$root*" -and $_.CommandLine -like "*next start*")
        )
      }
  } catch { $found = $null }
  return $found
}

function Stop-AppProcs {
  $procs = Get-AppProcs
  if ($procs) {
    foreach ($p in $procs) {
      # v2.18.0.2: TREE kill. `next start` runs as a child of
      # start-server.mjs; killing only the parent would orphan the server
      # and the next start attempt would fail with EADDRINUSE. taskkill /T
      # also tolerates already-exited processes (no "cannot find process"
      # noise) - Stop-Process stays as the fallback.
      try { taskkill /PID $p.ProcessId /T /F 2>$null | Out-Null } catch { }
      try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch { }
    }
    Start-Sleep -Seconds 2
  }
}

function Convert-TimeToMinutes([string]$TimeStr) {
  $parts = ([string]$TimeStr) -split ':'
  $h = 0; $m = 0
  try { $h = [int]$parts[0] } catch { $h = 0 }
  if ($parts.Count -gt 1) { try { $m = [int]$parts[1] } catch { $m = 0 } }
  return ($h * 60 + $m)
}

function Test-InDormantWindow {
  $startMin = Convert-TimeToMinutes $WindowStart
  $endMin   = Convert-TimeToMinutes $WindowEnd
  $now = Get-Date
  $cur = $now.Hour * 60 + $now.Minute
  if ($startMin -eq $endMin) { return $true }        # degenerate window = always inside
  if ($startMin -lt $endMin) {                        # normal window, e.g. 22:00-23:59
    return (($cur -ge $startMin) -and ($cur -lt $endMin))
  }
  return (($cur -ge $startMin) -or ($cur -lt $endMin))  # wraps midnight, e.g. 22:00-06:00
}

function Ensure-ScheduledTasks {
  # Self-heal (v2.10.1): installs that predate the nightly tasks - or that
  # received their FIRST update via the start-pos.ps1 startup check - may not
  # have "Mbumah POS Nightly Update/Backup" registered. Re-create any missing
  # task (same /tr quoting as the installer: full -File path, no /tr comma
  # mangling on Windows PowerShell 5.1) so the dormant-window automation
  # takes over from the next night on. Never throws.
  # v2.11.0: also re-registers the RAK agent ("Mbumah POS Agent", every 15 min)
  # so remote commands keep flowing after any update.
  $tasks = @(
    @{ Name = 'Mbumah POS Nightly Update'; Time = '23:00'; File = 'deploy\nodocker\update-pos.ps1'; Extra = '' },
    @{ Name = 'Mbumah POS Nightly Backup'; Time = '02:30'; File = 'deploy\nodocker\backup-pos.ps1'; Extra = ' -Unattended' }
  )
  foreach ($t in $tasks) {
    $exists = $false
    try {
      schtasks /query /tn "$($t.Name)" > $null 2>&1
      if ($LASTEXITCODE -eq 0) { $exists = $true }
    } catch { $exists = $false }
    if ($exists) { continue }
    $scriptPath = Join-Path $root $t.File
    if (-not (Test-Path $scriptPath)) { continue }
    $tr = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $scriptPath + '"' + $t.Extra
    try {
      schtasks /create /f /tn "$($t.Name)" /sc daily /st $t.Time /tr $tr | Out-Null
      if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] Scheduled task '$($t.Name)' registered (daily $($t.Time), hidden)."
        Write-Ledger 'TASK_REGISTERED' '' '' $t.Name
      }
    } catch { }
  }
  # RAK agent - different cadence (every 15 min), registered separately.
  $agentTask = 'Mbumah POS Agent'
  $agentExists = $false
  try {
    schtasks /query /tn "$agentTask" > $null 2>&1
    if ($LASTEXITCODE -eq 0) { $agentExists = $true }
  } catch { $agentExists = $false }
  if (-not $agentExists) {
    $agentPath = Join-Path $root 'deploy\nodocker\agent.mjs'
    if (Test-Path $agentPath) {
      $agentTr = 'node.exe --no-warnings "' + $agentPath + '"'
      try {
        schtasks /create /f /tn "$agentTask" /sc minute /mo 15 /tr $agentTr | Out-Null
        if ($LASTEXITCODE -eq 0) {
          Write-Host "[OK] Scheduled task '$agentTask' registered (every 15 min, hidden)."
          Write-Ledger 'TASK_REGISTERED' '' '' $agentTask
        }
      } catch { }
    }
  }
}

function Invoke-Checked([string]$Label, [string]$Command) {
  # Same pattern as the installer's Run-Step, but returns instead of exiting
  # so the caller can trigger the rollback path.
  Write-Host $Label
  cmd /c $Command
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAIL] $Label -> failed (exit $LASTEXITCODE)" -ForegroundColor Red
    return $false
  }
  return $true
}

function Set-BuildEnvironment {
  # .env is the single source of truth (same precedence rule as start-server.mjs)
  $dbUrl = Get-EnvValue 'DATABASE_URL'
  if ($dbUrl -ne "") { $env:DATABASE_URL = $dbUrl }
  $dUrl = Get-EnvValue 'DIRECT_URL'
  if ($dUrl -ne "") { $env:DIRECT_URL = $dUrl }
  $env:SKIP_ENV_VALIDATION = '1'
  # v2.18.0.2: Windows NO LONGER builds standalone output. The launcher
  # (start-server.mjs) starts the plain build with `next start`; standalone
  # output is only produced for Docker and Linux deployments
  # (next.config.ts resolveStandaloneOutput). This also removes the entire
  # Windows trace-copy/EINVAL failure class from the update path.
  Remove-Item Env:BUILD_STANDALONE -ErrorAction SilentlyContinue
}

function Repair-SharpBinary {
  # v2.18.0.1: next/image optimization needs sharp's NATIVE binary for this
  # exact platform. Some Windows machines end up without it (optional deps
  # skipped by an npm config, antivirus interference, a bad cache), which
  # made every optimized image 500 at runtime - the "Could not load the
  # sharp module using the win32-x64 runtime" field report. Best effort:
  # if the win32-x64 binary is missing, run the documented sharp repair once.
  # If it is STILL missing afterwards, next.config.ts bakes
  # images.unoptimized=true into this standalone build (build-time probe),
  # so product photos keep working - just without resizing.
  if ($env:OS -ne 'Windows_NT') { return }
  $sharpBin = Join-Path $root 'node_modules\@img\sharp-win32-x64\lib\sharp-win32-x64.node'
  if (Test-Path $sharpBin) { return }
  Write-Host '[WARN] sharp image library is missing its Windows binary - repairing...' -ForegroundColor Yellow
  Write-Ledger 'SHARP_REPAIR' '' '' 'sharp-win32-x64 binary missing; running npm repair'
  cmd /c 'npm install --no-save --os=win32 --cpu=x64 sharp' | Out-Null
  if (Test-Path $sharpBin) {
    Write-Host '[OK] sharp Windows binary installed.'
  } else {
    Write-Host '[WARN] sharp binary still missing - product photos will be served' -ForegroundColor Yellow
    Write-Host '       unoptimized (this build bakes that in automatically). The POS'
    Write-Host '       works normally; only image resizing is skipped.'
  }
}

function Invoke-PreBuildChecks {
  # v2.18.0.2: cheap safety checks BEFORE anything is downloaded or stopped.
  # Returns $true when it is safe to continue; prints a warning (not a
  # failure) for advisory items.
  # 1. Disk space - npm install + build need roughly 2 GB of temporary space.
  $freeGb = 0
  try {
    $drive = Get-PSDrive -Name ((Resolve-Path $root).Drive.Name) -ErrorAction Stop
    $freeGb = [math]::Round($drive.Free / 1GB, 1)
  } catch { }
  if ($freeGb -gt 0 -and $freeGb -lt 2) {
    Write-Host "[FAIL] Only $freeGb GB of free disk space - an update needs about 2 GB. Free up space and run the update again." -ForegroundColor Red
    return $false
  }
  if ($freeGb -gt 0 -and $freeGb -lt 5) {
    Write-Host "[WARN] Only $freeGb GB of free disk space - the update can run, but consider freeing space." -ForegroundColor Yellow
  }
  # 2. Database file writable.
  try {
    $fs = [System.IO.File]::Open($dbFile, 'Open', 'ReadWrite', 'None')
    $fs.Close()
  } catch {
    Write-Host "[FAIL] The database file is not writable (is another program holding it open?): $($_.Exception.Message)" -ForegroundColor Red
    return $false
  }
  # 3. Install location advisory: sync folders and download folders cause
  #    file locks and OneDrive placeholders. Recommend C:\MbumahPOS.
  if ($root -like '*\Downloads\*' -or $root -like '*\Compressed\*' -or $root -like '*OneDrive*') {
    Write-Host '[WARN] The POS is installed inside a Downloads, Compressed or OneDrive folder.' -ForegroundColor Yellow
    Write-Host '       These folders can lock files during updates. Consider moving the app to' -ForegroundColor Yellow
    Write-Host '       C:\MbumahPOS and running the installer there.' -ForegroundColor Yellow
  }
  # 4. Dependency manifests present.
  if (-not (Test-Path (Join-Path $root 'package.json'))) {
    Write-Host '[FAIL] package.json is missing from the app folder - the install is incomplete.' -ForegroundColor Red
    return $false
  }
  return $true
}

function Invoke-RebuildAndAssemble {
  # Mirrors install-nodocker.ps1 steps 5-7 (minus seeding).
  # NOTE: the app is stopped FIRST - `next build` replaces .next, and Windows
  # keeps loaded engine binaries locked while the old server runs, which
  # would fail the build with EPERM. The full stop-build-verify sequence and
  # the automatic rollback below are the safety net for that choice (a full
  # second staging folder with its own node_modules is the v2.17.9 staged
  # updater's job - see scripts/staged-update.mjs).
  Write-Host '[BUILD 0/4] Stopping the running POS for the rebuild...'
  Stop-AppProcs
  Write-UpdateState 'installing-dependencies' 30 'app stopped, starting rebuild'
  Set-BuildEnvironment
  if (-not (Invoke-Checked "[BUILD 1/4] Installing dependencies (needs internet)..." 'npm install --include=optional')) { return $false }
  Repair-SharpBinary
  if (-not (Invoke-Checked "[BUILD 2/4] Applying the database schema..." 'npm run db:push')) { return $false }

  # v2.18.0.2: remove a stale standalone output from pre-2.18.0.2 releases -
  # the launcher prefers standalone when both exist, so a leftover one would
  # boot the OLD server after a successful update.
  if (Test-Path '.next\standalone') {
    try { Remove-Item '.next\standalone' -Recurse -Force -ErrorAction SilentlyContinue } catch { }
  }

  # v2.18.0.2: capture the build log so a degraded build is DETECTABLE.
  $logDir = Join-Path (Join-Path $HOME 'mbumah-pos-data') 'logs'
  try { New-Item -ItemType Directory -Force -Path $logDir | Out-Null } catch { }
  $safeTag = ($targetTag -replace '[^A-Za-z0-9.\-]', '')
  $buildLog = Join-Path $logDir ("build-{0}-{1}.log" -f $safeTag, (Get-Date -Format 'yyyyMMdd-HHmmss'))
  $script:StateBuildLog = $buildLog
  Write-Host "[BUILD 3/4] Building the production app (log: $buildLog)..."
  Write-UpdateState 'building' 55 'npm run build running'
  cmd /c "npm run build > `"$buildLog`" 2>&1"
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAIL] Build failed (exit $LASTEXITCODE) - last log lines:" -ForegroundColor Red
    try { Get-Content $buildLog -Tail 25 | ForEach-Object { Write-Host "  $_" } } catch { }
    return $false
  }

  Write-Host "[BUILD 4/4] Verifying the database..."
  node deploy\nodocker\verify-db.mjs
  $v = $LASTEXITCODE
  if ($v -eq 10) {
    # Reachable but empty - rollback cannot restore data, so continue and let
    # the health gate decide (data problems are a support call, not a code one).
    Write-Host "[WARN] Database is reachable but EMPTY - continuing." -ForegroundColor Yellow
  } elseif ($v -ne 0) {
    Write-Host "[FAIL] Database verification failed (exit $v)" -ForegroundColor Red
    return $false
  }

  # v2.18.0.2: verify the build output BEFORE declaring success. On Windows
  # this is a NORMAL build (no standalone assembly step anymore); the
  # verifier proves BUILD_ID + server output exist, scans the build log for
  # real build errors and would flag any accidentally-enabled standalone
  # output (EINVAL trace-copy class) as a hard failure.
  Write-Host "[BUILD] Verifying the build output (BUILD_ID, server output, build log)..."
  Write-UpdateState 'verifying-build' 70 'verify-build-output running'
  node scripts\verify-build-output.mjs --build-log "$buildLog"
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAIL] Build output verification failed - see above." -ForegroundColor Red
    return $false
  }
  return $true
}

function Start-AppProcs {
  # Detached + minimized: both processes survive this console exiting
  # (required when launched from the hidden 23:00 scheduled task).
  try {
    Start-Process -FilePath 'node' -ArgumentList 'deploy\nodocker\start-server.mjs' -WorkingDirectory $root -WindowStyle Minimized | Out-Null
    Start-Sleep -Seconds 1
    Start-Process -FilePath 'node' -ArgumentList 'deploy\nodocker\cron-local.mjs' -WorkingDirectory $root -WindowStyle Minimized | Out-Null
  } catch {
    Write-Host "[WARN] Could not start the POS automatically: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

function Test-Healthy([int]$Port) {
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 3
      if ($r.StatusCode -eq 200) {
        $h = $r.Content | ConvertFrom-Json
        if ($h.checks.database_stats.status -eq 'ok') { return $true }
      }
    } catch { }
  }
  return $false
}

function Copy-UpdateZip([string]$Ref) {
  # Download + extract a GitHub ZIP (tag or branch) into a temp folder.
  # Returns the extracted source folder path, or "" on failure.
  try {
    $zip = Join-Path $env:TEMP 'mbumah-update.zip'
    $dest = Join-Path $env:TEMP 'mbumah-update-src'
    $url = "https://codeload.github.com/$repoSlug/zip/refs/$Ref"
    $headers = @{}
    if ($env:GITHUB_TOKEN) { $headers['Authorization'] = "token $($env:GITHUB_TOKEN)" }
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -Headers $headers -TimeoutSec 300
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $dest -Force
    $sub = (Get-ChildItem $dest -Directory | Select-Object -First 1).FullName
    if ($sub) { return $sub }
  } catch {
    Write-Host "[WARN] Could not download/extract $Ref : $($_.Exception.Message)" -ForegroundColor Yellow
  }
  return ""
}

function Copy-TreeOverRoot([string]$Src) {
  # Overlay the new source tree over the repo WITHOUT touching local state:
  # .env / .env.* (secrets), node_modules, .next (build), .git, backups,
  # mbumah-pos-data (database), *.log. Robocopy /E copies only; it never
  # deletes, so anything excluded simply stays as-is.
  $rc = robocopy $Src $root /E /R:2 /W:2 /NFL /NDL /NJH /NJS /NP `
    /XD .git node_modules .next backups mbumah-pos-data `
    /XF .env .env.local .env.development .env.production .env.example *.log
  if ($LASTEXITCODE -ge 8) {
    Write-Host "[FAIL] robocopy failed (exit $LASTEXITCODE)" -ForegroundColor Red
    return $false
  }
  # The .env TEMPLATE is not a secret - refresh it so new installs pick up new keys
  $tpl = Join-Path $Src 'deploy\nodocker\.env.nodocker.example'
  if (Test-Path $tpl) { Copy-Item $tpl (Join-Path $root 'deploy\nodocker\.env.nodocker.example') -Force }
  return $true
}

# ============================================================================
# MAIN
# ============================================================================

Write-Host ''
Write-Host '=============================================================='
Write-Host '  MBUMAH HARDWARE POS - UPDATE'
Write-Host '=============================================================='

# -- a) Resolve root, .env, current version ----------------------------------
$port = 3000
$portLine = Get-EnvValue 'APP_PORT'
if ($portLine -match '^\d+$') { $port = [int]$portLine }

$dbFile = Join-Path $HOME 'mbumah-pos-data\pos.db'
if (-not (Test-Path $dbFile)) {
  # The updater is installed by the installer; a missing DB means no install.
  Write-Host "[WARN] Database not found at $dbFile - nothing to update." -ForegroundColor Yellow
  Write-Ledger 'CHECK_FAILED' '' '' 'pos.db not found (app not installed?)'
  exit 0
}

$currentVersion = ""
try {
  $pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
  $currentVersion = "$($pkg.version)"
  # v2.18.0.1: correction releases carry the full four-part version in the
  # "mbumah" metadata block (package.json "version" stays three-part semver).
  # The comparison below needs THAT version to match the release tag - with
  # the old package.json-only comparison, a machine on v2.18.0.0 (reported
  # as "2.18.0") saw latest release v2.18.0.0 as "newer" forever and rebuilt
  # it on EVERY start.
  if ($pkg.mbumah -and $pkg.mbumah.releaseVersion) { $currentVersion = "$($pkg.mbumah.releaseVersion)" }
} catch { }
$fromVersion = "$currentVersion"
$script:StateFrom = "$currentVersion"
Write-Host "[INFO] App folder : $root"
Write-Host "[INFO] Current version: $currentVersion"
Write-Host "[INFO] Database: $dbFile"

# -- b) Dormant-window check (skipped with -Force or when the POS is closed) --
$appProcs = Get-AppProcs
$serverRunning = ($null -ne $appProcs)
if (-not $Force -and $serverRunning) {
  if (-not (Test-InDormantWindow)) {
    Write-Host "[INFO] Outside the update window ($WindowStart-$WindowEnd) and the POS is running - skipping."
    Write-Host "       Run with -Force to update now anyway."
    Write-Ledger 'SKIPPED_WINDOW' "$fromVersion" '' "window $WindowStart-$WindowEnd, pos running"
    exit 0
  }
  Write-Host "[INFO] Inside the update window ($WindowStart-$WindowEnd)."
} elseif ($serverRunning) {
  Write-Host '[INFO] -Force given - ignoring the update window.'
} else {
  Write-Host '[INFO] POS is not running - safe to update at any time.'
}

# -- c) Determine the target release (v2.18.0.2: validated release selection) -
# The old code took GitHub's "releases/latest" verbatim, which returned
# four-part correction tags as if they were the next normal release (the
# field report: a machine on 2.17.7 was updated to v2.18.0.0). The selector
# (scripts/release/select-release.mjs) enforces the release rules instead:
#   stable channel (default)  -> latest valid three-part release only
#   hotfix channel            -> three-part releases plus valid four-part
#                                hotfixes for the CURRENT version's base
#   manual (-ToVersion)       -> explicit tag, still validated (format and
#                                base existence)
# Invalid tags are ignored and REPORTED, never selected. Never downgrades.
$updateChannel = $env:UPDATE_CHANNEL
if (-not $updateChannel) { $updateChannel = Get-EnvValue 'UPDATE_CHANNEL' }
if (-not $updateChannel) { $updateChannel = 'stable' }
$updateChannel = "$updateChannel".ToLower()
if (@('stable','hotfix','manual') -notcontains $updateChannel) {
  Write-Host "[WARN] Unknown UPDATE_CHANNEL '$updateChannel' - using 'stable'."
  $updateChannel = 'stable'
}
$script:StateChannel = $updateChannel

$timeoutSec = 30; if ($Quiet) { $timeoutSec = 10 }
$selectorArgs = @('scripts/release/select-release.mjs', '--current', "$currentVersion", '--channel', $updateChannel, '--timeout', "$timeoutSec")
if ($ToVersion -ne "") { $selectorArgs += @('--to-version', $ToVersion) }

Write-Host "[INFO] Checking GitHub for releases (channel: $updateChannel)..."
$selectorErr = Join-Path $env:TEMP 'mbumah-select-release.err'
$decisionJson = ""
$selectorExit = 0
try {
  $out = & node @selectorArgs 2>"$selectorErr"
  $selectorExit = $LASTEXITCODE
  $decisionJson = "$($out | Select-Object -Last 1)"
} catch { $selectorExit = 2 }

if ($selectorExit -eq 2) {
  # Scheduled tasks must NEVER spam errors - offline is a normal state.
  Write-Host "[WARN] Could not reach GitHub (offline?). Will try again tomorrow."
  Write-Ledger 'CHECK_FAILED' "$fromVersion" '' 'release check failed (network)'
  exit 0
}
$decision = $null
try { $decision = $decisionJson | ConvertFrom-Json } catch { }
if (-not $decision) {
  $errText = try { (Get-Content $selectorErr -Tail 3) -join ' ' } catch { '' }
  Write-Host "[WARN] Release check could not complete - skipping this run. $errText"
  Write-Ledger 'CHECK_FAILED' "$fromVersion" '' "selector exit $selectorExit $errText"
  exit 0
}

foreach ($ig in @($decision.ignored)) {
  if (-not $ig) { continue }
  Write-Host "[INFO] Ignored invalid release tag: $($ig.tag)"
  Write-Host "       Reason: $($ig.reason)"
  Write-Ledger 'TAG_IGNORED' "$fromVersion" "$($ig.tag)" "$($ig.reason)"
}

if ($decision.action -eq 'up-to-date') {
  Write-Host "[OK] Already up to date (v$currentVersion)."
  Write-Ledger 'UP_TO_DATE' "$fromVersion" "$($decision.selected)" "$($decision.reason)"
  # Self-heal even when current: an install updated before this feature or
  # with a removed task gets its nightly automation back for free.
  Ensure-ScheduledTasks
  Write-UpdateState 'idle' 0 'up to date'
  exit 0
}
if ($decision.action -ne 'update') {
  Write-Host "[WARN] No valid release available - skipping. $($decision.reason)"
  Write-Ledger 'CHECK_FAILED' "$fromVersion" '' "$($decision.reason)"
  exit 0
}

$targetTag = "$($decision.selected)"
$targetVersion = $targetTag.TrimStart('v')
$script:StateTo = $targetVersion
Write-Host "[INFO] Selected release: $targetTag"
Write-Host "       $($decision.reason)"
Write-UpdateState 'selected' 10 "selected $targetTag"

# -- c2) Dry run (UPDATE_DRY_RUN=1): report, change nothing -------------------
$dryRun = ($env:UPDATE_DRY_RUN -eq '1')
if (-not $dryRun) { $dryRun = ((Get-EnvValue 'UPDATE_DRY_RUN') -eq '1') }
if ($dryRun) {
  $hasGitDry = Test-Path (Join-Path $root '.git')
  Write-Host ''
  Write-Host 'UPDATE DRY RUN (UPDATE_DRY_RUN=1) - nothing will be changed.'
  Write-Host "Current version: $currentVersion"
  Write-Host "Latest valid stable release: $(if ($decision.latestStable) { $decision.latestStable } else { 'none found' })"
  Write-Host "Latest valid hotfix for current base: $(if ($decision.latestHotfixForBase) { $decision.latestHotfixForBase } else { 'none for this base' })"
  Write-Host "Selected release: $targetTag"
  Write-Host "Reason: $($decision.reason)"
  if ($hasGitDry) {
    Write-Host "Would download: git fetch + git checkout $targetTag"
  } else {
    Write-Host "Would download: https://codeload.github.com/$repoSlug/zip/refs/tags/$targetTag"
  }
  Write-Host 'Would stop POS: no, because dry run'
  Write-Ledger 'DRY_RUN' "$fromVersion" "$targetTag" 'dry run only, nothing was changed'
  Write-UpdateState 'idle' 0 'dry run completed, nothing changed'
  exit 0
}

# -- d) Pre-build checks + pre-update backup (data is never auto-restored) ----
# v2.18.0.2: cheap safety checks BEFORE anything is downloaded or stopped.
if (-not (Invoke-PreBuildChecks)) {
  Write-Ledger 'UPDATE_FAILED' "$fromVersion" "$targetTag" 'pre-build checks failed'
  Write-UpdateStateError 'failed' 10 'pre-build checks failed'
  exit 1
}

$backupDir = ""
if (-not $SkipBackup) {
  Write-UpdateState 'backing-up' 15 'creating the pre-update backup'
  $backupDir = Join-Path ([Environment]::GetFolderPath('Desktop')) "MbumahBackups\pre-update\$(Get-Date -Format 'yyyyMMdd-HHmmss')"
  try {
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    Copy-Item $dbFile (Join-Path $backupDir "pos-$stamp.db") -Force
    foreach ($side in @('pos.db-wal', 'pos.db-shm')) {
      $sidePath = Join-Path $HOME ('mbumah-pos-data\' + $side)
      if (Test-Path $sidePath) { Copy-Item $sidePath (Join-Path $backupDir "$side-$stamp") -Force }
    }
    if (Test-Path (Join-Path $root '.env')) { Copy-Item (Join-Path $root '.env') (Join-Path $backupDir "env-$stamp.bak") -Force }
    Write-Host "[OK] Pre-update backup: $backupDir"
    Write-Ledger 'BACKUP' "$fromVersion" "$targetTag" $backupDir
    $script:StateBackupPath = $backupDir
  } catch {
    # A failed backup must abort the update - never update without a fallback.
    Write-Host "[FAIL] Pre-update backup failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Ledger 'UPDATE_FAILED' "$fromVersion" "$targetTag" 'pre-update backup failed'
    Write-UpdateStateError 'failed' 15 'pre-update backup failed'
    exit 1
  }
}

# -- e) Update the code (git checkout or ZIP overlay) ------------------------
Write-Ledger 'UPDATE_START' "$fromVersion" "$targetTag" 'starting code update'
$hasGit = Test-Path (Join-Path $root '.git')
$prevRef = ""

if ($hasGit) {
  Write-UpdateState 'downloading' 20 'fetching the release from GitHub'
  # Capture where we are now so a failure can put us back exactly here.
  $prevRef = ""
  try {
    $b = git rev-parse --abbrev-ref HEAD 2>$null
    if ($b -and $b -ne 'HEAD') { $prevRef = $b } else { $prevRef = git rev-parse --short HEAD 2>$null }
  } catch { $prevRef = "" }
  if (-not $prevRef) { $prevRef = $fromVersion }

  Write-Host "[UPDATE] Fetching releases from GitHub..."
  git fetch origin --tags --force
  if ($LASTEXITCODE -ne 0) {
    Write-Host '[FAIL] git fetch failed (no internet?).' -ForegroundColor Red
    Write-Ledger 'UPDATE_FAILED' "$fromVersion" "$targetTag" 'git fetch failed'
    Write-UpdateStateError 'failed' 20 'git fetch failed'
    exit 1
  }
  Write-UpdateState 'extracting' 25 "checking out $targetTag"
  # -f discards lockfile drift from npm install; .env is untracked and safe.
  Write-Host "[UPDATE] Checking out $targetTag..."
  git checkout -f $targetTag
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAIL] Could not check out $targetTag." -ForegroundColor Red
    Write-Ledger 'UPDATE_FAILED' "$fromVersion" "$targetTag" 'git checkout failed'
    Write-UpdateStateError 'failed' 25 "git checkout $targetTag failed"
    exit 1
  }
} else {
  Write-UpdateState 'downloading' 20 "downloading $targetTag as ZIP"
  Write-Host "[UPDATE] No git folder - downloading $targetTag as ZIP..."
  $src = Copy-UpdateZip "tags/$targetTag"
  if ($src -eq "") {
    Write-Host '[FAIL] Download failed (no internet?).' -ForegroundColor Red
    Write-Ledger 'UPDATE_FAILED' "$fromVersion" "$targetTag" 'zip download failed'
    Write-UpdateStateError 'failed' 20 'zip download failed'
    exit 1
  }
  Write-UpdateState 'extracting' 25 'copying the new source over the app folder'
  if (-not (Copy-TreeOverRoot $src)) {
    Write-Ledger 'UPDATE_FAILED' "$fromVersion" "$targetTag" 'zip copy failed'
    Write-UpdateStateError 'failed' 25 'zip copy failed'
    exit 1
  }
}

# -- f) Rebuild exactly like the installer -----------------------------------
$buildOk = Invoke-RebuildAndAssemble
$healthy = $false

if ($buildOk) {
  # -- g) Restart the app and gate on REAL health (database answering) ------
  # (the app was already stopped before the rebuild - see Invoke-RebuildAndAssemble)
  if ($NoStart) {
    Write-Host '[RESTART] -NoStart given - the caller (Start POS) starts the new version.'
    # No server running to health-gate; trust the verified build + database
    # steps above (the caller health-gates right after its own start).
    $healthy = $true
  } else {
    Write-UpdateState 'activating' 85 'starting the new version'
    Write-Host '[RESTART] Starting the new version (hidden windows)...'
    Start-AppProcs
    Write-Host '[RESTART] Waiting for the POS to become ready (up to 60s)...'
    $healthy = Test-Healthy $port
    if ($healthy) {
      $liveVersion = ""
      try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 3
        $h = $r.Content | ConvertFrom-Json
        $liveVersion = "$($h.version)"
      } catch { }
      if ($liveVersion -and $liveVersion -ne $targetVersion) {
        Write-Host "[WARN] Server is healthy but reports version $liveVersion (expected $targetVersion)." -ForegroundColor Yellow
      }
    }
  }
}

# -- h) Success, or automatic code rollback ----------------------------------
if ($buildOk -and $healthy) {
  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Green
  Write-Host "  UPDATE COMPLETE - now running $targetTag" -ForegroundColor Green
  Write-Host '==============================================================' -ForegroundColor Green
  if ($backupDir -ne "") {
    Write-Host "  Pre-update backup kept at: $backupDir"
  }
  Write-Ledger 'UPDATE_SUCCESS' "$fromVersion" "$targetTag" 'update installed and healthy'
  Write-UpdateState 'activated' 100 "now running $targetTag"
  Ensure-ScheduledTasks
  exit 0
}

# ---- ROLLBACK PATH ---------------------------------------------------------
Write-Host ''
Write-Host '[FAIL] The update did not pass the health check.' -ForegroundColor Red
Write-Ledger 'UPDATE_FAILED' "$fromVersion" "$targetTag" "buildOk=$buildOk healthy=$healthy"
$script:StateRollbackAvail = $true
Write-UpdateStateError 'failed' 90 "update failed (buildOk=$buildOk healthy=$healthy) - rolling back"

Write-Host ''
Write-Host 'Update could not be completed.' -ForegroundColor Yellow
Write-Host 'The previous version is still available and will be started now.' -ForegroundColor Yellow

Write-Host "[ROLLBACK] Going back to the previous version ($prevRef)..."
Write-UpdateState 'rolled-back' 80 "restoring $prevRef"
$rollbackOk = $false

if ($hasGit) {
  git checkout -f $prevRef
  if ($LASTEXITCODE -eq 0) { $rollbackOk = $true }
} else {
  # Re-download the previous version as ZIP (tag first, current branch as fallback)
  $prevSrc = Copy-UpdateZip "tags/v$fromVersion"
  if ($prevSrc -eq "") { $prevSrc = Copy-UpdateZip 'heads/main' }
  if ($prevSrc -ne "") { $rollbackOk = Copy-TreeOverRoot $prevSrc }
}

if ($rollbackOk) {
  $rebuilt = Invoke-RebuildAndAssemble
  if ($rebuilt) {
    if ($NoStart) {
      # Caller (start-pos.ps1) starts the app right after us.
      Write-Host '[OK] ROLLBACK SUCCESS - previous version restored (caller will start it).'
      Write-Ledger 'ROLLBACK_SUCCESS' "$targetTag" "v$fromVersion" "restored $prevRef (NoStart)"
      Write-UpdateState 'rolled-back' 100 "previous version restored (caller will start it)"
      exit 1
    }
    Stop-AppProcs
    Start-AppProcs
    if (Test-Healthy $port) {
      Write-Host '[OK] ROLLBACK SUCCESS - the previous version is running again.'
      Write-Ledger 'ROLLBACK_SUCCESS' "$targetTag" "v$fromVersion" "restored $prevRef"
      Write-UpdateState 'rolled-back' 100 "previous version $prevRef is running again"
      if ($backupDir -ne "") {
        Write-Host ''
        Write-Host "  Your data was backed up before the update: $backupDir"
        Write-Host '  Data is NEVER changed by updates - no restore is needed.'
      }
      exit 1
    }
  }
  Write-Host '[FAIL] ROLLBACK FAILED - the rebuilt previous version is not healthy.' -ForegroundColor Red
  Write-Ledger 'ROLLBACK_FAILED' "$targetTag" "v$fromVersion" 'rollback rebuild/health failed'
  Write-UpdateStateError 'failed' 100 'rollback rebuild/health failed'
  if ($backupDir -ne "") { Write-Host "  Pre-update backup (data + .env): $backupDir" }
  Write-Host '  Take a photo of this screen and send it to your developer.'
  exit 1
} else {
  Write-Host '[FAIL] ROLLBACK FAILED - could not restore the previous source.' -ForegroundColor Red
  Write-Ledger 'ROLLBACK_FAILED' "$targetTag" "v$fromVersion" 'could not restore source'
  Write-UpdateStateError 'failed' 100 'rollback could not restore the previous source'
  if ($backupDir -ne "") { Write-Host "  Pre-update backup (data + .env): $backupDir" }
  Write-Host '  Take a photo of this screen and send it to your developer.'
  exit 1
}
