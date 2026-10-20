<p align="center">
  <img src="doc/assets/webcode-logo.png" width="150" alt="webcode logo">
</p>

<h1 align="center">webcode</h1>

<p align="center"><strong>让网页 AI 在你的本地项目中工作。</strong></p>

<p align="center">
  通过 VS Code 扩展与浏览器 bridge，将网页 AI 连接到本地工作区，使用文件、搜索、命令、MCP 与 Skills。
</p>

<p align="center">
  <a href="README_en.md">English</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="doc/README.md">文档</a> ·
  <a href="CONTRIBUTING.md">参与贡献</a>
</p>

<p align="center">
  <a href="https://github.com/three-water666/webcode/actions/workflows/release.yml">
    <img alt="release workflow" src="https://img.shields.io/github/actions/workflow/status/three-water666/webcode/release.yml?label=release&color=22c55e">
  </a>
  <img alt="browser bridge version" src="https://img.shields.io/github/package-json/v/three-water666/webcode?filename=bridge-browser%2Fpackage.json&label=bridge&color=f97316">
  <a href="LICENSE">
    <img alt="MIT license" src="https://img.shields.io/badge/license-MIT-16a34a">
  </a>
</p>

<p align="center">
  <img src="doc/assets/webcode-usage-screenshot.png" width="960" alt="webcode 使用界面">
</p>

## 项目能力

- **本地编码工具**：在网页 AI 对话中读取和编辑文件、搜索代码、运行命令；需要时由用户审批。
- **浏览器桥接**：从 VS Code 启动本地 Gateway，并连接支持的网页 AI。
- **可扩展能力**：使用 MCP 接入第三方服务，将工作区 Skills 和项目规则提供给 AI。

## 快速开始

1. 在 VS Code 扩展商店搜索并安装 `webcode gateway`。
2. 在 VS Code 打开项目文件夹，点击状态栏中的 `webcode: 关闭`，选择“启动 webcode”。
3. 从启动菜单选择目标 AI 站点。默认使用 [Edge 独立保活模式](doc/BROWSER_MODE_GUIDE.md)，首次需要在独立浏览器 profile 中登录。
4. 在新对话中输入任务，并在末尾添加 `/webcode` 或 `@webcode`；确认初始化上下文后，由你手动发送。

当 bridge 显示 `ON` 时连接就绪。如果初始化上下文超出网页输入限制，webcode 会将完整内容作为 TXT 附件添加。

## 使用示例

通过 DeepSeek 网页版完成“鹈鹕测试”：生成一只骑自行车的鹈鹕 SVG。

- [观看操作演示（1.5 倍速）](https://github.com/user-attachments/assets/448873b4-922a-4cac-b421-70a189394576)
- [查看生成的 SVG](doc/assets/pelican-bicycle-deepseek.svg)

## 能力与配置

| 能力 | 说明 |
| ------ | ------ |
| 内置工具 | 文件读写、附件、代码搜索、命令和终端会话，见[内置工具说明](doc/BUILTIN_TOOLS.md)。 |
| MCP | 通过 `webcodeGateway.servers` 配置第三方服务，见[MCP 指南](doc/MCP_GUIDE.md)。 |
| Skills | 暴露工作区 Skills；扩展也提供开发类内置 Skills，见[Skills 指南](doc/SKILLS_GUIDE.md)。 |
| AI 平台 | 内置支持 ChatGPT、Gemini、Google AI Studio、DeepSeek、GLM、Claude 和 Qwen；可配置其他站点，见[站点指南](doc/PLATFORM_GUIDE.md)。 |
| 项目规则 | 初始化时读取根目录 `USER_RULES.md` 及 `AGENTS.md` 或 `CLAUDE.md`；二者并存时优先 `AGENTS.md`。 |

## 文档

- [文档目录](doc/README.md)：构建、浏览器模式、MCP、Skills、站点接入和工具说明。
- [构建指南](doc/BUILD_GUIDE.md)：源码构建、打包和本地安装。
- [常见问题](doc/FAQ_GUIDE.md)：首次启动、触发词和工具结果回填。
- [贡献指南](CONTRIBUTING.md) · [安全策略](SECURITY.md) · [变更记录](CHANGELOG.md)

## 开发与测试

需要 Node.js 22 和 pnpm 10.25.0。在仓库根目录运行：

```bash
pnpm install
pnpm --filter @webcode/shared run build
pnpm build
pnpm test
pnpm test:extension
pnpm lint
```

## 项目结构

| 目录 | 内容 |
| ------ | ------ |
| `gateway-vscode/` | VS Code 扩展、Gateway、MCP 与本地工具 |
| `bridge-browser/` | 浏览器扩展与网页桥接 |
| `shared/` | 跨包共享类型和逻辑 |
| `evals/` | 端到端场景、Agent 评测和 QA |
| `doc/` | 用户、构建和开发文档 |

## 参与贡献

欢迎提交 Issue 和 Pull Request。提交前请阅读[贡献指南](CONTRIBUTING.md)。
安全问题请参阅[安全策略](SECURITY.md)；[行为准则](CODE_OF_CONDUCT.md)目前为待维护者确认的草案。

## 许可证

本仓库采用 [MIT License](LICENSE)。感谢 [LINUX DO](https://linux.do/) 社区提供技术交流与开源分享的平台。
