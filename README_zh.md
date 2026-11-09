<div align="center">
  <img src="doc/assets/webcode-logo-v2.png" width="150" alt="webcode logo" style="border-radius: 20px;">

# webcode

**面向网页 AI 的契约驱动本地工具网关。**

通过受严格执行契约与安全策略约束的 VS Code 扩展，将网页 AI 连接到本地工作区。

[English](./README.md) · [文档](doc/README_zh.md) · [参与贡献](CONTRIBUTING.md) · [获取帮助](SUPPORT.md)

<a href="https://github.com/juice094/webcode/actions/workflows/release.yml"><img alt="release workflow" src="https://img.shields.io/github/actions/workflow/status/juice094/webcode/release.yml?label=release&color=22c55e"></a>
<img alt="browser bridge version" src="https://img.shields.io/github/package-json/v/juice094/webcode?filename=bridge-browser%2Fpackage.json&label=bridge&color=f97316">
<a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-16a34a"></a>
<img alt="VS Code engine" src="https://img.shields.io/badge/VS%20Code-%5E1.106.1-007ACC">
</div>

---

## 项目能力

不同于简单的工具桥接，`webcode` 强制执行严格的执行规则，确保网页 AI 在处理复杂本地任务时保持可预测与安全。

- **契约驱动执行**：严格的流程控制（结果下一轮返回、绝不编造结果、仅批量独立调用），让多轮 Agent 编排更加可靠。
- **安全优先**：分层操作授权（按需询问）与敏感文件保护，确保本地数据安全。
- **可扩展能力**：通过受控桥接，将本地文件、搜索、终端命令、MCP 服务与工作区 Skills 暴露给 AI。

## 快速开始

1. 在 VS Code 扩展商店搜索并安装 `webcode gateway`。
2. 在 VS Code 打开项目文件夹，点击状态栏中的 `webcode: 关闭`，选择“启动 webcode”。
3. 从启动菜单选择目标 AI 站点。默认使用 [Edge 独立保活模式](doc/getting-started/BROWSER_MODE_GUIDE_zh.md)，首次需要在独立浏览器
   profile 中登录。
4. 在新对话中输入任务，并在末尾添加 `/webcode` 或 `@webcode`；确认初始化上下文后，由你手动发送。

当 bridge 显示 `ON` 时连接就绪。如果初始化上下文超出网页输入限制，webcode 会将完整内容作为 TXT 附件添加。

## 从源码运行

需要 Node.js 22 与 pnpm 10.25.0，在仓库根目录依次执行：

```bash
pnpm install
pnpm --filter @webcode/shared run build
pnpm build
```

打包 VSIX 与浏览器扩展见[构建指南](doc/getting-started/BUILD_GUIDE_zh.md)。

## 技术栈

- **VS Code 扩展**：TypeScript、webpack。（`engines.vscode` 为 `^1.106.1`；打包为单文件 `dist/extension.js`）
- **浏览器扩展**：TypeScript、Vite 5、`@crxjs/vite-plugin` 2.4.0。（含 `MAIN` world content script，需要 Chromium 111 或更高版本）
- **共享包**：TypeScript（`tsc`）。（`@webcode/shared`，协议常量与跨包共享类型）
- **运行时依赖**：Express、cors、zod、MCP SDK。（本地 Gateway 与第三方 MCP 接入）
- **工程**：pnpm 10.25.0 workspace、Node.js 22。（三包 monorepo）

## 使用示例

### 轻量演示

通过 DeepSeek 网页版完成“鹈鹕测试”：生成一只骑自行车的鹈鹕 SVG。

- [观看操作演示（1.5 倍速）](https://github.com/user-attachments/assets/448873b4-922a-4cac-b421-70a189394576)
- [查看生成的 SVG](doc/assets/pelican-bicycle-deepseek.svg)

### 生产级场景

在复杂工程任务中，webcode 可作为可靠的本地 Agent 运行时。它可以扫描架构文档、经过分层审批执行跨文件重构，并将操作日志或待决项登记册写回本地仓库。

## 能力与配置

- **内置工具**：文件读写、附件、代码搜索、命令和终端会话。见[内置工具说明](doc/reference/BUILTIN_TOOLS_zh.md)。
- **MCP**：通过 `webcodeGateway.servers` 配置第三方服务。见[MCP 指南](doc/guides/MCP_GUIDE_zh.md)。
- **Skills**：暴露工作区 Skills；扩展也提供开发类内置 Skills。见[Skills 指南](doc/guides/SKILLS_GUIDE_zh.md)。
- **AI 平台**：内置支持 ChatGPT、Gemini、Google AI Studio、DeepSeek、GLM、Claude 和
  Qwen；可配置其他站点。见[站点指南](doc/guides/PLATFORM_GUIDE_zh.md)。
- **项目规则**：初始化时读取根目录 `USER_RULES.md` 及 `AGENTS.md` 或 `CLAUDE.md`；二者并存时优先 `AGENTS.md`。

## 文档

- [文档目录](doc/README_zh.md)：按快速上手、使用指南、参考、架构、计划与报告分层的完整索引。
- [构建指南](doc/getting-started/BUILD_GUIDE_zh.md)：源码构建、打包和本地安装。
- [常见问题](doc/getting-started/FAQ_GUIDE_zh.md)：首次启动、触发词和工具结果回填。
- [贡献指南](CONTRIBUTING.md) · [安全策略](SECURITY.md) · [变更记录](CHANGELOG.md) · [获取帮助](SUPPORT.md)

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

浏览器端到端测试与交互式 QA 见 [Evals 指南](evals/README_zh.md)。

## 项目结构

- `gateway-vscode/`：VS Code 扩展、Gateway、MCP 与本地工具。
- `bridge-browser/`：浏览器扩展与网页桥接。
- `shared/`：跨包共享类型和逻辑。
- `evals/`：端到端场景、Agent 评测和 QA。
- `doc/`：用户、构建和开发文档。

## 参与贡献

欢迎提交 Issue 和 Pull Request。提交前请阅读[贡献指南](CONTRIBUTING.md)。
安全问题请参阅[安全策略](SECURITY.md)；[行为准则](CODE_OF_CONDUCT.md)目前为待维护者确认的草案。

## 来源与说明

本项目独立 fork 自 [three-water666/webcode](https://github.com/three-water666/webcode)
。鉴于原仓库已停止更新且存在功能缺陷，本仓库进行了大量改进、缺陷修复并引入了新功能。本项目与原作者无直接联系或官方授权，我们感谢原作者的开源基础，并严格遵循原开源协议。后续开发、发布与问题反馈均以当前仓库为准。

## 许可证

本仓库采用 [MIT License](LICENSE)，原始版权归 three-water666 所有。感谢 [LINUX DO](https://linux.do/) 社区提供技术交流与开源分享的平台。