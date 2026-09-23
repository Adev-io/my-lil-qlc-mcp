$ErrorActionPreference = 'Stop'
if (-not $env:MONITOR_UNIVERSES) { $env:MONITOR_UNIVERSES = '0,1' }   # the launcher passes the show's universes
$env:MONITOR_FIXTURES_FILE = 'cuepix-fixtures.json'
& "$PSScriptRoot\start-monitor.ps1"
