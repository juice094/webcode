# webcode

## Overview
- 语言 / 运行时：TypeScript、Node.js 22；包管理器为 pnpm 10.25.0。
- 框架：VS Code Extension API、Express、MCP SDK；浏览器桥接使用 Vite 和 Chrome Extension API。
- 目的：通过 VS Code 扩展和浏览器桥接，让网页 AI 在本地工作区使用编码工具。

## Common Commands

| 任务 | 命令 |
|------|------|
| 安装依赖 | `pnpm install` |
| 构建全部包 | `pnpm build` |
| 单元测试 | `pnpm test` |
| VS Code 扩展宿主测试 | `pnpm test:extension` |
| 全仓 lint | `pnpm lint` |
| 启动扩展开发监听 | `pnpm --filter gateway-vscode run watch` |
| 准备浏览器扩展 | `pnpm --filter gateway-vscode run prepare-browser-extension` |
| 打包 VS Code 扩展 | `pnpm --filter gateway-vscode run package` |
| 最小端到端测试 | `pnpm test:e2e:minimal` |

VS Code 开发调试可运行 `gateway-vscode: debug-prelaunch`，它会先准备浏览器扩展，再启动扩展监听。

## Architecture
- 入口：VS Code 扩展从 `gateway-vscode/src/extension.ts` 激活；打包入口为 `gateway-vscode/dist/extension.js`。
- `gateway-vscode/src/`：Gateway、MCP 服务、工具、平台适配、浏览器启动和 VS Code 集成。
- `bridge-browser/src/`：浏览器扩展及网页 AI 与本地 Gateway 之间的桥接。
- `shared/src/`：跨包共享类型与逻辑；通过 `@webcode/shared` 公共入口导入。
- `evals/`：单元、端到端、场景评测和交互式 QA 脚本。
- `doc/` 与根目录 `README.md`：面向用户的使用和构建文档；改动功能后同步更新相关文档。
- Workspace 包由根目录 `pnpm-workspace.yaml` 管理；禁止跨包使用相对路径导入。

## Conventions
- TypeScript 使用严格类型检查和 ESLint；遵循现有文件格式、命名与错误处理方式，不使用 `any`。
- 测试与被测模块放在相应包内；修改 VS Code 集成行为时，按影响范围运行扩展宿主测试。
- 跨包代码只从 `@webcode/shared` 导出的公共入口导入，不引用其内部路径。
- 提交使用简洁的 Conventional Commit 标题；较大改动添加以 `- ` 开头的正文，遵循 `AGENTS.md`。
- 浏览器交互式 QA 仅在用户明确授权后运行；必须使用 `qa:start` 创建的隔离工作区和配置。
