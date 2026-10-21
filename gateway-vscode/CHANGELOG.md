# Change Log

All notable changes to the "gateway-vscode" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.3.0] - 2026-10-21

### Added

- `webcodeGateway.timeouts` exposes every deadline (command execution, tool call, bridge code TTL,
  approval TTL, browser launch wait, bridge request); the startup log prints one `timeouts:` line
  with the values actually in force.
- Browser-side pairing: the bridge popup can discover local workspaces and ask VS Code to approve a
  session request before a launch code is issued (`GET /v1/ping`, `POST /v1/session/request`).
- Hot/cold configuration classification: tooling changes hot-reload and keep the bridge session,
  connection-identity changes cold-restart and revoke it.
- Gateway logs persist to `globalStorage/.../logs/gateway-YYYYMMDD.log` (7-day retention).
- Build fingerprint on activation (`build: version=… buildHash=… builtAt=… bridgeProtocol=…`) and
  additive build fields on the authenticated `GET /v1/status`.

### Fixed

- The MCP client handshake reports the real extension version instead of a hard-coded `1.0.0`.
- Release guard tests fail when the extension manifest, bridge manifest, and packaged bridge
  descriptor disagree on the version.

- Restart continuity: the bridge session token is persisted per workspace (SecretStorage, with a
  derived and an in-memory fallback), so a reloaded window or restarted gateway no longer forces a
  browser re-pair. `/v1/status` reports `gatewayInstanceId` and `lastInterrupted`; a new
  `deactivate()` writes an in-flight call snapshot (digest plus a redacted 120-character preview,
  never replayed) before stopping the gateway.

### Upgrade notes

- Restart the browser once after upgrading (the new bridge build is staged first).
- Reconnect once after upgrading (the bridge session token lives in gateway memory).
