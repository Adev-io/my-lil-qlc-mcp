[CmdletBinding()]
param(
  [switch]$InstallOnly,
  [string]$FixtureDirectory = (Join-Path $env:USERPROFILE 'QLC+\Fixtures'),
  [string]$AdapterName,
  [switch]$NoMonitor
)

$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$showFile = Join-Path $projectDir 'cuepix-panel-show.qxw'
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

if (-not (Test-Path -LiteralPath $showFile)) { throw "Missing show file: $showFile" }
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

if (-not $NoMonitor) {
  try { $monitorUp = (Invoke-WebRequest 'http://127.0.0.1:7800/status' -UseBasicParsing -TimeoutSec 1).StatusCode -eq 200 }
  catch { $monitorUp = $false }
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
  Start-Process -FilePath $qlc -ArgumentList '--open', $showFile, '--operate'
  Write-Host '  QLC+ started in Operate mode: cuepix-panel-show.qxw' -ForegroundColor Green
}

Write-Host '  Routing-test workspace up. Build scenes only after hardware tests pass.' -ForegroundColor Cyan
