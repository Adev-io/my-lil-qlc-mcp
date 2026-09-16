[CmdletBinding()]
param(
  [switch]$InstallOnly,
  [switch]$PrepareRuntimeOnly,
  [string]$RuntimeDirectory = (Join-Path $env:TEMP 'A_Development\Cuepix'),
  [switch]$DisableLaunchpad,
  [string]$FixtureDirectory = (Join-Path $env:USERPROFILE 'QLC+\Fixtures'),
  [string]$AdapterName,
  [switch]$NoMonitor,
  [switch]$NoMcp
)

$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceShow = Join-Path $projectDir 'cuepix-panel-show.qxw'
$widgetMap = Join-Path $projectDir 'config\cuepix-widgets.json'
$fixtureSource = Join-Path $projectDir 'fixtures'
$fixtureNames = @(
  'Elation-Cuepix-Panel-79CH.qxf',
  'Chauvet-Intimidator-Spot-375ZX-15CH.qxf'
)

function Get-Sha256([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  try {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '') }
    finally { $sha.Dispose() }
  } finally { $stream.Dispose() }
}

function Get-LaunchpadIndexes {
  if ($DisableLaunchpad) { return [pscustomobject]@{ Input = -1; Output = -1 } }
  if (-not ('CuepixMidiIndex' -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class CuepixMidiIndex {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct InCaps { public ushort wMid, wPid; public uint v; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string name; public uint support; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct OutCaps { public ushort wMid, wPid; public uint v; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string name; public ushort tech, voices, notes, mask; public uint support; }
  [DllImport("winmm.dll")] static extern uint midiInGetNumDevs();
  [DllImport("winmm.dll", CharSet=CharSet.Unicode)] static extern uint midiInGetDevCaps(UIntPtr id, ref InCaps caps, uint size);
  [DllImport("winmm.dll")] static extern uint midiOutGetNumDevs();
  [DllImport("winmm.dll", CharSet=CharSet.Unicode)] static extern uint midiOutGetDevCaps(UIntPtr id, ref OutCaps caps, uint size);
  public static int Input(string target) { for (uint i=0; i<midiInGetNumDevs(); i++) { var c=new InCaps(); midiInGetDevCaps((UIntPtr)i, ref c, (uint)Marshal.SizeOf(c)); if (c.name==target) return (int)i; } return -1; }
  public static int Output(string target) { for (uint i=0; i<midiOutGetNumDevs(); i++) { var c=new OutCaps(); midiOutGetDevCaps((UIntPtr)i, ref c, (uint)Marshal.SizeOf(c)); if (c.name==target) return (int)i; } return -1; }
}
"@
  }
  return [pscustomobject]@{
    Input = [CuepixMidiIndex]::Input('MIDIIN2 (LPMiniMK3 MIDI)')
    Output = [CuepixMidiIndex]::Output('MIDIOUT2 (LPMiniMK3 MIDI)')
  }
}

function New-CuepixRuntime {
  if (-not (Test-Path -LiteralPath $sourceShow)) { throw "Missing show file: $sourceShow" }
  New-Item -ItemType Directory -Path $RuntimeDirectory -Force | Out-Null
  $runtimeShow = Join-Path $RuntimeDirectory 'cuepix-panel-show.runtime.qxw'
  if (Test-Path -LiteralPath $runtimeShow) {
    $runtimeBackup = "$runtimeShow.$(Get-Date -Format 'yyyyMMdd-HHmmss').bak"
    Copy-Item -LiteralPath $runtimeShow -Destination $runtimeBackup -Force
  }
  Copy-Item -LiteralPath $sourceShow -Destination $runtimeShow -Force
  Set-ItemProperty -LiteralPath $runtimeShow -Name IsReadOnly -Value $false

  $midi = Get-LaunchpadIndexes
  $controllerReady = -not $DisableLaunchpad -and $midi.Input -ge 0 -and $midi.Output -ge 0
  $xml = [IO.File]::ReadAllText($runtimeShow)
  # QLC+ ArtNet lines sort IPv4 address strings; resolve lighting Ethernet each launch.
  [string[]]$artnetAddresses = @(Get-NetIPAddress -AddressFamily IPv4 | Select-Object -ExpandProperty IPAddress -Unique)
  [Array]::Sort($artnetAddresses, [StringComparer]::Ordinal)
  $artnetLine = [Array]::IndexOf($artnetAddresses, '10.201.6.1')
  if ($artnetLine -lt 0) { throw 'Lighting Ethernet 10.201.6.1 absent; refusing an accidental Wi-Fi output.' }
  $xml = $xml -replace '<Output Plugin="ArtNet" UID="None" Line="[^"]*">', ('<Output Plugin="ArtNet" UID="None" Line="' + $artnetLine + '">')
  $pattern = '(?s)(<Universe Name="Launchpad" ID="2"[^>]*>)(.*?)(</Universe>)'
  $match = [regex]::Match($xml, $pattern)
  if (-not $match.Success) { throw 'Runtime validation failed: Launchpad Universe 2 missing.' }
  $body = $match.Groups[2].Value
  if ($controllerReady) {
    $body = $body -replace '<Input Plugin="MIDI" UID="[^"]*" Line="[^"]*"/>', ('<Input Plugin="MIDI" UID="' + $midi.Input + '" Line="' + $midi.Input + '"/>')
    $body = $body -replace '<Feedback Plugin="MIDI" UID="[^"]*" Line="[^"]*"/>', ('<Feedback Plugin="MIDI" UID="' + $midi.Output + '" Line="' + $midi.Output + '"/>')
  } else {
    $body = $body -replace '(?m)^\s*<(Input|Feedback) Plugin="MIDI"[^>]*/>\r?\n?', ''
  }
  $xml = $xml.Substring(0, $match.Index) + $match.Groups[1].Value + $body + $match.Groups[3].Value + $xml.Substring($match.Index + $match.Length)
  [IO.File]::WriteAllText($runtimeShow, $xml, [Text.UTF8Encoding]::new($false))

  $verified = [IO.File]::ReadAllText($runtimeShow)
  $outputMatches = [regex]::Matches($verified, '<Output Plugin="ArtNet" UID="None" Line="' + $artnetLine + '">')
  if ($outputMatches.Count -ne 2) { throw 'Runtime validation failed: both lighting outputs must use lighting Ethernet.' }
  Write-Host "  Art-Net U0/U1: 10.201.6.1, QLC+ line $artnetLine" -ForegroundColor Green
  foreach ($required in @('<Workspace ', '<Universe Name="Launchpad" ID="2"', 'outputUni="0"', 'outputUni="1"')) {
    if (-not $verified.Contains($required)) { throw "Runtime validation failed: missing $required" }
  }
  if (-not $controllerReady -and $verified.Contains('<Input Plugin="MIDI"')) { throw 'Runtime validation failed: stale MIDI input remained active.' }
  return [pscustomobject]@{ Path = $runtimeShow; ControllerReady = $controllerReady; Input = $midi.Input; Output = $midi.Output }
}

if ($PrepareRuntimeOnly) {
  $prepared = New-CuepixRuntime
  Write-Host "  runtime prepared: $($prepared.Path)" -ForegroundColor Green
  Write-Host $(if ($prepared.ControllerReady) { "  Launchpad ready: in=$($prepared.Input) out=$($prepared.Output)" } else { '  Launchpad disabled or absent: MIDI routes removed' }) -ForegroundColor DarkGray
  return
}

New-Item -ItemType Directory -Path $FixtureDirectory -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
foreach ($name in $fixtureNames) {
  $source = Join-Path $fixtureSource $name
  $destination = Join-Path $FixtureDirectory $name
  if (-not (Test-Path -LiteralPath $source)) { throw "Missing fixture source: $source" }
  $sourceHash = Get-Sha256 $source
  if ((Test-Path -LiteralPath $destination) -and (Get-Sha256 $destination) -ne $sourceHash) {
    Copy-Item -LiteralPath $destination -Destination "$destination.$stamp.bak"
    Write-Host "  backed up $name" -ForegroundColor Yellow
  }
  Copy-Item -LiteralPath $source -Destination $destination -Force
  if ((Get-Sha256 $destination) -ne $sourceHash) {
    throw "Fixture verification failed: $destination"
  }
  Write-Host "  fixture OK: $name" -ForegroundColor DarkGray
}

if ($InstallOnly) {
  Write-Host "  fixture install verified: $FixtureDirectory" -ForegroundColor Green
  return
}

$runtime = New-CuepixRuntime
$showFile = $runtime.Path
if ($runtime.ControllerReady) {
  $engage = Join-Path $projectDir 'engage-launchpad.ps1'
  if (-not (Test-Path -LiteralPath $engage)) { throw "Missing Launchpad Programmer Mode helper: $engage" }
  & $engage
  if ($LASTEXITCODE -ne 0) { throw "Launchpad Programmer Mode failed with exit code $LASTEXITCODE" }
  Write-Host "  Launchpad ready: in=$($runtime.Input) out=$($runtime.Output)" -ForegroundColor Green
} else {
  Write-Host '  Launchpad absent/disabled. Runtime MIDI routes removed; VC and MCP remain available.' -ForegroundColor Yellow
}

$qlc = @(
  $env:QLC_EXE,
  'C:\QLC+4\qlcplus.exe',
  "$env:ProgramFiles\QLC+\qlcplus.exe",
  "${env:ProgramFiles(x86)}\QLC+\qlcplus.exe"
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $qlc) { throw 'QLC+ 4 not found. Install 4.14.x or set QLC_EXE.' }

$lightingIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object IPAddress -eq '10.201.6.1' | Select-Object -First 1
if (-not $lightingIp -and $AdapterName) {
  $adapter = Get-NetAdapter -Name $AdapterName -ErrorAction Stop
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
  )
  if (-not $admin) { throw "Run PowerShell as Administrator to configure adapter '$AdapterName'." }
  New-NetIPAddress -InterfaceIndex $adapter.ifIndex -IPAddress '10.201.6.1' -PrefixLength 24 -AddressFamily IPv4 | Out-Null
  $lightingIp = Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 |
    Where-Object IPAddress -eq '10.201.6.1' | Select-Object -First 1
}
if ($lightingIp) {
  Write-Host "  lighting LAN OK: $($lightingIp.InterfaceAlias) = 10.201.6.1/24" -ForegroundColor Green
  if (Test-Connection -ComputerName '10.201.6.100' -Count 1 -Quiet -ErrorAction SilentlyContinue) {
    Write-Host '  CR011R answered at 10.201.6.100' -ForegroundColor Green
  } else {
    Write-Host '  CR011R not answering yet. Check power, cable, and 10.201.6.100/24.' -ForegroundColor Yellow
  }
} else {
  Write-Host '  No 10.201.6.1/24 lighting adapter. Preview works; hardware output will not.' -ForegroundColor Yellow
  Write-Host "  At load-in run elevated: .\start-cuepix.ps1 -AdapterName 'YOUR ETHERNET NAME'" -ForegroundColor Yellow
}

function Test-Url([string]$Url) {
  try { return (Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 1).StatusCode -eq 200 }
  catch { return $false }
}
function Wait-Url([string]$Url, [int]$Attempts = 30) {
  for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
    if (Test-Url $Url) { return $true }
    Start-Sleep -Milliseconds 400
  }
  return $false
}
function Test-TcpPort([int]$Port) {
  $client = [Net.Sockets.TcpClient]::new()
  try {
    $pending = $client.ConnectAsync('127.0.0.1', $Port)
    return $pending.Wait(500) -and $client.Connected
  } catch { return $false }
  finally { $client.Dispose() }
}

$mcpReady = $false
if (-not $NoMcp) {
  if (-not (Test-Path -LiteralPath $widgetMap)) { throw "Missing Cuepix widget map: $widgetMap" }
  $env:QLC_WIDGETS_FILE = $widgetMap
  $env:MCP_TRANSPORT = 'http'
  $env:HTTP_PORT = '8788'
  $env:LAUNCHPAD_LEDS = '0'
  $healthUrl = 'http://127.0.0.1:8788/health'
  if (Test-Url $healthUrl) {
    try {
      $meta = Invoke-RestMethod 'http://127.0.0.1:8788/dashboard/api/meta' -TimeoutSec 2
      $actualMap = [string]$meta.config.qlcWidgetsFile
      if (-not [IO.Path]::IsPathRooted($actualMap)) { $actualMap = Join-Path $projectDir $actualMap }
      if ([IO.Path]::GetFullPath($actualMap) -ne [IO.Path]::GetFullPath($widgetMap)) {
        throw "Port 8788 already runs another widget map: $actualMap"
      }
      $mcpReady = $true
      Write-Host '  MCP already ready with Cuepix map' -ForegroundColor DarkGray
    } catch {
      throw "Port 8788 is occupied, but Cuepix map could not be verified. $($_.Exception.Message)"
    }
  } else {
    if (Test-TcpPort 8788) { throw 'Port 8788 is occupied by another service. Existing process left untouched.' }
    $server = Join-Path $projectDir 'dist\src\index.js'
    if (-not (Test-Path -LiteralPath $server)) {
      & npm.cmd run build
      if ($LASTEXITCODE -ne 0) { throw "MCP build failed with exit code $LASTEXITCODE" }
    }
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    Start-Process -FilePath $node -ArgumentList $server -WorkingDirectory $projectDir -WindowStyle Hidden
    $mcpReady = Wait-Url $healthUrl
    if (-not $mcpReady) { throw 'MCP failed readiness check: http://127.0.0.1:8788/health' }
    Write-Host '  MCP ready: http://127.0.0.1:8788/dashboard' -ForegroundColor Green
  }
}

if (-not $NoMonitor) {
  $monitorUp = Test-Url 'http://127.0.0.1:7800/status'
  if (-not $monitorUp) {
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile', '-File', (Join-Path $projectDir 'start-cuepix-monitor.ps1')
    Write-Host '  starting Cuepix 3D monitor' -ForegroundColor Green
  }
}

if (Get-Process qlcplus -ErrorAction SilentlyContinue) {
  Write-Host '  QLC+ already running. Close it and rerun if wrong show is open.' -ForegroundColor Yellow
} else {
  $env:QT_ENABLE_HIGHDPI_SCALING = '0'
  $env:QT_AUTO_SCREEN_SCALE_FACTOR = '0'
  $env:QT_SCALE_FACTOR = '1'
  Start-Process -FilePath $qlc -ArgumentList '--open', $showFile, '--operate' | Out-Null
  Write-Host '  QLC+ started in Operate mode: cuepix-panel-show.runtime.qxw' -ForegroundColor Green
}

$qlcReady = $false
for ($attempt = 0; $attempt -lt 25; $attempt++) {
  if (Get-Process qlcplus -ErrorAction SilentlyContinue) { $qlcReady = $true; break }
  Start-Sleep -Milliseconds 400
}
if (-not $qlcReady) { throw 'QLC+ failed process readiness check.' }

$monitorReady = $NoMonitor
$monitorLive = $false
if (-not $NoMonitor) {
  $monitorReady = Wait-Url 'http://127.0.0.1:7800/status'
  if ($monitorReady) {
    $status = Invoke-RestMethod 'http://127.0.0.1:7800/status' -TimeoutSec 2
    $monitorReady = @($status.universes) -contains 0 -and @($status.universes) -contains 1
    $monitorLive = $null -ne $status.ageMs.'0' -and $null -ne $status.ageMs.'1'
  }
}

if (-not $monitorReady) { throw '3D monitor failed readiness check or lacks Universes 0 and 1.' }
if ($lightingIp -and $monitorLive -and ($NoMcp -or $mcpReady)) {
  Write-Host '  READY — QLC+, Art-Net 0/1, monitor, and requested services active.' -ForegroundColor Green
} else {
  Write-Host '  PREVIEW ONLY — console ready; lighting LAN, live Art-Net frames, controller, or optional service still pending.' -ForegroundColor Yellow
}
Write-Host '  Run collapsed SETUP · ROUTING TESTS before production controls.' -ForegroundColor Cyan
