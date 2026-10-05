# ============================================================================
# MBUMAH HARDWARE POS - Start the POS (Windows, no Docker)
# ============================================================================
# Opens TWO console windows:
#   1. This one  - the POS server itself (closing it stops the POS)
#   2. "Background jobs" - hourly/nightly maintenance (keep it open too)
# The browser opens ONLY after the server reports healthy.
# ============================================================================
$ErrorActionPreference = 'Stop'

try {
  $root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  Set-Location $root

  # Refresh standalone static/public copies (idempotent, cheap - needed after rebuilds)
  if (Test-Path '.next\standalone') {
    if (Test-Path '.next\static') {
      New-Item -ItemType Directory -Force -Path '.next\standalone\.next' | Out-Null
      Copy-Item '.next\static' '.next\standalone\.next\' -Recurse -Force
    }
    if (Test-Path 'public') { Copy-Item 'public' '.next\standalone\' -Recurse -Force }
  } else {
    Write-Host '[FAIL] No build found. Run the installer first:' -ForegroundColor Red
    Write-Host '       powershell -ExecutionPolicy Bypass -File deploy\nodocker\install-nodocker.ps1'
    Read-Host 'Press Enter to close'
    exit 1
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

  # Wait until the server is actually healthy BEFORE opening the browser
  Write-Host 'Waiting for the POS to become ready (this can take up to a minute)...'
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 3
      if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch { Start-Sleep -Seconds 2 }
  }

  if ($ready) {
    Write-Host ''
    Write-Host 'POS is ready - opening your browser...' -ForegroundColor Green
    Start-Process "http://localhost:$port"
  } else {
    Write-Host ''
    Write-Host 'WARNING: the server did not respond within 60 seconds.' -ForegroundColor Yellow
    Write-Host 'Check the errors above, take a photo and send it to your developer.'
    Write-Host "You can also open http://localhost:$port manually in a moment."
  }

  # Keep this window open while the server runs
  Wait-Process -Id $server.Id
} catch {
  Write-Host ''
  Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Take a photo of this screen and send it to your developer.'
  Read-Host 'Press Enter to close'
}
