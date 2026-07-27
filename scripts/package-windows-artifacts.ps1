# Copies local Windows test artifacts and optionally creates the publication archive.
param(
    [switch]$IncludeReleaseArchive
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$package = Get-Content -Raw (Join-Path $projectRoot "package.json") | ConvertFrom-Json
$version = [string]$package.version
$targetRelease = Join-Path $projectRoot "src-tauri\target\release"
$application = Join-Path $targetRelease "steam-account-manager.exe"
$installerScript = Join-Path $targetRelease "nsis\x64\installer.nsi"
$installerMatches = @(
    Get-ChildItem -LiteralPath (Join-Path $targetRelease "bundle\nsis") `
        -Filter "*_${version}_x64-setup.exe" -File
)

if (-not (Test-Path -LiteralPath $application -PathType Leaf)) {
    throw "Portable application binary was not produced: $application"
}
if (-not (Test-Path -LiteralPath $installerScript -PathType Leaf)) {
    throw "Generated NSIS script was not produced: $installerScript"
}
$installerScriptContent = Get-Content -Raw $installerScript
foreach ($requiredInstallerText in @(
    "installer-hooks.nsh",
    "NSIS_HOOK_POSTINSTALL",
    "!insertmacro NSIS_HOOK_POSTINSTALL"
)) {
    if (-not $installerScriptContent.Contains($requiredInstallerText)) {
        throw "Generated NSIS script is missing the shortcut refresh hook text: $requiredInstallerText"
    }
}
if ($installerMatches.Count -ne 1) {
    throw "Expected one NSIS installer for version $version, found $($installerMatches.Count)."
}

$releaseDirectory = Join-Path $projectRoot "release"
New-Item -ItemType Directory -Path $releaseDirectory -Force | Out-Null

$installerDestination = Join-Path $releaseDirectory $installerMatches[0].Name
Copy-Item -LiteralPath $installerMatches[0].FullName -Destination $installerDestination -Force

$portableExecutable = Join-Path $releaseDirectory "Steam-Account-Manager-$version-portable.exe"
Copy-Item -LiteralPath $application -Destination $portableExecutable -Force

$artifacts = @(
    Get-Item -LiteralPath $installerDestination
    Get-Item -LiteralPath $portableExecutable
)

if ($IncludeReleaseArchive) {
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
        $artifacts += Get-Item -LiteralPath $portableArchive
    }
    finally {
        if (Test-Path -LiteralPath $temporaryRoot) {
            Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
        }
    }
}

foreach ($artifact in $artifacts) {
    if ($artifact.Length -le 0) {
        throw "Release artifact is empty: $($artifact.FullName)"
    }
    Write-Output ("{0}`t{1} bytes" -f $artifact.FullName, $artifact.Length)
}
