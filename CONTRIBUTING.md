# 贡献指南

感谢你愿意为 webcode 提交问题或改进。提交前请先搜索已有 Issue 和 Pull Request，避免重复工作。

## 开发环境

- Node.js 22
- pnpm 10.25.0
- VS Code 1.106.1 或更新版本（运行扩展宿主测试时需要）

在仓库根目录安装依赖并构建共享包：

```bash
pnpm install
pnpm --filter @webcode/shared run build
```

## 提交前检查

```bash
pnpm build
pnpm test
pnpm test:extension
pnpm lint
```

浏览器端到端测试和交互式 QA 需要额外的浏览器环境，运行方式见 [Evals 指南](evals/README.md)。只有在受影响的流程需要时再执行；交互式 QA 必须使用 `qa:start` 创建的隔离工作区。

## Pull Request

- 说明问题背景、预期行为和实际改动；涉及 UI 或用户流程时附上复现步骤或截图。
- 为行为变化补充或更新测试，并同步维护相关的中英文用户文档。
- 不提交密钥、账号数据、浏览器 profile 或 `evals/runs/` 等本地运行产物。
- 使用简洁的 Conventional Commit 标题。较大改动的正文描述行为变化，不记录常规测试命令输出。
- 详细提交规范见 [AGENTS.md](AGENTS.md)。

## 文档

用户文档位于仓库根目录和 `doc/`；浏览器扩展说明位于 `bridge-browser/`；评测说明位于 `evals/`。Marketplace README 由根目录的中英文 README 生成，不要直接编辑生成文件。
