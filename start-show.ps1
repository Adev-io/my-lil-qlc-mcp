# ============================================================
#  One-shot full launcher for the QLC+ lighting stack.
#  Brings up every connection in the rig, in order:
#
#    QLC+ (your rig.json show)  -> Launchpad MIDI IN (pad presses only)
#                               -> Art-Net  Universe 0  (to 3D monitor + real rig)
#                               -> OSC in   (driven by the MCP server)
#    MCP server (HTTP mode)     -> dashboard + OSC control  -> QLC+ :9000
#                               -> Launchpad LED OUT (RGB SysEx via a winmm sidecar)
#    3D monitor                 -> listens to Art-Net U0     -> Three.js on :7800
#
#  Then opens the 3D monitor and the dashboard in the browser.
#  Idempotent: skips any piece already up. Each long-running piece runs
#  in its own window so it survives independently of this script.
#
#  The Launchpad LEDs are driven by QLC+ MIDI feedback (the show's <Feedback> line): idle pads wait
#  dim, the active look lights full until toggled off. This needs Programmer Mode engaged BEFORE
#  QLC+ opens the MIDI ports — step 0 below runs engage-launchpad.ps1. If pads stay dark, reseat
#  the Launchpad USB and re-run this script. (The MCP SysEx LED driver stays LAUNCHPAD_LEDS=0 in
#  config/.env — it needs QLC+ OSC feedback, which this QLC+ install never emits.)
# ============================================================
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

# QLC+ 4.14.x executable: $env:QLC_EXE overrides; otherwise common install locations.
$qlc = @(
  $env:QLC_EXE,
  'C:\QLC+4\qlcplus.exe',
  "$env:ProgramFiles\QLC+\qlcplus.exe",
  "${env:ProgramFiles(x86)}\QLC+\qlcplus.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

# Show file + controller come from rig.json (the .qxw filename is the show name's slug —
# ASCII version of scripts/rig.ts slugify). No rig.json = first run: the rig-setup-wizard
# agent (open Claude Code here) interviews you and writes it; fall back to the example.
$useLaunchpad = $true
$rigFile = Join-Path $here 'rig.json'
if (Test-Path $rigFile) {
  $rig  = Get-Content $rigFile -Raw | ConvertFrom-Json
  $slug = ($rig.meta.name.ToLower() -replace '[^a-z0-9]+', '-').Trim('-')
  $show = Join-Path $here "$slug.qxw"
  if ($null -ne $rig.controller) { $useLaunchpad = [bool]$rig.controller.launchpad }
} else {
  Write-Host '  [!] No rig.json — first run? Open Claude Code here and ask the rig-setup-wizard to set you up.' -ForegroundColor Yellow
  Write-Host '      Falling back to the example show (punk-rock-show.qxw).' -ForegroundColor Yellow
  $show = Join-Path $here 'punk-rock-show.qxw'
}
if (-not (Test-Path $show)) {
  Write-Host "  [!] Show file not found: $show — run 'npm run generate' first." -ForegroundColor Yellow
  exit 1
}

$monPort = if ($env:MONITOR_PORT) { $env:MONITOR_PORT } else { '7800' }
$mcpPort = if ($env:HTTP_PORT)    { $env:HTTP_PORT }    else { '8788' }
$monUrl  = "http://127.0.0.1:$monPort"
$dashUrl = "http://127.0.0.1:$mcpPort/dashboard"

function Test-Url($u) {
  try { Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 1 | Out-Null; return $true } catch { return $false }
}
function Wait-Url($u, $tries = 40) {
  for ($i = 0; $i -lt $tries; $i++) {
    if (Test-Url $u) { return $true }
    Start-Sleep -Milliseconds 400
  }
  return $false
}

Write-Host ''
Write-Host "  $([System.IO.Path]::GetFileNameWithoutExtension($show)) — full launch" -ForegroundColor Cyan
Write-Host "  QLC+       : $show"
Write-Host "  MCP + dash : $dashUrl"
Write-Host "  3D monitor : $monUrl"
Write-Host ''

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
  Write-Host '  [!] npx not found on PATH. Install Node 20+ and try again.' -ForegroundColor Yellow
  exit 1
}

# 0. Launchpad Programmer Mode — engage BEFORE QLC+ opens the MIDI ports so QLC+'s profile
#    (pad notes 11..88) can read presses and light the pads via MIDI feedback.
if ($useLaunchpad -and -not (Get-Process qlcplus -ErrorAction SilentlyContinue)) {
  & (Join-Path $here 'engage-launchpad.ps1')
}

# 1. QLC+ — reads Launchpad MIDI IN (pad presses), lights the pads via MIDI feedback (the show's
#    <Feedback> line: dim idle / bright active), Art-Net U0 out + OSC in.
if (Get-Process qlcplus -ErrorAction SilentlyContinue) {
  Write-Host '  -> QLC+ already running' -ForegroundColor DarkGray
} elseif ($qlc) {
  Write-Host '  -> launching QLC+ (Operate) ...' -ForegroundColor Green
  Start-Process $qlc -ArgumentList '--open', $show, '--operate'
} else {
  Write-Host '  [!] QLC+ 4 not found (looked in C:\QLC+4 and Program Files).' -ForegroundColor Yellow
  Write-Host '      Install QLC+ 4.14.x from qlcplus.org, or set $env:QLC_EXE to your qlcplus.exe path.' -ForegroundColor Yellow
}

# 2. MCP server (HTTP mode) — dashboard + OSC control to QLC+ :9000.
if (Test-Url "http://127.0.0.1:$mcpPort/health") {
  Write-Host "  -> MCP server already on :$mcpPort" -ForegroundColor DarkGray
} else {
  Write-Host '  -> launching MCP server (HTTP) ...' -ForegroundColor Green
  $mcpCmd = "`$env:MCP_TRANSPORT='http'; `$env:HTTP_PORT='$mcpPort'; Set-Location '$here'; npx tsx src/index.ts"
  Start-Process powershell -ArgumentList '-NoExit', '-NoProfile', '-Command', $mcpCmd
}

# 3. 3D monitor — Art-Net U0 -> Three.js on :7800.
if (Test-Url "$monUrl/status") {
  Write-Host "  -> 3D monitor already on :$monPort" -ForegroundColor DarkGray
} else {
  Write-Host '  -> launching 3D monitor ...' -ForegroundColor Green
  $monCmd = "Set-Location '$here'; npx tsx monitor/server.ts"
  Start-Process powershell -ArgumentList '-NoExit', '-NoProfile', '-Command', $monCmd
}

# 4. Wait for the web services, then open both tabs.
Write-Host ''
Write-Host '  waiting for services ...' -ForegroundColor Green
$mcpOk = Wait-Url "http://127.0.0.1:$mcpPort/health"
$monOk = Wait-Url "$monUrl/status"

if ($monOk) { Start-Process $monUrl }  else { Write-Host '  [!] 3D monitor did not answer'  -ForegroundColor Yellow }
if ($mcpOk) { Start-Process $dashUrl } else { Write-Host '  [!] MCP/dashboard did not answer' -ForegroundColor Yellow }

Write-Host ''
Write-Host '  Up. QLC+ in Operate; the MCP server drives the Launchpad LEDs. If pads are dark, check the MCP window or reseat the Launchpad USB, then re-run.' -ForegroundColor Cyan
Write-Host ''
