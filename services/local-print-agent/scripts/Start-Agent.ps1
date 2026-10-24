[CmdletBinding()]
param(
    [string]$DataDirectory = (Join-Path $env:LOCALAPPDATA 'Sinshin\PrintAgent')
)
$ErrorActionPreference = 'Stop'
$agentExe = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\Sinshin.PrintAgent.exe'))
if (-not (Test-Path -LiteralPath $agentExe -PathType Leaf)) {
    throw 'Extract the published Windows package first. Sinshin.PrintAgent.exe must be beside the scripts folder.'
}
$agentData = [System.IO.Path]::GetFullPath($DataDirectory)
$agentLogs = Join-Path $agentData 'logs'
New-Item -ItemType Directory -Force -Path $agentLogs | Out-Null
# Scheduled Task launches this script hidden. The console worker writes only
# job IDs/status and generic connectivity diagnostics; never receipt payloads.
& $agentExe --data-dir $agentData *> (Join-Path $agentLogs 'agent.log')
exit $LASTEXITCODE
