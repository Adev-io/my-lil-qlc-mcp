# ============================================================
#  QLC+ 3D Monitor — standalone local web viewer.
#  Listens to QLC+ Art-Net Universe 0 (software only, no rig,
#  no Blender) and renders the rig live in the browser.
#  Touches none of the live MCP code path.
# ============================================================
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

$port = if ($env:MONITOR_PORT) { $env:MONITOR_PORT } else { '7800' }
$url = "http://127.0.0.1:$port"

Write-Host ''
Write-Host '  QLC+ 3D Monitor' -ForegroundColor Cyan
Write-Host "  dir : $here"
Write-Host "  url : $url"
Write-Host '  data: QLC+  --Art-Net U0-->  monitor/server.ts  --SSE-->  Three.js'
Write-Host ''
Write-Host '  Make sure QLC+ is running with Art-Net output on Universe 0.'
Write-Host '  (No physical rig needed — QLC+ emits Art-Net in software.)'
Write-Host ''

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
  Write-Host '  [!] npx not found on PATH. Install Node 20+ and try again.' -ForegroundColor Yellow
  exit 1
}

# Open the browser once the server answers (server runs in the foreground below).
Start-Job -ScriptBlock {
  param($u)
  for ($i = 0; $i -lt 40; $i++) {
    try { Invoke-WebRequest "$u/status" -UseBasicParsing -TimeoutSec 1 | Out-Null; break }
    catch { Start-Sleep -Milliseconds 300 }
  }
  Start-Process $u
} -ArgumentList $url | Out-Null

Write-Host '  Starting server (Ctrl+C to stop)...' -ForegroundColor Green
Write-Host ''
& npx tsx monitor/server.ts
