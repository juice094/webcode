# bridge-browser/src 源码说明

本目录是浏览器扩展的实现主体，运行在 Chromium 111+ 的 MV3 环境中，负责在 AI 网页里捕获工具调用、回填执行结果，并与本地 Gateway 通信。

上级说明：[bridge-browser](../README.md) · 用户文档：[浏览器模式指南](../../doc/getting-started/BROWSER_MODE_GUIDE.md)

## 技术栈

| 项 | 值 |
| --- | --- |
| 语言 | TypeScript |
| 构建 | Vite 5 + `@crxjs/vite-plugin` 2.4.0 |
| 运行环境 | Chrome/Edge MV3（`minimum_chrome_version: 111`） |
| 共享依赖 | `@webcode/shared`（协议常量、SSE 解析、设计令牌） |

## 目录结构

```text
src/
├── background/             service worker
├── content/                页面 content script
├── modules/                可复用模块（UI、审批弹窗、日志、JSON 修复）
├── popup/                  工具栏 popup
├── page/                   MAIN world 网络捕获
├── offscreen/              离屏文档（提示音）
├── styles/                 设计令牌与原语
├── types.ts                扩展内部消息与状态类型
├── approval_mode.ts        审批模式定义
├── approved_rules.ts       已批准规则
└── pairing_protocol.ts     配对协议
```

## 核心文件说明

### `background/`（service worker）

入口为 `background/index.ts`，注册 `onInstalled`、`onStartup`、`tabs.onUpdated`、`tabs.onRemoved`、`tabs.onActivated`、`onMessage`、`alarms.onAlarm` 等监听器。

| 文件 | 职责 |
| --- | --- |
| `messages.ts` | 运行时消息分发中心。 |
| `sessions.ts` / `session_health.ts` / `session_recovery.ts` | 按 tab 维护 `session_<tabId>`，定时探测与自动恢复。 |
| `bridge_redemption.ts` | 消费 `/v1/bridge/redeem`，获取会话令牌。 |
| `init_sync.ts` | 拉取 `/v1/init`，把 prompts 与 `syncedAiSites` 写入 `chrome.storage.local`。 |
| `url_safety.ts` | 判断当前 URL 是否仍在目标站点范围内。 |
| `tab_lifecycle.ts` | 标签页生命周期处理。 |
| `discovery.ts` / `gateway.ts` / `connection.ts` | Gateway 发现与连接管理。 |
| `notifications.ts` / `badge.ts` / `attention_sound.ts` | 通知、图标徽章与提示音。 |
| `approval_mode_settings.ts` / `presets.ts` / `defaults.ts` | 审批模式与默认配置。 |
| `request_deadline.ts` | 浏览器到 Gateway 的请求截止时间。 |

### `content/`（页面脚本）

入口为 `content/main.ts`，是页面内的主控制循环：轮询 DOM、识别工具调用、驱动审批与结果回填。

| 文件 | 职责 |
| --- | --- |
| `tool_executor.ts` / `tool_request_registry.ts` / `tool_call_tracker.ts` | 工具调用执行、请求登记与去重。 |
| `result_delivery_controller.ts` / `follow_up_overlay.ts` / `follow_up_queue.ts` | 结果回填与后续输入浮层。 |
| `auto_init_prompt.ts` / `auto_init_prompt_text.ts` / `init_context.ts` | 初始化提示词生成与自动注入。 |
| `approval_policy.ts` / `approval_mode.ts` / `command_preflight.ts` | 审批策略与命令预检。 |
| `network_capture_runtime.ts` / `network_capture_bridge.ts` / `network_tool_calls.ts` | 网络响应捕获与工具调用重建。 |
| `tool_activity*.ts` / `floating_panel_drag.ts` | 工具活动浮层及其样式、拖拽。 |
| `dom_tool_turn.ts` / `dom_tool_activity.ts` / `virtualized_history_skip.ts` | DOM 扫描与虚拟列表处理。 |
| `disconnect_notice.ts` / `completion_notifier.ts` | 断连提示与完成通知。 |
| `bridge_loader.ts` | `/bridge` 页面加载逻辑。 |

### `modules/`（可复用模块）

| 文件 | 职责 |
| --- | --- |
| `toolCallProtocol.ts` | 工具调用 JSON 的识别与解析入口。 |
| `jsonRepair/*` | 宽松语法修复与候选提取。 |
| `approval_modal*.ts` | `<dialog>` 审批弹窗的标记、视图与交互。 |
| `auto_send.ts` / `auto_send_policy.ts` | 自动发送及其策略。 |
| `result_delivery.ts` / `tool_result.ts` | 结果投递格式。 |
| `logger.ts` / `logger_styles.ts` / `logger_metadata.ts` | 浮动日志。 |
| `ui.ts` / `visual_status.ts` / `overlay_layers.ts` | 通用 UI 与视觉状态。 |
| `page_selectors.ts` / `config.ts` | 站点选择器与站点配置类型。 |
| `i18n.ts` | 扩展侧文案。 |
| `focus_preservation.ts` / `user_attention.ts` | 焦点保持与用户注意提示。 |

### 其他目录

| 目录 | 职责 |
| --- | --- |
| `popup/` | 工具栏 popup：连接状态、审批模式、已批准规则、工作区列表；样式拆分在 `popup_*_styles.ts`。 |
| `page/network_capture.ts` | 以 `MAIN` world 在 `document_start` 包装 `fetch` / `XMLHttpRequest`，只读取副本，不改动原始响应。 |
| `offscreen/audio.ts` | 离屏文档播放提示音。 |
| `styles/` | `tokens.ts` 设计令牌、`primitives.ts` 原语、`shared.ts` 共享样式、`inject.ts` 注入。 |

## 关键约定

- content script 的匹配范围由 `manifest.json` 声明；`page/network_capture.ts` 需要 `MAIN` world 与 Chromium 111+。
- `session_<tabId>` 中的 `siteId` / `targetOrigin` / `targetUrl` 来自 bridge 握手，不依赖 `/v1/init` 是否完成。
- 页面能力在跳转到不安全 URL 时暂停而非删除 session，回到目标站点后自动恢复。
- 设计令牌与 VS Code 侧共享同一数据源，见 `shared/src/designTokens.ts`。

## 测试与构建

```bash
pnpm --filter bridge-browser run build
pnpm --filter bridge-browser run test
```

完整打包流程见[构建指南](../../doc/getting-started/BUILD_GUIDE.md)。
