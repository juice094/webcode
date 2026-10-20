<p align="center">
  <img src="doc/assets/webcode-logo.png" width="220" alt="webcode logo">
</p>

<h1 align="center">webcode</h1>

<p align="center">
  <strong>为网页 AI 提供本地编码能力。</strong>
</p>

<p align="center">
  通过 VS Code 插件与浏览器插件，打破网页 AI 与本地项目之间的边界，使 ChatGPT、Gemini、DeepSeek 等网页 AI 连接到本地 VS Code，获得读写文件、运行命令的能力，还支持 MCP 和 Skills。
</p>

<p align="center">
  中文 | <a href="README_en.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/three-water666/webcode/actions/workflows/release.yml">
    <img alt="release workflow" src="https://img.shields.io/github/actions/workflow/status/three-water666/webcode/release.yml?label=release&color=22c55e">
  </a>
  <img alt="browser bridge version" src="https://img.shields.io/github/package-json/v/three-water666/webcode?filename=bridge-browser%2Fpackage.json&label=bridge&color=f97316">
  <a href="LICENSE">
    <img alt="license MIT" src="https://img.shields.io/badge/license-MIT-16a34a">
  </a>
</p>

---

<p align="center">
  <img src="doc/assets/webcode-usage-screenshot.png" width="960" alt="webcode 使用截图">
</p>

## 项目能力

- 在网页 AI 对话中调用本地文件、搜索和命令工具，并在需要时请求用户审批。
- 通过 VS Code 扩展和浏览器 bridge 建立本地 Gateway 连接。
- 接入第三方 MCP server，并向网页 AI 提供工作区 Skills。
- 支持多个内置 AI 站点，也可通过 VS Code 设置添加或覆盖站点。

## 文档导航

| 主题 | 文档 |
| ------ | ------ |
| 构建、开发和功能指南 | [文档目录](doc/README.md) |
| 浏览器模式 | [浏览器模式指南](doc/BROWSER_MODE_GUIDE.md) |
| 内置工具 | [内置工具说明](doc/BUILTIN_TOOLS.md) |
| MCP 配置 | [MCP 服务配置指南](doc/MCP_GUIDE.md) |
| 站点扩展 | [站点支持指南](doc/PLATFORM_GUIDE.md) |
| 常见问题 | [FAQ](doc/FAQ_GUIDE.md) |
| 开发与贡献 | [贡献指南](CONTRIBUTING.md) |

语言版本：[English](README_en.md)。

## 使用示例

### DeepSeek 网页版：鹈鹕测试

下面是本次录屏演示中通过 webcode 连接 DeepSeek 网页版生成的 SVG，任务是绘制一只骑自行车的鹈鹕，也称为“鹈鹕测试”。

提示词：

> Generate an SVG of a pelican riding a bicycle.

**操作演示（1.5 倍速）**

https://github.com/user-attachments/assets/448873b4-922a-4cac-b421-70a189394576

**生成结果**

<p align="center">
  <img src="doc/assets/pelican-bicycle-deepseek.svg" width="560" alt="通过 webcode 和 DeepSeek 网页版生成的 SVG：一只骑自行车的鹈鹕">
</p>

[查看 SVG 源文件](doc/assets/pelican-bicycle-deepseek.svg)

## 安装与快速开始

### 1. 安装 VS Code 扩展

1. 打开 VS Code 扩展商店。
2. 搜索 `webcode gateway`。
3. 安装扩展。

### 2. 启动 Gateway

1. 在 VS Code 中打开一个具体文件夹或工作区。
2. 点击 VS Code 右下角状态栏里的 `webcode: 关闭`。

   ![VS Code 状态栏中的 webcode 关闭按钮](doc/assets/webcode-status-bar-off.png)

3. 在弹出的菜单里点击 `启动 webcode`。
4. 等待状态栏文字变成 `webcode: <端口>`。

当状态栏显示端口号时，说明本地 Gateway 已经启动。

### 3. 打开目标网页 AI

1. 在启动菜单里选择目标站点，例如 `Open ChatGPT` 或其他支持的入口。
2. webcode 默认会用 [`Edge 独立保活模式`](doc/BROWSER_MODE_GUIDE.md) 打开 Microsoft Edge。
3. 独立 Edge profile 会自动加载内置的 webcode bridge。
4. 桥接页会自动与本地 Gateway 完成握手。
5. 握手成功后，浏览器会自动跳转到对应的 AI 站点。

首次使用时，需要在这个独立 Edge profile 中登录一次目标 AI 站点。当 bridge 显示 `ON` 时，表示连接已经可以使用。

### 4. 在对话中使用

1. 打开目标 AI 站点中的新对话。
2. 先输入你的实际需求，再在同一条消息末尾添加 `/webcode` 或 `@webcode`，或者直接回车。
3. 当 webcode 询问是否添加初始化上下文时，点击 `添加` 或按 Enter。
4. webcode 会把触发词替换为完整初始化上下文。确认消息内容后，由你手动发送。

如果初始化上下文超过当前 AI 站点的输入框限制，webcode 会优先把完整上下文作为 txt 附件添加到消息中，并在输入框里保留一段简短说明。

例如：

- `读取 src/utils.ts，然后为它补一个单元测试。 /webcode`
- `列出当前工作区的文件结构。 @webcode`
- `把项目文档生成到 docs 目录里。 /webcode`

## 内置工具

webcode 内置 `read_file`、`attach_file`、`write_file`、`edit_file`、`search_files`、`search_code`、`execute_command`、`run_in_terminal`、`terminal_session` 等本地工具，用于文本读取、TXT/图片/PDF 附件投递、文件写入、代码搜索、命令执行和终端会话管理。

具体工具清单见 [内置工具说明](doc/BUILTIN_TOOLS.md)。

## MCP

需要接入浏览器自动化、GitHub、数据库或其他外部能力时，可以通过 `webcodeGateway.servers` 配置第三方 MCP server。

具体配置方式见 [MCP 服务配置指南](doc/MCP_GUIDE.md)。

## Skills

webcode 可以把当前 VS Code 工作区中的本地 Skills 暴露给网页 AI，让模型按需读取项目工作流、模板、领域说明或脚本资源。

具体使用方式见 [Skills 使用指南](doc/SKILLS_GUIDE.md)。

## 项目规则

初始化时，webcode 会从 VS Code 当前打开的主工作区根目录读取项目规则文件，并随初始化结果发送给网页 AI：

- `USER_RULES.md`
- `AGENTS.md` 或 `CLAUDE.md`

如果 `AGENTS.md` 和 `CLAUDE.md` 同时存在，只发送 `AGENTS.md`。浏览器扩展不再提供单独的个性化指令设置页。

## 配置

VS Code 设置使用 `webcodeGateway.*` 命名空间。站点配置见[站点支持指南](doc/PLATFORM_GUIDE.md)，MCP server 配置见[MCP 指南](doc/MCP_GUIDE.md)，浏览器选择见[浏览器模式指南](doc/BROWSER_MODE_GUIDE.md)。

## 目前已内置支持的 AI 平台及其他平台支持

webcode 目前已内置支持以下 AI 平台：

- ChatGPT
- Gemini
- Google AI Studio
- DeepSeek
- GLM
- Claude
- Qwen

如需支持其他平台，可以通过 VS Code 配置快速接入新的站点。稳定平台可以加入内置站点列表，实验或私有站点通常只需要配置 `webcodeGateway.aiSites`。

具体步骤见 [站点支持扩展指南](doc/PLATFORM_GUIDE.md)。

## 从源码构建

源码下载、依赖安装、打包脚本、产物说明和本地安装方式见 [构建指南](doc/BUILD_GUIDE.md)。

## 常见问题

首次启动环境、触发词无反应、工具调用执行后页面没有变化、查看历史工具调用等问题见 [常见问题](doc/FAQ_GUIDE.md)。

## 项目结构

- `gateway-vscode/`：VS Code 扩展、Gateway、MCP 和本地工具。
- `bridge-browser/`：浏览器扩展及页面桥接逻辑。
- `shared/`：跨包共享类型和逻辑。
- `evals/`：单元评测、端到端场景和 QA 脚本。
- `doc/`：使用、构建和开发指南。

## 开发与测试

需要 Node.js 22 和 pnpm 10.25.0。克隆仓库后，在根目录运行：

```bash
pnpm install
pnpm --filter @webcode/shared run build
pnpm build
pnpm test
pnpm test:extension
pnpm lint
```

各命令的范围及浏览器端到端测试说明见[构建指南](doc/BUILD_GUIDE.md)和[文档目录](doc/README.md)。

## 参与贡献

欢迎提交 Issue 和 Pull Request。提交前请阅读[贡献指南](CONTRIBUTING.md)；安全问题请参阅[安全策略](SECURITY.md)。行为准则目前仍待维护者确认，见[行为准则草案](CODE_OF_CONDUCT.md)。

## 致谢

感谢 [LINUX DO](https://linux.do/) 社区提供技术交流与开源分享的平台。

## 许可证

本仓库采用 MIT License，详见 [LICENSE](LICENSE)。
