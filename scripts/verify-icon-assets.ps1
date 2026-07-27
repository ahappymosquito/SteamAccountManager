# Verifies that every application icon derives from the transparent master and the NSIS refresh hook stays configured.
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$masterPath = Join-Path $projectRoot "src-tauri\app-icon.png"
$generated128Path = Join-Path $projectRoot "src-tauri\icons\128x128.png"
$webIconPath = Join-Path $projectRoot "public\app-icon.png"
$icoPath = Join-Path $projectRoot "src-tauri\icons\icon.ico"
$configPath = Join-Path $projectRoot "src-tauri\tauri.conf.json"
$hookPath = Join-Path $projectRoot "src-tauri\windows\installer-hooks.nsh"

Add-Type -AssemblyName System.Drawing

function Assert-Condition {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) {
        throw $Message
    }
}

function Test-Png {
    param(
        [string]$Path,
        [int]$ExpectedWidth,
        [int]$ExpectedHeight,
        [switch]$TransparentCorners
    )

    Assert-Condition (Test-Path -LiteralPath $Path -PathType Leaf) "Missing PNG asset: $Path"
    $bitmap = [System.Drawing.Bitmap]::new($Path)
    try {
        Assert-Condition ($bitmap.Width -eq $ExpectedWidth) "Unexpected PNG width for $Path"
        Assert-Condition ($bitmap.Height -eq $ExpectedHeight) "Unexpected PNG height for $Path"
        Assert-Condition ($bitmap.PixelFormat.ToString() -match "Argb") "PNG is not RGBA: $Path"
        if ($TransparentCorners) {
            $corners = @(
                $bitmap.GetPixel(0, 0).A
                $bitmap.GetPixel($bitmap.Width - 1, 0).A
                $bitmap.GetPixel(0, $bitmap.Height - 1).A
                $bitmap.GetPixel($bitmap.Width - 1, $bitmap.Height - 1).A
            )
            Assert-Condition (@($corners | Where-Object { $_ -ne 0 }).Count -eq 0) `
                "PNG corners are not fully transparent: $Path"
        }
    }
    finally {
        $bitmap.Dispose()
    }
}

Test-Png -Path $masterPath -ExpectedWidth 1024 -ExpectedHeight 1024 -TransparentCorners
Test-Png -Path $generated128Path -ExpectedWidth 128 -ExpectedHeight 128 -TransparentCorners
Test-Png -Path $webIconPath -ExpectedWidth 128 -ExpectedHeight 128 -TransparentCorners

$generatedHash = (Get-FileHash -LiteralPath $generated128Path -Algorithm SHA256).Hash
$webHash = (Get-FileHash -LiteralPath $webIconPath -Algorithm SHA256).Hash
Assert-Condition ($generatedHash -eq $webHash) "Web icon differs from generated 128px icon."

$icoBytes = [System.IO.File]::ReadAllBytes($icoPath)
Assert-Condition ($icoBytes.Length -ge 6) "ICO header is incomplete."
$icoCount = [BitConverter]::ToUInt16($icoBytes, 4)
Assert-Condition ($icoBytes.Length -ge (6 + 16 * $icoCount)) "ICO directory is incomplete."
$layers = for ($index = 0; $index -lt $icoCount; $index++) {
    $offset = 6 + 16 * $index
    $width = [int]$icoBytes[$offset]
    if ($width -eq 0) { $width = 256 }
    [pscustomobject]@{
        Width = $width
        Bits = [BitConverter]::ToUInt16($icoBytes, $offset + 6)
    }
}
$requiredWidths = @(16, 24, 32, 48, 64, 256)
foreach ($requiredWidth in $requiredWidths) {
    Assert-Condition (@($layers | Where-Object { $_.Width -eq $requiredWidth -and $_.Bits -eq 32 }).Count -gt 0) `
        "ICO is missing a ${requiredWidth}px 32-bit layer."
}

Assert-Condition (-not (Test-Path -LiteralPath (Join-Path $projectRoot "public\favicon.svg"))) `
    "Legacy public shield SVG still exists."
Assert-Condition (-not (Test-Path -LiteralPath (Join-Path $projectRoot "src-tauri\icons\icon.svg"))) `
    "Legacy Tauri shield SVG still exists."

$config = Get-Content -Raw $configPath | ConvertFrom-Json
$nsis = $config.bundle.windows.nsis
Assert-Condition ($config.bundle.icon -contains "icons/icon.ico") "Tauri bundle icon is not the generated ICO."
Assert-Condition ($nsis.installerIcon -eq "icons/icon.ico") "NSIS installer icon is not configured."
Assert-Condition ($nsis.uninstallerIcon -eq "icons/icon.ico") "NSIS uninstaller icon is not configured."
Assert-Condition ($nsis.installerHooks -eq "./windows/installer-hooks.nsh") "NSIS installer hook is not configured."

$hook = Get-Content -Raw $hookPath
foreach ($requiredText in @(
    "NSIS_HOOK_POSTINSTALL",
    "UpdateMode",
    "FileExists",
    "CreateShortcut",
    "SetLnkAppUserModelId",
    "SHChangeNotify"
)) {
    Assert-Condition ($hook.Contains($requiredText)) "NSIS hook is missing: $requiredText"
}
Assert-Condition (-not $hook.Contains("UnpinShortcut")) "NSIS hook must not unpin taskbar shortcuts."

Write-Output "Icon assets verified: 1024px RGBA master, matching web icon, ICO layers, and NSIS refresh hook."
