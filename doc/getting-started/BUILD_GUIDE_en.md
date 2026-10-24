# Build Guide

Language: English | [中文](BUILD_GUIDE.md)

You can use the built-in scripts to package the VS Code extension (`.vsix`) and the browser extension (`.zip`) with one click.

## Requirements

- Git
- Node.js 22
- pnpm 10.25.0 (matches the `packageManager` field in `package.json`)
- VS Code
- macOS / Linux needs a working `zip` command
- Windows needs the built-in `tar.exe` command included with Windows 10/11

## Download the Source

If you have a GitHub SSH key configured:

```bash
git clone git@github.com:juice094/webcode.git
cd webcode
```

You can also use HTTPS:

```bash
git clone https://github.com/juice094/webcode.git
cd webcode
```

The build scripts run `pnpm install` automatically.

## macOS / Linux

Run the Bash script in the project root directory:

```bash
chmod +x scripts/release/build-release.sh
./scripts/release/build-release.sh
```

## Windows

You can use the PowerShell script for native packaging (no Bash or WSL required):

### Method A: Right-click Run (Easiest)

1. Locate `scripts/release/build-release.ps1` in the folder.
2. Right-click the file.
3. Select `"Run with PowerShell"`.

### Method B: Command Line

Execute in a PowerShell terminal:

```powershell
pnpm release  # or .\scripts\release\build-release.ps1
```

If you see an error saying "running scripts is disabled on this system", open PowerShell as Administrator, run the following command to enable permissions, and try again:

```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

## Versions and build fingerprints

Before a release, exactly three version fields are edited by hand; everything else is generated:

| File | Purpose |
|:---|:---|
| `gateway-vscode/package.json` | VSIX version |
| `bridge-browser/package.json` | browser bridge package version |
| `bridge-browser/manifest.json` | browser manifest version (the `prebuild` hook asserts it matches `package.json`) |

`gateway-vscode/browser-extension/` is a generated directory (gitignored). It is rebuilt during
packaging by `gateway-vscode/scripts/copy-browser-extension.mjs`, which also writes `bridge-build.json`
(`extensionVersion` / `bridgeProtocolVersion` / `buildHash` / `builtAt`). **Never edit it by hand** —
bump the versions and repackage.

The guard test `gateway-vscode/src/unit-test/releaseVersioning.test.ts` fails when the three manifests
disagree, when a version is not dotted semver, or when `bridge-build.json` lags behind the manifests
(the descriptor case is skipped when the generated directory is absent, so a clean clone can run unit
tests directly).

Build fingerprint: activation logs one line
`build: version=… buildHash=… builtAt=… bridgeProtocol=… node=… vscode=…`, and the authenticated
`GET /v1/status` returns `version`, `buildHash`, `bridgeProtocolVersion`, and `startedAt`. That
answers "is the installed vsix the current code?" without comparing file hashes.

`release/` is wiped on every release run, so move the previous installers to `release-archive/`
(not committed) before building.

## Artifacts

After a successful build, a `release/` folder will be generated in the root directory containing:

- `webcode-gateway-vscode-x.x.x.vsix`
  - VS Code extension installer.
  - Installation: VS Code Extensions sidebar -> Click `...` at top right -> `Install from VSIX...`

- `webcode-bridge-browser-x.x.x.zip`
  - Browser extension archive.
  - Installation: Unzip -> Chrome/Edge Extensions page -> Enable "Developer mode" -> `Load unpacked`.
