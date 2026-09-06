# Archives prior Windows artifacts, copies current builds, and optionally creates the publication archive.
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
    "NSIS_HOOK_PREINSTALL",
    "!insertmacro NSIS_HOOK_PREINSTALL",
    "NSIS_HOOK_POSTINSTALL",
    "!insertmacro NSIS_HOOK_POSTINSTALL",
    '!define INSTALLWEBVIEW2MODE ""'
)) {
    if (-not $installerScriptContent.Contains($requiredInstallerText)) {
        throw "Generated NSIS script is missing the installer hook text: $requiredInstallerText"
    }
}

$installerHooks = Join-Path $projectRoot "src-tauri\windows\installer-hooks.nsh"
$installerHooksContent = Get-Content -Raw -LiteralPath $installerHooks
foreach ($requiredHookText in @(
    "NSIS_HOOK_PREINSTALL",
    "https://cdn.qrqto.club/webview2/MicrosoftEdgeWebView2RuntimeInstallerX64.exe",
    "Abort"
)) {
    if (-not $installerHooksContent.Contains($requiredHookText)) {
        throw "Installer hooks are missing the WebView2 CDN check text: $requiredHookText"
    }
}
if ($installerMatches.Count -ne 1) {
    throw "Expected one NSIS installer for version $version, found $($installerMatches.Count)."
}

$releaseDirectory = Join-Path $projectRoot "release"
New-Item -ItemType Directory -Path $releaseDirectory -Force | Out-Null
$historyDirectory = Join-Path $releaseDirectory "history"
New-Item -ItemType Directory -Path $historyDirectory -Force | Out-Null

# Keep release/ focused on the newest build while preserving every older artifact.
# Leave documentation such as CHANGELOG.md in place; only archive installers and zips.
$archiveStamp = Get-Date -Format "yyyyMMdd-HHmmss"
foreach ($existing in @(
    Get-ChildItem -LiteralPath $releaseDirectory -Force |
        Where-Object {
            $_.FullName -ne $historyDirectory -and
            (
                $_.Extension -in @(".exe", ".zip") -or
                ($_.PSIsContainer)
            )
        }
)) {
    $archiveDestination = Join-Path $historyDirectory $existing.Name
    if (Test-Path -LiteralPath $archiveDestination) {
        if ($existing.PSIsContainer) {
            $archiveName = "{0}-{1}-{2}" -f $existing.Name, $archiveStamp, [System.Guid]::NewGuid().ToString("N").Substring(0, 8)
        }
        else {
            $archiveName = "{0}-{1}-{2}{3}" -f `
                [System.IO.Path]::GetFileNameWithoutExtension($existing.Name), `
                $archiveStamp, `
                [System.Guid]::NewGuid().ToString("N").Substring(0, 8), `
                $existing.Extension
        }
        $archiveDestination = Join-Path $historyDirectory $archiveName
    }
    Move-Item -LiteralPath $existing.FullName -Destination $archiveDestination
}

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
        $changelog = Join-Path $releaseDirectory "CHANGELOG.md"
        if (Test-Path -LiteralPath $changelog -PathType Leaf) {
            Copy-Item -LiteralPath $changelog -Destination $portableDirectory
        }
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

$publishCdn = Join-Path $PSScriptRoot "publish-cdn.ps1"
try {
    & $publishCdn
}
catch {
    Write-Warning "CDN publish skipped: $_"
}

$publishVault = Join-Path $PSScriptRoot "publish-vault.ps1"
try {
    & $publishVault
}
catch {
    Write-Warning "Vault server publish skipped: $_"
}

foreach ($buildDirectory in @(
    (Join-Path $projectRoot "src-tauri\target"),
    (Join-Path $projectRoot "dist")
)) {
    if (-not (Test-Path -LiteralPath $buildDirectory)) {
        continue
    }
    try {
        Remove-Item -LiteralPath $buildDirectory -Recurse -Force
        Write-Output "Removed build directory: $buildDirectory"
    }
    catch {
        Write-Warning "Failed to remove build directory ${buildDirectory}: $_"
    }
}
