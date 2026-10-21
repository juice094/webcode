# webcode FAQ

Language: English | [中文](FAQ_GUIDE.md)

## What do I need before the first launch?

Check these items to avoid common first-launch failures:

- Install [VS Code](https://code.visualstudio.com/) 1.106.1 or later.
- Open a local project folder or workspace in VS Code, not just a single file.
- The default browser mode is Edge Isolated Keepalive and does not require manual browser-extension installation; Windows usually includes Edge, while macOS needs [Microsoft Edge](https://www.microsoft.com/edge/download) installed first.
- On Windows, the default POSIX mode of `execute_command` requires Git Bash. If Git Bash is installed in a custom path, point `webcodeGateway.commandShell.path` to `bash.exe`. You can also explicitly select a detected `pwsh` or `powershell` profile for PowerShell commands.
- Have an account for the target web AI product and make sure its site is reachable from your network. The first launch requires signing in once inside the isolated Edge profile.

## What if `@webcode` or `/webcode` does not trigger on the page?

Make sure there is a space before the trigger word, for example:

```text
Read the current project structure. /webcode
```

If the page still does not trigger, refresh the current page, confirm the browser extension popup shows that it is connected, then type the trigger again. In a new conversation, if the first message forgets the trigger, webcode also shows the initialization confirmation when you click Send or press Enter.

## What if the AI returns a tool call and the tool succeeds, but the page does not change?

Refresh the current page. After the refresh, webcode scans the page again and reruns the tool-result delivery flow for tool calls that still need to be handled.

## What if isolated Edge opens an extra new tab when opening an AI page?

Some Microsoft Edge versions may open an extra new tab based on the isolated profile's New Tab settings. In the isolated Edge window opened by webcode, go to `edge://settings/startHomeNTP`, then turn off "Preload the new tab page for a faster experience" under "Start, home, and new tabs".

If the extra new tab still appears, check whether "When Edge starts" is set to "Open the new tab page", and try switching it to "Open tabs from the previous session". After changing the setting, fully close all Edge processes, then open the AI page from VS Code again.

## How can I see which tools the AI called before?

Click the browser extension popup and enable logs. The summary column records each tool call, so you can review which tools the AI called and in what order.

## Where are the gateway logs? How do I troubleshoot a disconnect?

Gateway logs are persisted so they survive window closes and abnormal exits:

- VS Code Output panel: Command Palette → `Output: Show Output Channels...` → pick `MCP Gateway` (live view).
- Persisted log file: `globalStorage/three-water666.gateway-vscode/logs/gateway-YYYYMMDD.log`
  (on Windows: `%APPDATA%\Code\User\globalStorage\three-water666.gateway-vscode\logs\`),
  rotated daily and kept for 7 days by default. Startup, shutdown, idle auto-stop, start
  failures, and uncaught extension-host exceptions are all recorded.

Troubleshooting order for a disconnect:

1. The floating browser log / system notification explains the cause (the gateway may have
   stopped after 30 minutes of inactivity; adjust `webcodeGateway.idleTimeoutMinutes`, up to 240).
2. Click webcode in the VS Code status bar to restart the service, then reconnect from VS Code
   (launch codes are single-use and short-lived, so an "invalid link" error on an old link is expected).
3. If it still fails, check the `ERROR`/`WARN` entries in the persisted log file above.

## Why does upgrading to 1.3.0 need a browser restart and another pairing?

They are two separate things:

1. **Browser restart**: the new browser bridge build is staged first. If an isolated browser is
   running, the next connect asks you to restart it; confirming closes and relaunches the browser so
   the new bridge takes effect. Manual installs should run `pnpm bridge:sync` and then click the
   reload button on the bridge card in `chrome://extensions`.
2. **Another pairing**: the token is now persisted per workspace (VS Code SecretStorage), so the
   first connection after upgrading still needs pairing, but later window reloads, extension
   restarts, and gateway restarts resume automatically without pairing again. (If you rotate the
   token yourself, or stop the service on the VS Code side, reconnect once.)

Why both sides must be upgraded together: the browser handshake requires
"VS Code extension version === browser extension version" (exact equality). Upgrading only one side
is rejected with a version mismatch.

To confirm which build is running, open the command palette, choose
`Output: Show Output Channels...`, select `MCP Gateway`: the first line is
`build: version=… buildHash=… builtAt=…`, and it must match
`browser-extension/bridge-build.json` inside the installed package.

## Do I need to pair again after closing or reloading the window?

No. Since 1.3.0:

- the gateway token is stored per workspace in the VS Code secret store, so a restarted gateway
  accepts the same token the tab already holds;
- `GET /v1/status` returns `gatewayInstanceId` (new on every start) and `lastInterrupted`; when the
  browser sees a new instance id but its token still works, the session counts as automatically
  recovered and only the stored id is updated;
- returning to a tab probes immediately instead of waiting for the 60-second check, so recovery
  usually happens within seconds;
- if the token really is rejected (you rotated it, or the workspace changed), the tab says it is
  recovering automatically and points at the reconnect path.

Interrupted tool calls are **never replayed**. Calls that were running when the host went away are
written to `globalStorage/three-water666.gateway-vscode/state/shutdown-<workspaceId>.json`
(argument digest plus a redacted preview capped at 120 characters, ignored after 10 minutes), and
the next start reports "N call(s) were interrupted, retry them" in the log and in
`/v1/status.lastInterrupted`.

The security boundary is unchanged: the token only works on `127.0.0.1`, and redemption still
requires the origin allowlist, the protocol version, and a single-use launch code. To invalidate
every connected tab immediately, rotate the token (the API exists in this release; a command entry
follows in a later release).

## What should I do about long-running tasks or commands?

`execute_command` has a deadline, and hitting it only stops the shell process itself: child processes
the script started may keep running. For builds, test suites, and long-running dev servers, use
`run_in_terminal` instead. It opens a real terminal and returns a `session_id` immediately; read the
output or interrupt the run later with `terminal_session` (`read` / `stop` / `close`).

## How do I tune the timeouts?

They all live under the VS Code setting `webcodeGateway.timeouts` (milliseconds unless noted), and
changing them restarts the gateway automatically:

| Setting | Default | Purpose |
|:---|:---|:---|
| `timeouts.commandExecutionMs` | 60000 | Default deadline for `execute_command` |
| `timeouts.commandExecutionMaxMs` | 0 | Ceiling for `execute_command`; `0` disables it. The effective deadline is the smaller of the request and this value |
| `timeouts.toolCallMs` | 0 | Gateway-side deadline for one tool call; `0` means no deadline |
| `timeouts.bridgeCodeTtlSeconds` | 120 | Lifetime of a single-use launch code (seconds) |
| `timeouts.approvalTtlSeconds` | 120 | Lifetime of a command approval challenge and token (seconds) |
| `timeouts.browserLaunchWaitMs` | 10000 | How long to wait for an isolated browser to expose its bridge process |
| `timeouts.bridgeRequestMs` | 0 | Browser-to-gateway request deadline; `0` means no deadline |

The `0` = no-deadline meaning applies to `commandExecutionMaxMs`, `toolCallMs` and `bridgeRequestMs`; the
other settings have their own minimums. `commandExecutionMaxMs` only puts a ceiling on `execute_command`:
`commandExecutionMs` supplies the default, the ceiling clamps whatever `timeout` the model asks for, and the
tool's schema `maximum` is tightened to match. It does not affect `run_in_terminal`, which has no deadline.
If `toolCallMs` is lower than the ceiling, the gateway deadline fires first, so keep `toolCallMs` at `0` or
at or above the ceiling for the ceiling to matter. Per-tool deadlines for third-party MCP servers are
configured separately with `webcodeGateway.servers.<id>.toolTimeoutMs` (default 60000).

## How do I permanently block a command?

Configure `webcodeGateway.command.denyRules` (string array, empty by default). Each rule and the command line
are lowercased with whitespace collapsed, then matched as a substring; a hit is `blocked`: no approval prompt,
no approval token, and no browser-side "always allow" rule can override it. Because rules are not tokenized and
have no word boundaries, short rules also block unrelated commands (the rule `test` blocks
`git commit -m "test"`), and rules shorter than 4 characters are reported in the gateway log. Nested forms are
covered too (`bash -c 'git push --force'`), but quoting tricks, script bodies and build output can still slip
through: this is a guardrail, not a sandbox. Changing the setting hot-reloads without dropping a connected tab.

## Where are approval decisions recorded?

Every preflight, challenge, approval, rejection and finished command appends one JSON line to
`<globalStorage>/logs/approvals-YYYYMMDD.jsonl` (same directory as `gateway-YYYYMMDD.log`, kept for 7 days).
An entry carries the tool name, risk level, reasons, working directory, shell profile and the **full command
line** (capped at 4096 characters with a `commandTruncated` flag), so "what did the model actually run?" stays
answerable. The file never leaves the machine, but treat it like shell history: avoid putting secrets directly on
a command line (`export TOKEN=...` will be stored in clear text). Tool argument payloads (for example the body of
`write_file`) and approval tokens are never written.
