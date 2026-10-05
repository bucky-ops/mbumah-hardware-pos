# ============================================================================
# MBUMAH HARDWARE POS — Start the POS (Windows, no Docker)
# ============================================================================
# Double-click-friendly. Opens TWO console windows:
#   1. "POS server"  — the app itself (closing it stops the POS)
#   2. "Background jobs" — hourly/nightly maintenance (closing it is not fatal,
#      but keep it open so eTIMS retries, debt SMS and reconciliation run)
# Then opens the browser at the POS URL.
# ============================================================================
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $root

# Refresh standalone static/public copies (idempotent, cheap — needed after rebuilds)
if (Test-Path ".next\standalone") {
  if (Test-Path ".next\static") {
    New-Item -ItemType Directory -Force -Path ".next\standalone\.next" | Out-Null
    Copy-Item ".next\static" ".next\standalone\.next\" -Recurse -Force
  }
  if (Test-Path "public") { Copy-Item "public" ".next\standalone\" -Recurse -Force }
} else {
  Write-Host "[FAIL] No build found. Run the installer first:" -ForegroundColor Red
  Write-Host "       powershell -ExecutionPolicy Bypass -File deploy\nodocker\install-nodocker.ps1"
  exit 1
}

# Background jobs in their own window
Start-Process powershell -ArgumentList '-NoExit','-ExecutionPolicy','Bypass','-Command',
  "Set-Location '$root'; Write-Host 'Mbumah POS — background jobs (keep open)'; node deploy\nodocker\cron-local.mjs"

Start-Sleep -Seconds 2
Start-Process "http://localhost:3000"

Write-Host ""
Write-Host "Starting MBUMAH HARDWARE POS... (keep this window open — closing it stops the POS)"
node deploy\nodocker\start-server.mjs
