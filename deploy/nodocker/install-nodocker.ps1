# ============================================================================
# MBUMAH HARDWARE POS - No-Docker Laptop Installer (Windows)
# ============================================================================
# For laptops that cannot run Docker Desktop (no virtualization / low RAM).
# Stack: Node.js 20+ + SQLite file. No database server, no VMs.
#
# Usage (PowerShell):
#   powershell -ExecutionPolicy Bypass -File deploy\nodocker\install-nodocker.ps1
#   powershell -ExecutionPolicy Bypass -File deploy\nodocker\install-nodocker.ps1 -UseLan
#   powershell -ExecutionPolicy Bypass -File deploy\nodocker\install-nodocker.ps1 -LanIp 192.168.1.50
# ============================================================================
param(
  [string]$LanIp = "",
  [switch]$UseLan
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\..")

function Fail([string]$Msg) {
  Write-Host "[FAIL] $Msg" -ForegroundColor Red
  Write-Host "       Take a photo of this screen and send it to your developer."
  exit 1
}

function Run-Step([string]$Label, [string]$Command) {
  Write-Host $Label
  cmd /c $Command
  if ($LASTEXITCODE -ne 0) { Fail "$Label -> command failed (exit $LASTEXITCODE)." }
}

Write-Host "=============================================================="
Write-Host "  MBUMAH HARDWARE POS - No-Docker Laptop Installer"
Write-Host "  (Node.js + SQLite - no virtualization required)"
Write-Host "=============================================================="

# -- 1. Node.js 20+ -----------------------------------------------------------
$nodeOk = $false
try {
  $v = node -v
  if ($v -match 'v(\d+)') { $nodeOk = [int]$Matches[1] -ge 20 }
} catch { }
if (-not $nodeOk) {
  Write-Host "[SETUP] Node.js 20+ not found - attempting winget install (needs internet)..."
  try {
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
  } catch { }
  try { $v = node -v } catch { $v = $null }
  if (-not $v) {
    Write-Host "[FAIL] Please install Node.js 20 LTS from https://nodejs.org, then re-run this script." -ForegroundColor Red
    exit 1
  }
  Write-Host "[WARN] Node.js was installed. If it is still not found, close and reopen PowerShell, then re-run." -ForegroundColor Yellow
}
Write-Host "[OK] Node $(node -v)"

# -- 2. bun (small CLI used by the database seed step) ------------------------
try { $null = bun -v } catch {
  Write-Host "[SETUP] Installing bun (needed for database seeding)..."
  npm install -g bun
}
Write-Host "[OK] bun $(bun -v)"

# -- 3. Database file + .env (first run only) --------------------------------
$dbDir = Join-Path $HOME "mbumah-pos-data"
New-Item -ItemType Directory -Force -Path $dbDir | Out-Null
$dbFile = Join-Path $dbDir "pos.db"
$dbUrl = "file:" + ($dbFile -replace '\\', '/')

if (Test-Path ".env") {
  Write-Host "[INFO] Existing .env found - keeping it (secrets preserved)."
} else {
  Copy-Item "deploy\nodocker\.env.nodocker.example" ".env"
  function New-Secret([int]$n = 32) {
    $b = New-Object byte[] $n
    $r = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $r.GetBytes($b); $r.Dispose()
    return [Convert]::ToBase64String($b).TrimEnd('=')
  }
  $envText = Get-Content ".env" -Raw
  $envText = $envText -replace '(?m)^DATABASE_URL=.*', "DATABASE_URL=$dbUrl"
  $envText = $envText -replace '(?m)^DIRECT_URL=.*', "DIRECT_URL=$dbUrl"
  $envText = $envText -replace '(?m)^NEXTAUTH_SECRET=.*', "NEXTAUTH_SECRET=$(New-Secret)"
  $envText = $envText -replace '(?m)^JWT_SECRET=.*', "JWT_SECRET=$(New-Secret)"
  $envText = $envText -replace '(?m)^CRON_SECRET=.*', "CRON_SECRET=$(New-Secret)"
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false; [System.IO.File]::WriteAllText((Join-Path (Get-Location) ".env"), $envText, $utf8NoBom)
  Write-Host "[OK] .env created - secrets generated, database at: $dbFile"
}

# -- 3b. Remote Ops agent identity (RAK, v2.11.0) — append missing keys only --
# STORE_ID: this machine's fleet identity (defaults to the sanitized hostname).
# OPS_SIGNING_KEY: shared HMAC secret — MUST match the cloud's key or every
# command is rejected by design. Both are written ONCE; never rotated here.
$envLines = Get-Content ".env"
$hasStoreId = ($envLines | Where-Object { $_ -match '^STORE_ID=' } | Measure-Object).Count -gt 0
$hasSigning = ($envLines | Where-Object { $_ -match '^OPS_SIGNING_KEY=' } | Measure-Object).Count -gt 0
if (-not $hasStoreId -or -not $hasSigning) {
  $sb = New-Object System.Text.StringBuilder
  if (-not $hasStoreId) {
    $rawHost = $env:COMPUTERNAME
    if ([string]::IsNullOrWhiteSpace($rawHost)) { $rawHost = 'mbumah-store' }
    $sid = ($rawHost.ToLower() -replace '[^a-z0-9._-]', '-')
    if ($sid.Length -gt 80) { $sid = $sid.Substring(0, 80) }
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("# -- Remote Ops agent (RAK) --")
    [void]$sb.AppendLine("STORE_ID=$sid")
    Write-Host "[OK] STORE_ID=$sid"
  }
  if (-not $hasSigning) {
    $rk = New-Object byte[] 32
    $rr = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rr.GetBytes($rk); $rr.Dispose()
    $hex = ([System.BitConverter]::ToString($rk)) -replace '-', ''
    [void]$sb.AppendLine("OPS_SIGNING_KEY=$hex")
    Write-Host "[OK] OPS_SIGNING_KEY generated (copy the SAME value into the cloud's OPS_SIGNING_KEY)."
  }
  $utf8NoBom2 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::AppendAllText((Join-Path (Get-Location) ".env"), $sb.ToString(), $utf8NoBom2)
}

# -- 4. LAN mode - decide BEFORE the build (NEXT_PUBLIC_APP_URL is baked in) --
if ($UseLan -or $LanIp -ne "") {
  if ($LanIp -eq "") {
    try {
      $cands = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        Select-Object -ExpandProperty IPAddress
      $LanIp = ($cands | Select-Object -First 1)
    } catch { $LanIp = "" }
    if ($LanIp -eq "") {
      Write-Host "[FAIL] Could not auto-detect the LAN IP. Re-run with -LanIp x.x.x.x" -ForegroundColor Red
      exit 1
    }
  }
  $envText = Get-Content ".env" -Raw
  $envText = $envText -replace '(?m)^NEXTAUTH_URL=.*', "NEXTAUTH_URL=http://$LanIp`:3000"
  $envText = $envText -replace '(?m)^NEXT_PUBLIC_APP_URL=.*', "NEXT_PUBLIC_APP_URL=http://$LanIp`:3000"
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false; [System.IO.File]::WriteAllText((Join-Path (Get-Location) ".env"), $envText, $utf8NoBom)
  Write-Host "[OK] LAN access configured: http://${LanIp}:3000"
}

# -- 5. Environment for the toolchain (provider switch happens in postinstall) -
$envLine = (Get-Content ".env" | Where-Object { $_ -match '^DATABASE_URL=(.+)$' } | Select-Object -First 1)
if ($envLine -match '^DATABASE_URL=(.+)$') { $env:DATABASE_URL = $Matches[1].Trim('"') }
$dLine = (Get-Content ".env" | Where-Object { $_ -match '^DIRECT_URL=(.+)$' } | Select-Object -First 1)
if ($dLine -match '^DIRECT_URL=(.+)$') { $env:DIRECT_URL = $Matches[1].Trim('"') }
$env:SKIP_ENV_VALIDATION = '1'

# -- 6. Install -> schema -> seed -> build (each step FAILS HARD on error) -------
# NOTE: `npm install` (not `npm ci`) - the repo is developed with bun, so the
# npm lockfile can drift from package.json; `npm ci` would hard-fail on that.
# `npm install` reconciles the lockfile and always succeeds.
Run-Step "[BUILD 1/4] Installing dependencies (2-5 min, needs internet)..." "npm install"

Run-Step "[BUILD 2/4] Creating the database schema..." "npm run db:push"

Run-Step "[BUILD 3/4] Seeding the database (admin + demo data)..." "npm run db:seed"

Run-Step "[BUILD 4/4] Building the production app (3-8 min)..." "npm run build"

# -- 6b. Verify the database is REALLY usable (tables + seeded admin) ----------
# A silent failure in db push/seed (wrong provider, lockfile drift skipping
# postinstall, seed crash) used to produce an install that "completes" but
# serves an EMPTY database: frontend renders, every module says unavailable.
# This step makes that state an INSTALL FAILURE instead of a support call.
Run-Step "[BUILD 5/5] Verifying the database (tables + admin account)..." "node deploy\nodocker\verify-db.mjs"

# -- 7. Assemble the standalone server ------------------------------------
New-Item -ItemType Directory -Force -Path ".next\standalone\.next" | Out-Null
Copy-Item ".next\static" ".next\standalone\.next\" -Recurse -Force
Copy-Item "public" ".next\standalone\" -Recurse -Force

# -- 8. Scheduled tasks: nightly update (23:00) + nightly backup (02:30) ---
# The updater only acts inside the dormant window (22:00-06:00) and skips
# silently when offline, so a laptop that is switched off at night just
# catches up the next night - nothing breaks. Both tasks run hidden.
# The RAK agent (v2.11.0) runs every 15 minutes: it polls the private ops-log
# repo for signed commands from the owner's Remote Ops console (pull-only —
# no inbound ports) and reports results back. Without a GITHUB_TOKEN in .env
# the agent is idle and harmless.
$here = (Get-Location).Path
$tasks = @(
  @{ Name = 'Mbumah POS Nightly Update'; Time = '23:00'; File = 'deploy\nodocker\update-pos.ps1'; Extra = '' },
  @{ Name = 'Mbumah POS Nightly Backup'; Time = '02:30'; File = 'deploy\nodocker\backup-pos.ps1'; Extra = ' -Unattended' }
)
foreach ($t in $tasks) {
  $scriptPath = Join-Path $here $t.File
  $tr = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $scriptPath + '"' + $t.Extra
  try {
    schtasks /create /f /tn "$($t.Name)" /sc daily /st $t.Time /tr $tr | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Write-Host "[OK] Scheduled task '$($t.Name)' registered (daily $($t.Time), hidden)."
    } else {
      Write-Host "[WARN] Could not register '$($t.Name)' (schtasks exit $LASTEXITCODE) - you can still update/backup by hand." -ForegroundColor Yellow
    }
  } catch {
    Write-Host "[WARN] Could not register '$($t.Name)': $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

# RAK agent — every 15 minutes, hidden. node.exe must be on PATH (step 2).
$agentPath = Join-Path $here 'deploy\nodocker\agent.mjs'
try {
  $agentTr = 'node.exe --no-warnings "' + $agentPath + '"'
  schtasks /create /f /tn "Mbumah POS Agent" /sc minute /mo 15 /tr $agentTr | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] Scheduled task 'Mbumah POS Agent' registered (every 15 min, hidden)."
  } else {
    Write-Host "[WARN] Could not register 'Mbumah POS Agent' (schtasks exit $LASTEXITCODE) - remote commands will not reach this store until it is registered." -ForegroundColor Yellow
  }
} catch {
  Write-Host "[WARN] Could not register 'Mbumah POS Agent': $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Green
Write-Host "  INSTALL COMPLETE" -ForegroundColor Green
Write-Host "==============================================================" -ForegroundColor Green
Write-Host "  Start the POS (anytime):"
Write-Host "    powershell -ExecutionPolicy Bypass -File deploy\nodocker\start-pos.ps1"
Write-Host ""
Write-Host "  First login:  admin@mbumahhardware.co.ke / password123"
Write-Host "  !! CHANGE THE ADMIN PASSWORD IMMEDIATELY (Profile > Security)"
Write-Host "  !! Then set SEED_DATABASE=false in .env"
Write-Host "  Database file (back this up): $dbFile"
Write-Host ""
Write-Host "  Scheduled: nightly update 23:00 + nightly backup 02:30 (hidden tasks)"
Write-Host "  Manual:    Update-Mbumah-POS.bat / Rollback-Mbumah-POS.bat / Backup POS Data"
