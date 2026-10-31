# gateway-vscode/src 源码说明

本目录是 VS Code 扩展的实现主体：既负责扩展激活、命令与状态栏，也承载本地 Gateway（Express HTTP 服务）与全部内置工具。

上级说明：[gateway-vscode](../README.md) · 用户文档：[文档目录](../../doc/README.md)

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

工具清单与参数语义见[内置工具说明](../../doc/reference/BUILTIN_TOOLS.md)。

### `servers/`（命令安全）

命令相关工具的安全边界集中在此：`commandRisk.ts` 与 `commandRiskTypes.ts` 判定风险等级，`commandPolicy.ts` / `commandPathPolicy.ts` / `sensitivePathPolicy.ts` / `recursiveRemovalPolicy.ts` 定义拒绝与确认条件，`shellCommandParser.ts` / `nestedShellCommand.ts` / `powershellPathPolicy.ts` 负责跨 shell 解析，`processTree.ts` 负责超时后终止进程树。

## 关键约定

- 所有本地工具的 `path` 入参统一使用工作区相对路径与 `/` 分隔符。
- `defaults.ts` 通过 `import ... from '../prompts/*.md'` 引入提示词，`prompts/` 是唯一来源，不可改名或移动。
- Gateway 端口必须落在 `BRIDGE_PORT_RANGE_START`–`BRIDGE_PORT_RANGE_END`（34567–34576）内，否则浏览器桥不会注入。

## 测试

| 目录 | 运行方式 | 内容 |
| --- | --- | --- |
| `unit-test/` | `pnpm test` | Node/Mocha 单测，使用 `vscodeStub.ts` 替代 VS Code API |
| `extension-test/` | `pnpm test:extension` | 真实 Extension Host 测试，夹具在 `extension-test/workspace/` |

构建与完整命令见[构建指南](../../doc/getting-started/BUILD_GUIDE.md)。
