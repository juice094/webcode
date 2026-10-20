# Deprecated forwarding stub. The manual bridge sync moved to scripts/release/update-manual-bridge.ps1.
# This stub will be removed in a future release; use `pnpm bridge:sync` instead.
Write-Warning "update-manual-bridge.ps1 has moved to scripts/release/update-manual-bridge.ps1. Use: pnpm bridge:sync"
powershell -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\scripts\release\update-manual-bridge.ps1" @args
exit $LASTEXITCODE
