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
   - One shot: `pnpm bridge:sync` (picks the newest zip under `release\`; equivalent to `powershell -File scripts/release/update-manual-bridge.ps1`);
   - Manual: extract the new zip and overwrite everything in `dist/manual-bridge/`.
2. `chrome://extensions` → webcode bridge card → click the **reload** icon.
3. Reconnect from the VS Code status bar (launch codes are single-use and must be regenerated).

## Version consistency

- The **browser-side** handshake requires the VS Code extension version and the
  bridge manifest version to match exactly (plus a `bridgeProtocolVersion`
  check); mismatches are rejected with a hint about which side is outdated.
- The **gateway side** of redemption only requires the bridge to be at least
  `minExtensionVersion` from `shared/src/bridgeProtocol.json` (currently
  `1.0.0`). An older bridge can therefore pass the gateway check but is still
  stopped by the browser-side equality check — the conclusion is unchanged:
  **both sides must ship the same version**.
- Upgrade both sides together whenever the VS Code extension (vsix) changes.
- Isolated-browser users do not sync manually (the extension manager stages
  updates and asks for one browser restart on the next connect).

Since 1.3.0 the extension logs a build fingerprint
(`build: version=… buildHash=… builtAt=…`); compare it with
`browser-extension/bridge-build.json` to confirm the loaded bridge and the
extension come from the same build.

## Notes

- Never move or rename the fixed folder after registering it (Chrome tracks the absolute path).
- If a version mismatch persists: confirm step 2 was executed, then check the
  version in `dist/manual-bridge/manifest.json`.
