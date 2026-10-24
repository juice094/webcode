# 术语表

本文档记录 webcode 文档中易混术语的标准写法、语域分工与已裁决的落地范围。新增或修改文档时以此为准。

上级索引：[参考索引](index.md) · [文档目录](../README.md)

## 1. 分层原则

术语冲突的根因是三类词被混用。先分层，再定规则：

| 层 | 性质 | 规则 |
| --- | --- | --- |
| **L1 标识符** | 包名、Marketplace 名、配置项、代码枚举、协议字符串 | 不可改。改了会导致功能失效或安装失败 |
| **L2 架构组件名** | `Gateway`、`Bridge`、`Shared` | 英文固定拼写与大小写；中文文档首次出现加注 |
| **L3 中文叙述词** | 网关、浏览器扩展、工作区 | 按语域（面向用户 / 面向开发者）统一 |

## 2. 术语统一表

### 2.1 产品与组件

| 概念 | 标准写法 | 允许变体（语境） | 应避免 |
| --- | --- | --- | --- |
| Marketplace 安装名 | `webcode gateway` | — | `WebCode Gateway`、`webcode Gateway` |
| 本地 HTTP 服务（L2） | `Gateway` | 面向用户文档可写「网关」 | `VS Code 网关`、`VS Code Gateway`、`本地 gateway` |
| 浏览器侧扩展（L2） | `webcode bridge` | 面向开发者文档可写 `bridge` | `WebCode Bridge`、`bridge 插件` |
| 共享包（L2） | `@webcode/shared` | — | `shared 包`、`Shared 模块` |

### 2.2 浏览器侧产物

| 概念 | 标准写法 | 允许变体 | 应避免 |
| --- | --- | --- | --- |
| 浏览器扩展本体 | **浏览器扩展** | 英文 `browser extension` | **`浏览器插件`**（口语化） |
| 桥接机制（非产物） | **浏览器桥接** | 英文 `browser bridge` | `bridge 机制`、`桥` |
| 桥接页面 | `/bridge` 页面 | `bridge 页面` | `桥接页`（单独使用时） |

### 2.3 浏览器模式与配置值

| 概念 | 标准写法 | 允许变体 | 应避免 |
| --- | --- | --- | --- |
| 默认模式（L3 中文） | `Edge 独立保活模式` | — | `Edge独立保活`（缺空格） |
| 默认模式（L1 配置值） | `isolated-edge` | — | `isolatedEdge`、`edge-isolated` |
| 默认模式（英文） | `Edge Isolated Keepalive` | — | `Edge isolated keepalive` |
| 独立模式泛称 | **独立浏览器模式** | `isolated browser mode` | `独立 profile 模式` |

### 2.4 通用技术词

| 概念 | 标准写法 | 允许变体 | 应避免 |
| --- | --- | --- | --- |
| 工作区（L3 中文） | **工作区** | — | `工作空间` |
| 工作区相对路径（叙述） | **工作区相对路径** | 引用代码值时保留 `workspace-relative-path` | **`workspace 相对路径`**（中英混写） |
| 终端会话 | `terminal_session`（工具名） | 叙述用「终端会话」 | `terminal session`（中文句中） |

## 3. 改与不改的边界

| 范围 | 是否落地 | 说明 |
| --- | --- | --- |
| `changelogs/**` | 不改 | 历史记录，改动会歪曲当时表述 |
| `doc/archive/**` | 不改 | 归档语义即「保留当时状态」 |
| `.codex/skills/**`、`gateway-vscode/prompts/**`、`evals/scenarios/**` | 不改 | 治理豁免目录 |
| 活跃文档中的新写/重写段落 | 按本表统一 | — |
| 活跃文档中的存量段落 | 仅修本表第 4 节已裁决项 | — |

## 4. 裁决记录

| # | 裁决项 | 结论 | 落地范围 |
| --- | --- | --- | --- |
| T1 | `浏览器插件` 是否批量改为 `浏览器扩展` | 改 | 活跃文档 20 处；`changelogs/` 与 `doc/archive/` 保留 |
| T2 | 「网关」与 `Gateway` 的语域分工 | 面向用户文档用「网关」，开发者文档用 `Gateway`，首次出现加注 | `FAQ_GUIDE` 保留「网关」；`reference/` 改 `Gateway`；`BROWSER_MODE_GUIDE` 首次出现加注 |
| T3 | `workspace 相对路径` 是否批量改为 `工作区相对路径` | 改 | `reference/` 四篇共 17 处 |
| — | 同类文档章节顺序是否统一 | 不统一，登记为遗留 | `getting-started/` 四篇分属模式说明、Q&A、构建流程、安装约定四种体例 |
| — | `doc/getting-started/MANUAL_BRIDGE_GUIDE.md` 标题是否改「桥接」为「扩展」 | 保留「浏览器桥接」 | 该文档强调的是桥接机制，不是扩展产物 |

## 5. 已知待办

| # | 项 | 说明 |
| --- | --- | --- |
| 1 | `gateway-vscode/package.json` 的 `publisher` | 仍为 `three-water666`，与扩展标识绑定，发版前需单独评估 |
| 2 | `shared/src/branding.json` 的 `vscodeConnectUri` | 含 publisher ID，不能因仓库改名而修改 |
| 3 | changelog 版本缺口 | v0.1.6 / v0.3.1 / v0.4.2 / v0.4.3 是否存在未确认 |
