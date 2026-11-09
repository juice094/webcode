# gateway-vscode/src 源码说明

本目录是 VS Code 扩展的实现主体：既负责扩展激活、命令与状态栏，也承载本地 Gateway（Express HTTP 服务）与全部内置工具。

上级说明：[gateway-vscode](../README.md) · 用户文档：[文档目录](../../doc/README_zh.md)

## 技术栈

| 项 | 值 |
| --- | --- |
| 语言 | TypeScript |
| 运行时 | VS Code Extension Host（Node.js） |
| HTTP | Express + cors |
| 协议校验 | zod（`schemaValidation.ts`） |
| 打包 | webpack，产物为单文件 `dist/extension.js` |

## 目录结构

```text
src/
├── extension.ts            扩展激活入口
├── gateway.ts              Gateway 装配与路由挂载
├── platforms.ts            内置 AI 站点定义
├── defaults.ts             运行时提示词 md 的导入与默认值
├── builtinSkills.ts        内置 Skill 装载
├── skillManager.ts         工作区 Skill 发现
├── terminalSessionManager.ts  终端会话生命周期
├── schemaValidation.ts     zod schema 校验
├── i18n.ts                 扩展侧文案
├── extension/              VS Code 宿主侧适配
├── gateway/                HTTP 服务、会话、审批与并发控制
├── host/                   宿主抽象层（接口 + VS Code 实现）
├── servers/                命令风险策略与 shell 解析
├── tools/                  本地工具实现
├── unit-test/              Node/Mocha 单测
└── extension-test/         Extension Host 测试与夹具
```

## 核心文件说明

### 入口

| 文件 | 职责 |
| --- | --- |
| `extension.ts` | 导出 `activate` / `deactivate`。激活期装配状态栏、注册配对确认处理器、按 `webcodeGateway.autoStart` 决定是否自动启动 Gateway；不自动打开浏览器。 |
| `gateway.ts` | 导出 `GatewayManager`。创建 Express 实例、挂载中间件与路由、管理端口监听、连接第三方 MCP server、持有 `BridgeSessionManager` / `CommandApprovalManager` / 工具并发闸门。 |

### `gateway/`（HTTP 服务层）

| 文件 | 职责 |
| --- | --- |
| `bridgeRoute.ts` | `/bridge` 页面与连接码兑换；`resolveAllowedBridgeTarget` 校验目标站点归属。 |
| `bridgeSession.ts` | 一次性 bridge code 的签发与原子消费，`DEFAULT_BRIDGE_CODE_TTL_MS` 定义有效期。 |
| `pairingRoutes.ts` | 会话配对请求与用户确认流程。 |
| `initRoutes.ts` | `/v1/init` 下发 prompts 与 `syncedAiSites`。 |
| `toolRoutes.ts` / `toolCallRoute.ts` | 工具调用路由与执行编排。 |
| `toolDefinitions.ts` | 合并本地工具与远程 MCP 工具的定义。 |
| `toolConcurrency.ts` | `ToolConcurrencyGate`，默认并发上限 `DEFAULT_MAX_CONCURRENT_TOOL_CALLS`。 |
| `toolCallDeadline.ts` / `timeouts.ts` | 调用截止时间与全部超时配置。 |
| `commandApproval.ts` | 命令审批挑战、单次令牌与惰性过期。 |
| `approvalAudit.ts` / `approvalAuditEvents.ts` | 审批审计事件写入。 |
| `rateLimit.ts` | 按来源限流，窗口原地压缩。 |
| `inFlightCalls.ts` | 在途调用登记，供关机快照使用。 |
| `middleware.ts` | 鉴权、CORS、活动追踪、关机守卫等 Express 中间件工厂。 |
| `buildInfo.ts` | 读取 `bridge-build.json` 并生成构建指纹。 |
| `syncedSites.ts` / `pathArguments.ts` / `remoteTools.ts` | 站点同步、路径参数策略、远程工具接入。 |

### `extension/`（VS Code 宿主侧）

| 文件 | 职责 |
| --- | --- |
| `serviceController.ts` | Gateway 启动/停止/重启的单一入口。 |
| `statusBar.ts` | 状态栏项渲染与状态切换。 |
| `connectCommand.ts` / `uriHandler.ts` | 连接命令与 `vscode://` 深链接处理。 |
| `browserLauncher.ts` / `browserProcessLauncher.ts` / `browserProcessList.ts` | 浏览器启动与进程探测。 |
| `isolatedBrowserProfiles.ts` / `isolatedProfileLaunch.ts` | 独立 profile 的路径解析与启动。 |
| `browserExtensionManager.ts` / `browserExtensionInstall.ts` / `browserExtensionLock.ts` | 内置 bridge 的安装、版本比对与并发锁。 |
| `persistentLog.ts` / `approvalAuditLog.ts` | 持久化日志与审批审计落盘。 |
| `sessionToken.ts` | 按工作区持久化会话令牌（SecretStorage）。 |
| `shutdownSnapshot.ts` / `deactivateSession.ts` | 关机快照与被中断调用的恢复提示。 |
| `skillWatchers.ts` / `configurationWatcher.ts` | Skill 目录与配置变更监听。 |
| `customServers.ts` / `gatewayConfigurationPolicy.ts` | 第三方 server 配置与配置策略校验。 |
| `commandDenyRules.ts` / `commandAllowedRoots.ts` / `commandAllowRules.ts` | 命令拒绝规则、允许根目录与审批豁免规则。 |

### `tools/`（本地工具实现）

`tools/index.ts` 中的 `LOCAL_TOOLS` 是唯一的工具注册表，注册 13 个工具：`list_tools`、`get_project_rules`、`get_project_context`、`attach_file`、`read_file`、`write_file`、`edit_file`、`search_files`、`search_code`、`execute_command`、`run_in_terminal`、`terminal_session`、`list_skills`。

每个工具一个文件，共享 `types.ts` 的 `LocalTool` / `ToolResult` 契约。搜索类工具按职责拆分：`searchCodeRipgrepArgs.ts`、`searchCodeRipgrepOutput.ts`、`searchCodeFallback.ts`、`searchCodeGitFiles.ts` 等。

工具清单与参数语义见[内置工具说明](../../doc/reference/BUILTIN_TOOLS_zh.md)。

### `servers/`（命令安全）

命令相关工具的安全边界集中在此：`commandRisk.ts` 与 `commandRiskTypes.ts` 判定风险等级，`commandPolicy.ts` / `commandPathPolicy.ts` / `sensitivePathPolicy.ts` / `recursiveRemovalPolicy.ts` 定义拒绝与确认条件，`shellCommandParser.ts` / `nestedShellCommand.ts` / `powershellPathPolicy.ts` 负责跨 shell 解析，`processTree.ts` 负责超时后终止进程树。

### `host/`（宿主抽象，路线 A · A0）

`host/types.ts` 定义 6 个宿主能力接口，网关核心（`gateway.ts`、`gateway/`、`tools/`、`skillManager.ts`、`terminalSessionManager.ts`）经它们访问宿主能力，不再直接 `import 'vscode'`。`host/vscodeHost.ts` 是 VS Code 实现，全部是现有调用的原样平移。A0 为零行为变化的纯内部重构；每个接口的方法注释都写明当前语义与调用方。

| 接口 | 一句话语义 |
| --- | --- |
| `WorkspaceProvider` | 工作区根目录：路径列表、首根、带 display name 的文件夹视图（SkillManager 排序用）。 |
| `ConfigStore` | 节绑定配置的 get/update（默认 webcodeGateway 节）；schema 默认值只在 package.json contributes.configuration，代码侧回退在调用方。 |
| `Logger` | info/warn/error 按原样写一行（格式化留在调用方）；VS Code 实现 = 转发给现有 OutputChannel。 |
| `SessionStore` | 每工作区的会话表读写 + 旧版 SecretStorage token 一次性迁移源 + `mcp.lastPort` 端口记忆。 |
| `PairingUI` | 配对确认模态框、信息/错误通知、瞬态状态栏消息（原弹窗/状态栏代码平移）。 |
| `TerminalHost` | 只收「创建终端」入口（本期 = `vscode.window.createTerminal` 直通）；会话内部逻辑不抽象。 |

注入方式：`extension.ts` 用 `createVscodeHost(context, outputChannel)` 装配，经 `GatewayManagerHooks.host` 传给 `GatewayManager`；`serviceController` 等宿主侧模块直接收具体接口。未注入时 `createDefaultGatewayHostServices()` 提供惰性默认（空工作区、配置回退默认值、拒绝配对、无终端），精确复刻 A0 之前单测桩的行为。

**下一期 headless/DSH 实现要填什么**：实现同一组接口并替换装配——`WorkspaceProvider`（DSH 会话的工作目录）、`ConfigStore`（读 cordis 补丁层/配置文件，update 本期无调用方）、`Logger`（写文件或 stderr）、`SessionStore`（JSON 文件或 SQLite 表，保留 key 形状 `webcode.bridgeSessions.<id>` / `mcp.lastPort` 以便与 VS Code 版互迁）、`PairingUI`（headless 下确认策略：拒绝/日志记录/外部审批）、`TerminalHost`（把返回类型从 `vscode.Terminal` 换成结构化 `HostTerminal` 并抽象 shell integration 事件，见遗留清单）。

**遗留（A0 有意不收的 vscode 触点）**：

- `terminalSessionManager.ts` 的 shell integration 事件订阅（`onDidChangeTerminalShellIntegration` / `onDidEndTerminalShellExecution` / `onDidCloseTerminal`）与 Terminal 类型：按交付项 3 本期只收 createTerminal 入口，随 TerminalHost 结构化一起抽象。
- `servers/terminalProfiles.ts` 的 `terminal.integrated.*` 配置与 `vscode.env.shell`：属于终端宿主配置，下一期随 TerminalHost 收编。
- `i18n.ts` 的 `vscode.env.language`：纯文案模块且全部消费方都在 extension/ 宿主层，headless 期直接替换为固定 locale 或注入。
- `extension/skillWatchers.ts` 的 `getConfiguration`/`RelativePattern`/文件监听、`extension/connectCommand.ts` 的 `getConfiguration`：宿主侧适配层内的直接使用，不属于网关核心。
- `extension.ts`、`statusBar.ts` 及其余 `extension/` 模块本来就是 VS Code 适配层，保持直调 vscode API。

## 关键约定

- 所有本地工具的 `path` 入参统一使用工作区相对路径与 `/` 分隔符。
- `defaults.ts` 通过 `import ... from '../prompts/*.md'` 引入提示词，`prompts/` 是唯一来源，不可改名或移动。
- Gateway 端口必须落在 `BRIDGE_PORT_RANGE_START`–`BRIDGE_PORT_RANGE_END`（34567–34576）内，否则浏览器桥不会注入。

## 测试

| 目录 | 运行方式 | 内容 |
| --- | --- | --- |
| `unit-test/` | `pnpm test` | Node/Mocha 单测，使用 `vscodeStub.ts` 替代 VS Code API |
| `extension-test/` | `pnpm test:extension` | 真实 Extension Host 测试，夹具在 `extension-test/workspace/` |

构建与完整命令见[构建指南](../../doc/getting-started/BUILD_GUIDE_zh.md)。
