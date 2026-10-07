# ============================================================================
# MBUMAH HARDWARE POS - Automatic Updater (Windows, no-Docker laptop install)
# ============================================================================
# Downloads and installs the newest release from GitHub during DORMANT hours
# (default 22:00-06:00), with:
#   1. A pre-update backup of the database + .env  (Desktop\MbumahBackups\pre-update)
#   2. Code update (git checkout of the release tag, or ZIP when no .git)
#   3. The exact rebuild sequence the installer uses
#      (npm install -> db:push -> build -> verify-db -> assemble standalone)
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
#   ... -NoStart              do NOT auto-start the POS after the update — the
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
  # Only node processes started from THIS app folder (same rule as the uninstaller)
  $found = $null
  try {
    $found = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and ($_.CommandLine -like "*$root*start-server.mjs*" -or $_.CommandLine -like "*$root*cron-local.mjs*") }
  } catch { $found = $null }
  return $found
}

function Stop-AppProcs {
  $procs = Get-AppProcs
  if ($procs) {
    foreach ($p in $procs) {
      try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch { }
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
  # Self-heal (v2.10.1): installs that predate the nightly tasks — or that
  # received their FIRST update via the start-pos.ps1 startup check — may not
  # have "Mbumah POS Nightly Update/Backup" registered. Re-create any missing
  # task (same /tr quoting as the installer: full -File path, no /tr comma
  # mangling on Windows PowerShell 5.1) so the dormant-window automation
  # takes over from the next night on. Never throws.
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
}

function Invoke-RebuildAndAssemble {
  # Mirrors install-nodocker.ps1 steps 5-7 EXACTLY (minus seeding).
  # NOTE: the app is stopped FIRST - `next build` replaces .next (including
  # .next\standalone), and Windows keeps loaded engine binaries locked while
  # the old server runs, which would fail the build with EPERM.
  Write-Host '[BUILD 0/4] Stopping the running POS for the rebuild...'
  Stop-AppProcs
  Set-BuildEnvironment
  if (-not (Invoke-Checked "[BUILD 1/4] Installing dependencies (needs internet)..." 'npm install')) { return $false }
  if (-not (Invoke-Checked "[BUILD 2/4] Applying the database schema..." 'npm run db:push')) { return $false }
  if (-not (Invoke-Checked "[BUILD 3/4] Building the production app..." 'npm run build')) { return $false }

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

  Write-Host "[BUILD] Assembling the standalone server..."
  try {
    New-Item -ItemType Directory -Force -Path ".next\standalone\.next" | Out-Null
    Copy-Item ".next\static" ".next\standalone\.next\" -Recurse -Force
    Copy-Item "public" ".next\standalone\" -Recurse -Force
  } catch {
    Write-Host "[FAIL] Could not assemble the standalone server: $($_.Exception.Message)" -ForegroundColor Red
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
try { $currentVersion = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version } catch { }
$fromVersion = "$currentVersion"
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

# -- c) Determine the target release -----------------------------------------
if ($ToVersion -ne "") {
  if (-not $ToVersion.StartsWith('v')) { $ToVersion = 'v' + $ToVersion }
  $targetTag = $ToVersion
  Write-Host "[INFO] Target version (requested): $targetTag"
} else {
  Write-Host '[INFO] Checking GitHub for the latest release...'
  $latest = $null
  try {
    $headers = @{}
    if ($env:GITHUB_TOKEN) { $headers['Authorization'] = "token $($env:GITHUB_TOKEN)" }
    # -Quiet (startup check) uses a short timeout so an offline laptop is not
    # stuck waiting at shop-opening time; the nightly task can afford 30s.
    $timeoutSec = 30; if ($Quiet) { $timeoutSec = 10 }
    $latest = Invoke-RestMethod -Uri "https://api.github.com/repos/$repoSlug/releases/latest" -Headers $headers -TimeoutSec $timeoutSec
  } catch {
    # Scheduled tasks must NEVER spam errors - offline is a normal state.
    Write-Host "[WARN] Could not reach GitHub (offline?). Will try again tomorrow."
    Write-Ledger 'CHECK_FAILED' "$fromVersion" '' "release check failed: $($_.Exception.Message)"
    exit 0
  }
  $targetTag = $latest.tag_name
  if (-not $targetTag) {
    Write-Host '[WARN] GitHub answered but without a release tag - skipping.'
    Write-Ledger 'CHECK_FAILED' "$fromVersion" '' 'empty tag_name from GitHub'
    exit 0
  }
  Write-Host "[INFO] Latest release: $targetTag"
}

$targetVersion = $targetTag.TrimStart('v')
if ($targetVersion -eq $currentVersion) {
  Write-Host "[OK] Already up to date (v$currentVersion)."
  Write-Ledger 'UP_TO_DATE' "$fromVersion" "$targetTag" 'no update needed'
  # Self-heal even when current: an install updated before this feature or
  # with a removed task gets its nightly automation back for free.
  Ensure-ScheduledTasks
  exit 0
}

# -- d) Pre-update backup (NEVER deleted; data is never auto-restored) -------
$backupDir = ""
if (-not $SkipBackup) {
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
  } catch {
    # A failed backup must abort the update - never update without a fallback.
    Write-Host "[FAIL] Pre-update backup failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Ledger 'UPDATE_FAILED' "$fromVersion" "$targetTag" 'pre-update backup failed'
    exit 1
  }
}

# -- e) Update the code (git checkout or ZIP overlay) ------------------------
Write-Ledger 'UPDATE_START' "$fromVersion" "$targetTag" 'starting code update'
$hasGit = Test-Path (Join-Path $root '.git')
$prevRef = ""

if ($hasGit) {
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
    exit 1
  }
  # -f discards lockfile drift from npm install; .env is untracked and safe.
  Write-Host "[UPDATE] Checking out $targetTag..."
  git checkout -f $targetTag
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAIL] Could not check out $targetTag." -ForegroundColor Red
    Write-Ledger 'UPDATE_FAILED' "$fromVersion" "$targetTag" 'git checkout failed'
    exit 1
  }
} else {
  Write-Host "[UPDATE] No git folder - downloading $targetTag as ZIP..."
  $src = Copy-UpdateZip "tags/$targetTag"
  if ($src -eq "") {
    Write-Host '[FAIL] Download failed (no internet?).' -ForegroundColor Red
    Write-Ledger 'UPDATE_FAILED' "$fromVersion" "$targetTag" 'zip download failed'
    exit 1
  }
  if (-not (Copy-TreeOverRoot $src)) {
    Write-Ledger 'UPDATE_FAILED' "$fromVersion" "$targetTag" 'zip copy failed'
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
  Ensure-ScheduledTasks
  exit 0
}

# ---- ROLLBACK PATH ---------------------------------------------------------
Write-Host ''
Write-Host '[FAIL] The update did not pass the health check.' -ForegroundColor Red
Write-Ledger 'UPDATE_FAILED' "$fromVersion" "$targetTag" "buildOk=$buildOk healthy=$healthy"

Write-Host "[ROLLBACK] Going back to the previous version ($prevRef)..."
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
      exit 1
    }
    Stop-AppProcs
    Start-AppProcs
    if (Test-Healthy $port) {
      Write-Host '[OK] ROLLBACK SUCCESS - the previous version is running again.'
      Write-Ledger 'ROLLBACK_SUCCESS' "$targetTag" "v$fromVersion" "restored $prevRef"
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
  if ($backupDir -ne "") { Write-Host "  Pre-update backup (data + .env): $backupDir" }
  Write-Host '  Take a photo of this screen and send it to your developer.'
  exit 1
} else {
  Write-Host '[FAIL] ROLLBACK FAILED - could not restore the previous source.' -ForegroundColor Red
  Write-Ledger 'ROLLBACK_FAILED' "$targetTag" "v$fromVersion" 'could not restore source'
  if ($backupDir -ne "") { Write-Host "  Pre-update backup (data + .env): $backupDir" }
  Write-Host '  Take a photo of this screen and send it to your developer.'
  exit 1
}
