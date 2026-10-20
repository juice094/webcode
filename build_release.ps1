# Deprecated forwarding stub. The release build moved to scripts/release/build-release.ps1.
# This stub will be removed in a future release; use `pnpm release` instead.
Write-Warning "build_release.ps1 has moved to scripts/release/build-release.ps1. Use: pnpm release"
powershell -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\scripts\release\build-release.ps1" @args
exit $LASTEXITCODE
