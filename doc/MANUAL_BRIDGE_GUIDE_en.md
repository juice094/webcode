# Manually installed browser bridge: source / extract / load-location convention

Applies when the bridge is loaded via `chrome://extensions` developer mode
("Load unpacked") instead of the VS Code-managed isolated browser. Chrome
forbids self-updating unpacked extensions, so updates must follow this convention.

## The three fixed elements

| Element | Location |
|---------|----------|
| **Source** (new build archive) | `release/webcode-bridge-browser-<version>.zip` in this repo; the same file is attached to GitHub Releases (juice094/webcode) |
| **Extract/sync target** (single source of truth) | `dist/manual-bridge/` at the repo root (version-neutral fixed path, gitignored) |
| **Load location** (path Chrome registered) | `chrome://extensions` → Load unpacked → pick the `dist/manual-bridge` folder above — done **once** |

## Updating after each release

1. Sync the new build into the fixed folder (either):
   - One shot: `powershell -File update-manual-bridge.ps1` (picks the newest zip under `release\`);
   - Manual: extract the new zip and overwrite everything in `dist/manual-bridge/`.
2. `chrome://extensions` → webcode bridge card → click the **reload** icon.
3. Reconnect from the VS Code status bar (launch codes are single-use and must be regenerated).

## Version consistency

- The gateway handshake requires the VS Code extension version and the bridge
  manifest version to match exactly (plus a `bridgeProtocolVersion` check);
  mismatches are rejected with a hint about which side is outdated.
- Upgrade both sides together whenever the VS Code extension (vsix) changes.
- Isolated-browser users do not need this convention (the extension manager
  stages updates automatically).

## Notes

- Never move or rename the fixed folder after registering it (Chrome tracks the absolute path).
- If a version mismatch persists: confirm step 2 was executed, then check the
  version in `dist/manual-bridge/manifest.json`.
