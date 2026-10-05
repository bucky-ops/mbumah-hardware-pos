# ============================================================================
# MBUMAH HARDWARE POS — Desktop shortcut creator (Windows, no Docker)
# ============================================================================
# Called by Install-Mbumah-POS.bat. Creates on the Desktop:
#   "Mbumah POS"        — starts the whole system (app + background jobs + browser)
#   "Backup POS Data"   — one-click database backup
# Also generates a branded .ico on the fly (cosmetic; silently skipped if
# System.Drawing is unavailable).
# ============================================================================
$ErrorActionPreference = 'Stop'
$root    = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$desktop = [Environment]::GetFolderPath('Desktop')
$ws      = New-Object -ComObject WScript.Shell

# ── Generate a simple branded icon (M on dark) — cosmetic only ──────────────
$iconPath = ''
try {
  Add-Type -AssemblyName System.Drawing
  $bmp = New-Object System.Drawing.Bitmap 256, 256
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
  $g.Clear([System.Drawing.Color]::FromArgb(26, 35, 50))
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(245, 158, 11))
  $font  = New-Object System.Drawing.Font ('Arial', 150, [System.Drawing.FontStyle]::Bold)
  $sf    = New-Object System.Drawing.StringFormat
  $sf.Alignment     = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF 0, 0, 256, 256
  $g.DrawString('M', $font, $brush, $rect, $sf)
  $g.Dispose()
  $iconPath = Join-Path $env:TEMP 'mbumah-pos.ico'
  [System.Drawing.Icon]::FromHandle($bmp.GetHicon()).Save($iconPath)
  $bmp.Dispose()
} catch { $iconPath = '' }

function New-MbumahShortcut {
  param([string]$Name, [string]$File, [string]$Description)
  $lnk = $ws.CreateShortcut((Join-Path $desktop "$Name.lnk"))
  $lnk.TargetPath       = 'powershell.exe'
  $lnk.Arguments        = "-NoProfile -ExecutionPolicy Bypass -File `"$File`""
  $lnk.WorkingDirectory = $root
  $lnk.Description       = $Description
  if ($iconPath) { $lnk.IconLocation = "$iconPath,0" }
  $lnk.Save()
}

New-MbumahShortcut 'Mbumah POS' (Join-Path $root 'deploy\nodocker\start-pos.ps1') 'Start Mbumah Hardware POS'
New-MbumahShortcut 'Backup POS Data' (Join-Path $root 'deploy\nodocker\backup-pos.ps1') 'Back up the Mbumah POS database'

Write-Host '[OK] Desktop shortcuts created:'
Write-Host '     - Mbumah POS'
Write-Host '     - Backup POS Data'
