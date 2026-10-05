# ============================================================================
# MBUMAH HARDWARE POS — One-command laptop installer (Windows)
# ============================================================================
# Usage (PowerShell):
#   powershell -ExecutionPolicy Bypass -File deploy\laptop\install-laptop.ps1
#   powershell -ExecutionPolicy Bypass -File deploy\laptop\install-laptop.ps1 -LanIp 192.168.1.50
#
#   -LanIp   Configure the POS on the laptop's LAN IP instead of localhost
#            so phones/other PCs on the shop Wi-Fi can connect.
#            (Auto-detected if omitted and -UseLan switch is passed.)
# ============================================================================
param(
  [string]$LanIp = "",
  [switch]$UseLan
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\..")

Write-Host "=============================================================="
Write-Host "   MBUMAH HARDWARE POS - Laptop Standalone Installer"
Write-Host "=============================================================="

# ── 1. Preflight ─────────────────────────────────────────────────────────────
try {
  $null = docker info 2>$null
  Write-Host "[OK] Docker is running" -ForegroundColor Green
} catch {
  Write-Host "[FAIL] Docker is not installed or not running. Install Docker Desktop, start it, and re-run." -ForegroundColor Red
  exit 1
}
try {
  $null = docker compose version
} catch {
  Write-Host "[FAIL] Docker Compose v2 not available. Update Docker Desktop." -ForegroundColor Red
  exit 1
}

# ── 2. Generate .env with real secrets (first run only) ─────────────────────
if (Test-Path ".env") {
  Write-Host "[INFO] Existing .env found - keeping it (secrets preserved)."
} else {
  Copy-Item "deploy\laptop\.env.laptop.example" ".env"
  function New-Secret([int]$bytesCount = 32) {
    $bytes = New-Object byte[] $bytesCount
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    return [Convert]::ToBase64String($bytes).TrimEnd('=')
  }
  $pgPass    = (New-Secret 24) -replace '[^a-zA-Z0-9]', ''
  $naSecret  = New-Secret
  $jwtSecret = New-Secret
  $cronSec   = New-Secret
  $envText = Get-Content ".env" -Raw
  $envText = $envText -replace '(?m)^POSTGRES_PASSWORD=.*', "POSTGRES_PASSWORD=$pgPass"
  $envText = $envText -replace '(?m)^NEXTAUTH_SECRET=.*', "NEXTAUTH_SECRET=$naSecret"
  $envText = $envText -replace '(?m)^JWT_SECRET=.*', "JWT_SECRET=$jwtSecret"
  $envText = $envText -replace '(?m)^CRON_SECRET=.*', "CRON_SECRET=$cronSec"
  Set-Content -Path ".env" -Value $envText -NoNewline -Encoding UTF8
  Write-Host "[OK] .env created with freshly generated secrets" -ForegroundColor Green
}

# ── 3. LAN mode (optional) ───────────────────────────────────────────────────
if ($UseLan -or $LanIp -ne "") {
  if ($LanIp -eq "") {
    try {
      $candidates = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        Select-Object -ExpandProperty IPAddress
      $LanIp = ($candidates | Select-Object -First 1)
    } catch { $LanIp = "" }
    if ($LanIp -eq "") {
      Write-Host "[FAIL] Could not auto-detect the LAN IP. Re-run with -LanIp x.x.x.x" -ForegroundColor Red
      exit 1
    }
  }
  $envText = Get-Content ".env" -Raw
  $envText = $envText -replace '(?m)^NEXTAUTH_URL=.*', "NEXTAUTH_URL=http://$LanIp`:3000"
  $envText = $envText -replace '(?m)^NEXT_PUBLIC_APP_URL=.*', "NEXT_PUBLIC_APP_URL=http://$LanIp`:3000"
  Set-Content -Path ".env" -Value $envText -NoNewline -Encoding UTF8
  Write-Host "[OK] Configured for LAN access at http://${LanIp}:3000" -ForegroundColor Green
}

# ── 4. Build and start the stack (first build takes 5-15 min) ────────────────
Write-Host "[BUILD] Building and starting the stack (first build: 5-15 minutes)..."
docker compose -f docker-compose.laptop.yml up -d --build

# ── 5. Wait for the app to become healthy ────────────────────────────────────
$port = 3000
if (($envText -match '(?m)^APP_PORT=(\d+)')) { $port = $Matches[1] }
$nextAuthUrl = "http://localhost:$port"
if (($envText -match '(?m)^NEXTAUTH_URL=(\S+)')) { $nextAuthUrl = $Matches[1] }

Write-Host "[WAIT] Waiting for the app to become healthy (up to 10 minutes)..."
$healthy = $false
for ($i = 0; $i -lt 40; $i++) {
  try {
    $resp = Invoke-WebRequest -Uri "http://localhost:$port/api/health" -UseBasicParsing -TimeoutSec 10
    if ($resp.StatusCode -eq 200) { $healthy = $true; break }
  } catch { Start-Sleep -Seconds 15; Write-Host "." -NoNewline }
}

Write-Host ""
if ($healthy) {
  Write-Host "==============================================================" -ForegroundColor Green
  Write-Host "  MBUMAH HARDWARE POS IS RUNNING" -ForegroundColor Green
  Write-Host "==============================================================" -ForegroundColor Green
  Write-Host "  Open:     $nextAuthUrl"
  Write-Host "  Login:    admin@mbumahhardware.co.ke"
  Write-Host "  Password: password123"
  Write-Host ""
  Write-Host "  !! 1. CHANGE THE ADMIN PASSWORD IMMEDIATELY (Profile > Security)" -ForegroundColor Yellow
  Write-Host "  !! 2. After first login set SEED_DATABASE=false in .env, then:" -ForegroundColor Yellow
  Write-Host "        docker compose -f docker-compose.laptop.yml up -d" -ForegroundColor Yellow
} else {
  Write-Host "[FAIL] App did not become healthy in 10 minutes. Check logs:" -ForegroundColor Red
  Write-Host "       docker compose -f docker-compose.laptop.yml logs app --tail=100"
  exit 1
}
