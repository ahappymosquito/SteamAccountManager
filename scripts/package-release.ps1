# Builds the Windows installer and portable archive into the project release directory.
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$package = Get-Content -Raw (Join-Path $projectRoot "package.json") | ConvertFrom-Json
$version = [string]$package.version
$targetRelease = Join-Path $projectRoot "src-tauri\target\release"
$application = Join-Path $targetRelease "steam-account-manager.exe"
$installerMatches = @(
    Get-ChildItem -LiteralPath (Join-Path $targetRelease "bundle\nsis") `
        -Filter "*_${version}_x64-setup.exe" -File
)

if (-not (Test-Path -LiteralPath $application -PathType Leaf)) {
    throw "Portable application binary was not produced: $application"
}
if ($installerMatches.Count -ne 1) {
    throw "Expected one NSIS installer for version $version, found $($installerMatches.Count)."
}

$releaseDirectory = Join-Path $projectRoot "release"
New-Item -ItemType Directory -Path $releaseDirectory -Force | Out-Null

$installerDestination = Join-Path $releaseDirectory $installerMatches[0].Name
Copy-Item -LiteralPath $installerMatches[0].FullName -Destination $installerDestination -Force

$portableName = "Steam-Account-Manager-$version-windows-x64-portable"
$portableArchive = Join-Path $releaseDirectory "$portableName.zip"
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) (
    "steam-account-manager-package-" + [System.Guid]::NewGuid().ToString("N")
)
$portableDirectory = Join-Path $temporaryRoot $portableName

try {
    New-Item -ItemType Directory -Path $portableDirectory -Force | Out-Null
    Copy-Item -LiteralPath $application `
        -Destination (Join-Path $portableDirectory "Steam Account Manager.exe")
    Copy-Item -LiteralPath (Join-Path $projectRoot "README.md") -Destination $portableDirectory
    Copy-Item -LiteralPath (Join-Path $projectRoot "LICENSE") -Destination $portableDirectory
    Compress-Archive -LiteralPath $portableDirectory -DestinationPath $portableArchive -Force
}
finally {
    if (Test-Path -LiteralPath $temporaryRoot) {
        Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
    }
}

$artifacts = Get-Item -LiteralPath $installerDestination, $portableArchive
foreach ($artifact in $artifacts) {
    if ($artifact.Length -le 0) {
        throw "Release artifact is empty: $($artifact.FullName)"
    }
    Write-Output ("{0}`t{1} bytes" -f $artifact.FullName, $artifact.Length)
}
