# webcode 常见问题

语言：中文 | [English](FAQ_GUIDE_en.md)

## 首次启动前需要准备什么？

请确认以下环境，能减少首次启动失败：

- 安装 [VS Code](https://code.visualstudio.com/) 1.106.1 或更新版本。
- 在 VS Code 中打开一个本地项目文件夹或工作区，不要只打开单个文件。
- 默认浏览器模式是 Edge 独立保活模式，不需要手动安装浏览器插件；Windows 通常自带 Edge，macOS 需要先安装 [Microsoft Edge](https://www.microsoft.com/edge/download)。
- Windows 上 `execute_command` 的默认 POSIX 模式需要 Git Bash；如果 Git Bash 在自定义路径，可以把 `webcodeGateway.commandShell.path` 指向 `bash.exe`。也可以显式选择检测到的 `pwsh` 或 `powershell` profile 执行 PowerShell 命令。
- 准备好目标网页 AI 账号，并确认当前网络能访问对应站点。首次打开独立 Edge profile 时需要登录一次。

## 网页输出 `@webcode` 或 `/webcode` 没反应怎么办？

可以先确认触发词前面有空格，例如：

```text
读取当前项目结构。 /webcode
```

如果网页仍然没有触发，可以刷新当前网页，确认浏览器插件 popup 显示已连接，然后重新输入触发词。新对话的第一条消息即使忘记写触发词，在点击发送或按 Enter 时也会弹出初始化确认。

## AI 返回了工具调用，工具也显示执行成功，但页面没反应怎么办？

可以刷新当前网页。刷新后，webcode 会重新扫描页面里的工具调用，并重新执行需要处理的工具结果回填流程。

## 使用 isolated Edge 打开 AI 页面时多出一个新标签页怎么办？

部分 Microsoft Edge 版本会根据 isolated profile 的新标签页设置额外打开一个新标签页。可以在 webcode 打开的 isolated Edge 窗口中访问 `edge://settings/startHomeNTP`，在“启动、主页和新建选项卡页”里关闭“预加载新选项卡页”。

如果仍然出现额外新标签页，可以检查“启动时”是否选中了“打开新标签页”，尝试改为“打开上一个会话中的标签页”。修改后请完全关闭所有 Edge 进程，再从 VS Code 重新打开 AI 页面。

## 想看历史上 AI 调用了哪些工具怎么办？

点击浏览器插件 popup，开启日志。日志里的“摘要”一栏会记录每次工具调用，方便回看 AI 调用了哪些工具以及调用顺序。

## 网关日志保存在哪里？连接断开后如何排查？

网关日志现在会同步落盘，方便窗口关闭或异常退出后复盘：

- VS Code 输出面板：命令面板 → `Output: Show Output Channels...` → 选择 `MCP Gateway`（实时查看）。
- 持久化日志文件：`globalStorage/three-water666.gateway-vscode/logs/gateway-YYYYMMDD.log`
  （Windows 路径为 `%APPDATA%\Code\User\globalStorage\three-water666.gateway-vscode\logs\`），
  按天滚动，默认保留最近 7 天。启动、停止、空闲自动关停、启动失败以及扩展宿主未捕获异常都会记录。

连接断开时的排查顺序：

1. 浏览器悬浮日志/系统通知会提示断连原因（网关可能因 30 分钟无活动自动关停，
   可通过 `webcodeGateway.idleTimeoutMinutes` 调整，最长 240 分钟）。
2. 在 VS Code 状态栏点击 webcode 重启服务，然后从 VS Code 重新发起连接
   （连接码为一次性短时凭证，旧链接报错“链接无效”属正常现象）。
3. 仍无法连接时，查看上述持久化日志文件中的 `ERROR`/`WARN` 条目。

## 升级到 1.3.0 后为什么要重启浏览器、还要重新配对一次？

这是两件不同的事：

1. **重启浏览器**：新版本的浏览器桥会先被“暂存”。如果隔离浏览器正在运行，下次点连接时
   VS Code 会提示“需要重启浏览器”，确认后浏览器被关闭并重新拉起，新桥才真正生效。
   手动安装（`chrome://extensions` → 加载已解压）的用户请先执行 `pnpm bridge:sync`，
   再点桥接卡片上的刷新按钮。
2. **重新配对**：连接令牌保存在网关进程的内存里，扩展升级或窗口重载会清空它，
   所以浏览器需要从 VS Code 状态栏重新发起一次连接。自动重连在后续版本解决。

为什么必须同步升级两侧：浏览器侧握手要求“VS Code 扩展版本 === 浏览器扩展版本”
（严格等值）。只升一侧会直接被拒绝连接，提示版本不一致。

想确认当前跑的是哪份构建：命令面板 → `Output: Show Output Channels...` → `MCP Gateway`，
开头第一行就是 `build: version=… buildHash=… builtAt=…`，与安装包里的
`browser-extension/bridge-build.json` 一致即可。

## 长任务或命令跑很久怎么办？

`execute_command` 有截止时间，超时只会停掉 shell 本体，脚本派生的子进程可能仍在运行。构建、测试、
长时间运行的开发服务器这类任务请改用 `run_in_terminal`，它会打开真实终端并立即返回 `session_id`，
之后用 `terminal_session` 的 `read` / `stop` / `close` 读取输出或中断。

## 各类超时怎么调？

全部集中在 VS Code 设置 `webcodeGateway.timeouts`（毫秒，除注明秒的项目），改完会自动重启网关：

| 设置项 | 默认 | 作用 |
|:---|:---|:---|
| `timeouts.commandExecutionMs` | 60000 | `execute_command` 的默认截止时间 |
| `timeouts.toolCallMs` | 0 | 网关侧单次工具调用的截止时间，`0` 表示不限 |
| `timeouts.bridgeCodeTtlSeconds` | 120 | 一次性连接码的有效期（秒） |
| `timeouts.approvalTtlSeconds` | 120 | 命令审批挑战与令牌的有效期（秒） |
| `timeouts.browserLaunchWaitMs` | 10000 | 等待独立浏览器暴露桥进程的时间 |
| `timeouts.bridgeRequestMs` | 0 | 浏览器→网关请求的截止时间，`0` 表示不限 |

`0` 表示不限的语义只对 `toolCallMs` 与 `bridgeRequestMs` 有效，其余项有各自的最小值。
第三方 MCP server 的单个工具截止时间另由 `webcodeGateway.servers.<id>.toolTimeoutMs`（默认 60000）控制。
