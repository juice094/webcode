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
