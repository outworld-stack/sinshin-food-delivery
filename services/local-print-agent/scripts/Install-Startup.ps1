[CmdletBinding()]
param(
    [string]$DataDirectory = (Join-Path $env:LOCALAPPDATA 'Sinshin\PrintAgent')
)
$ErrorActionPreference = 'Stop'
$agentData = [System.IO.Path]::GetFullPath($DataDirectory)
$startScript = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'Start-Agent.ps1'))
if (-not (Test-Path -LiteralPath (Join-Path $agentData 'agent.json') -PathType Leaf)) {
    throw 'Run Sinshin.PrintAgent.exe --configure under this Windows account before enabling automatic startup.'
}
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$taskName = 'Sinshin Print Agent - ' + $identity.User.Value
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File "{0}" -DataDirectory "{1}"' -f $startScript, $agentData
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
$principal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Outbound Sinshin invoice worker for this Windows account.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output 'Startup installed for the current Windows account. Keep this account signed in for printing.'
Write-Output ('Status log: ' + (Join-Path $agentData 'logs\agent.log'))
