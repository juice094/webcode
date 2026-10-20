# Sync the newest manual-install browser bridge build into the fixed load folder.
# After running this, reload the extension on chrome://extensions and reconnect from VS Code.
param(
    [string]$Zip = "",
    [string]$Target = (Join-Path $PSScriptRoot "dist\manual-bridge")
)

$ErrorActionPreference = "Stop"

if (-not $Zip) {
    $latest = Get-ChildItem (Join-Path $PSScriptRoot "release\webcode-bridge-browser-*.zip") |
        Sort-Object Name | Select-Object -Last 1
    if (-not $latest) {
        throw "No webcode-bridge-browser-*.zip found under $(Join-Path $PSScriptRoot 'release'). Run build_release.ps1 first."
    }
    $Zip = $latest.FullName
}

if (-not (Test-Path $Zip)) {
    throw "Zip not found: $Zip"
}

# Safety guard: only ever wipe a folder that already looks like a bridge install (or is empty/new).
if ((Test-Path $Target) -and -not (Test-Path (Join-Path $Target "manifest.json"))) {
    throw "Refusing to sync into '$Target': it does not look like a webcode bridge folder (manifest.json missing)."
}

New-Item -ItemType Directory -Force -Path $Target | Out-Null
Get-ChildItem -LiteralPath $Target -Force | Remove-Item -Recurse -Force
Expand-Archive -LiteralPath $Zip -DestinationPath $Target -Force

$manifest = Get-Content (Join-Path $Target "manifest.json") -Raw | ConvertFrom-Json
Write-Host "Bridge $($manifest.version) synced from $(Split-Path $Zip -Leaf) to $Target"
Write-Host "Next: chrome://extensions -> reload the webcode bridge card, then reconnect from the VS Code status bar."
