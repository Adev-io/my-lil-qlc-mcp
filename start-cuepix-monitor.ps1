$ErrorActionPreference = 'Stop'
$env:MONITOR_UNIVERSES = '0,1'
$env:MONITOR_FIXTURES_FILE = 'cuepix-fixtures.json'
& "$PSScriptRoot\start-monitor.ps1"
