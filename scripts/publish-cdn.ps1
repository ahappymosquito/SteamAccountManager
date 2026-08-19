# Upload current Windows artifacts and latest.json to cdn.qrqto.club.
param(
    [string]$RemoteHost = "root_qrqto",
    [string]$RemoteRoot = "/var/www/cdn.qrqto.club"
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$package = Get-Content -Raw (Join-Path $projectRoot "package.json") | ConvertFrom-Json
$version = [string]$package.version
$releaseDirectory = Join-Path $projectRoot "release"
$installer = Join-Path $releaseDirectory "Steam Account Manager_${version}_x64-setup.exe"
$portable = Join-Path $releaseDirectory "Steam-Account-Manager-$version-portable.exe"

if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
    throw "Installer not found: $installer"
}
if (-not (Test-Path -LiteralPath $portable -PathType Leaf)) {
    throw "Portable executable not found: $portable"
}

$sha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
$size = (Get-Item -LiteralPath $installer).Length
$notes = "Steam Account Manager $version"
$changelog = Join-Path $releaseDirectory "CHANGELOG.md"
if (Test-Path -LiteralPath $changelog -PathType Leaf) {
    $block = [System.Collections.Generic.List[string]]::new()
    $capture = $false
    foreach ($line in Get-Content -LiteralPath $changelog -Encoding utf8) {
        if ($line -match "^## $([regex]::Escape($version))\b") {
            $capture = $true
            continue
        }
        if ($capture -and $line -match "^## ") {
            break
        }
        if ($capture -and $line.Trim().Length -gt 0) {
            [void]$block.Add($line.Trim())
        }
    }
    if ($block.Count -gt 0) {
        $notes = ($block -join " ")
    }
}

$latest = [ordered]@{
    version  = $version
    notes    = $notes
    setupUrl = "https://cdn.qrqto.club/app/Steam-Account-Manager-setup.exe"
    sha256   = $sha256
    size     = $size
}
$latestPath = Join-Path $releaseDirectory "latest.json"
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($latestPath, ($latest | ConvertTo-Json -Compress), $utf8)

$remoteApp = "${RemoteHost}:${RemoteRoot}/app"
scp -o BatchMode=yes -o ConnectTimeout=20 `
    -o StrictHostKeyChecking=accept-new `
    $installer $portable $latestPath `
    $remoteApp
if ($LASTEXITCODE -ne 0) {
    throw "Failed to upload application artifacts to $remoteApp"
}

ssh -o BatchMode=yes -o ConnectTimeout=20 $RemoteHost @"
set -e
cd '$RemoteRoot/app'
cp -f 'Steam Account Manager_${version}_x64-setup.exe' 'Steam-Account-Manager-setup.exe'
cp -f 'Steam-Account-Manager-${version}-portable.exe' 'Steam-Account-Manager-portable.exe'
chmod 644 *.exe latest.json
"@
if ($LASTEXITCODE -ne 0) {
    throw "Failed to publish stable CDN aliases for version $version"
}

Write-Output "Published $version to https://cdn.qrqto.club/app/latest.json"
