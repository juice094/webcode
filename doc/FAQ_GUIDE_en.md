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
| `timeouts.toolCallMs` | 0 | Gateway-side deadline for one tool call; `0` means no deadline |
| `timeouts.bridgeCodeTtlSeconds` | 120 | Lifetime of a single-use launch code (seconds) |
| `timeouts.approvalTtlSeconds` | 120 | Lifetime of a command approval challenge and token (seconds) |
| `timeouts.browserLaunchWaitMs` | 10000 | How long to wait for an isolated browser to expose its bridge process |
| `timeouts.bridgeRequestMs` | 0 | Browser-to-gateway request deadline; `0` means no deadline |

The `0` = no-deadline meaning applies only to `toolCallMs` and `bridgeRequestMs`; the other settings
have their own minimums. Per-tool deadlines for third-party MCP servers are configured separately with
`webcodeGateway.servers.<id>.toolTimeoutMs` (default 60000).
