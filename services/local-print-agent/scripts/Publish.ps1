[CmdletBinding()]
param(
    [string]$Dotnet = 'dotnet',
    [ValidateSet('win-x64', 'win-arm64')][string]$Runtime = 'win-x64'
)
$ErrorActionPreference = 'Stop'
$agentRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$project = Join-Path $agentRoot 'Sinshin.PrintAgent\Sinshin.PrintAgent.csproj'
$artifacts = Join-Path $agentRoot 'artifacts'
$release = Join-Path $artifacts ('Sinshin.PrintAgent-' + $Runtime)
New-Item -ItemType Directory -Force -Path $release | Out-Null
& $Dotnet publish $project -c Release -r $Runtime --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:DebugType=None -o $release
if ($LASTEXITCODE -ne 0) { throw 'The .NET publish command failed.' }
Copy-Item -LiteralPath (Join-Path $agentRoot 'README.md') -Destination $release -Force
$releaseScripts = Join-Path $release 'scripts'
New-Item -ItemType Directory -Force -Path $releaseScripts | Out-Null
foreach ($name in @('Start-Agent.ps1', 'Install-Startup.ps1', 'Remove-Startup.ps1')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $releaseScripts -Force
}
Compress-Archive -LiteralPath $release -DestinationPath (Join-Path $artifacts ('Sinshin.PrintAgent-' + $Runtime + '.zip')) -Force
# Explicit source selection prevents SDK caches, station tokens, job journals,
# test fixtures and any generated package from entering the source archive.
$source = Join-Path $artifacts 'Sinshin.PrintAgent-source'
New-Item -ItemType Directory -Force -Path $source | Out-Null
foreach ($folder in @('Sinshin.PrintAgent', 'Sinshin.PrintAgent.Tests', 'scripts')) {
    $destination = Join-Path $source $folder
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $agentRoot $folder) -File |
        Where-Object { $_.Extension -in '.cs', '.csproj', '.ps1' } |
        Copy-Item -Destination $destination -Force
}
Copy-Item -LiteralPath (Join-Path $agentRoot 'README.md') -Destination $source -Force
Compress-Archive -LiteralPath $source -DestinationPath (Join-Path $artifacts 'Sinshin.PrintAgent-source.zip') -Force
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $artifacts ('Sinshin.PrintAgent-' + $Runtime + '.zip')), (Join-Path $artifacts 'Sinshin.PrintAgent-source.zip') |
    ForEach-Object { '{0}  {1}' -f $_.Hash.ToLowerInvariant(), [System.IO.Path]::GetFileName($_.Path) } |
    Set-Content -LiteralPath (Join-Path $artifacts 'SHA256SUMS.txt') -Encoding ascii
Write-Output ('Packages and SHA256SUMS.txt: ' + $artifacts)
