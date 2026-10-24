# shared/src 源码说明

`@webcode/shared` 是跨包共享层，被 VS Code 扩展与浏览器扩展同时引用。它只放**两端都需要**的协议常量、类型和纯函数，不放任何依赖 VS Code 或 Chrome API 的代码。

上级说明：[shared](../package.json)

## 文件说明

| 文件 | 职责 |
| --- | --- |
| `index.ts` | 对外导出：`BRANDING`、`PROTOCOL`、版本比较、端口范围、引导工具名单、传输类型。 |
| `branding.json` | 产品名、slug、`repositoryUrl`、`vscodeConnectUri`。 |
| `bridgeProtocol.json` | 桥接协议版本与最低版本约束。 |
| `chatgptStream.ts` | ChatGPT EventStream 增量解析。 |
| `deepseekStream.ts` | DeepSeek SSE 增量解析。 |
| `sse.ts` | 通用 Server-Sent Events 解析。 |
| `networkCapture.ts` | 网络捕获配置与事件类型。 |
| `designTokens.ts` | 跨端共享的设计令牌。 |

## `index.ts` 主要导出

| 导出 | 说明 |
| --- | --- |
| `BRANDING` | 由 `branding.json` 派生的产品名、设置名、日志前缀、`/webcode` 与 `@webcode` 触发词、仓库地址等。 |
| `PROTOCOL` | 初始化工具名、鉴权请求头名、网络捕获消息名等运行时协议字符串。 |
| `BRIDGE_PROTOCOL_VERSION` | 取自 `bridgeProtocol.json` 的 `version`。 |
| `BRIDGE_MIN_EXTENSION_VERSION` / `BRIDGE_MIN_GATEWAY_VERSION` | 可选的最低版本约束；缺省时退化为严格等值匹配。 |
| `compareExtensionVersions` | 点分数字版本比较，非法格式返回 0。 |
| `BRIDGE_PORT_RANGE_START` / `BRIDGE_PORT_RANGE_END` | 34567–34576；Gateway 必须落在此区间，否则浏览器桥不注入。 |
| `BOOTSTRAP_ONLY_TOOL_NAMES` | `get_project_rules`、`get_project_context`、`list_tools`、`list_skills`。 |
| `PLATFORM_PROMPT_KEY_PREFIX` / `getPlatformPromptStorageKey` | 平台提示词在浏览器存储中的键。 |
| `Session` / `ToolExecutionPayload` / `McpResponse` | 跨端传输类型。 |

## 关键约定

- `branding.json` 的 `vscodeConnectUri` 含 publisher ID（`three-water666`），与扩展标识绑定，**不能因仓库改名而修改**；`repositoryUrl` 用于生成 release 下载链接，指向当前仓库。
- `PROTOCOL` 中的字符串由 `branding.json` 的 `slug` 派生，改动 `slug` 会同时改变工具名、请求头名与触发词。
- 本包不引入运行时依赖，构建仅执行 `tsc`。

## 构建

```bash
pnpm --filter @webcode/shared run build
```
