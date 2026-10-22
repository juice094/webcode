# 依赖审计豁免清单

语言：中文

本文件记录已知、经评审决定暂不修复的依赖漏洞。每项必须写明理由与复查日期。

## 判定口径

`pnpm audit` 报告的漏洞总数包含三类依赖：

1. **产物内**：`gateway-vscode` 的运行时依赖，经 webpack 内联进 `dist/extension.js`，会随 `.vsix` 交付给用户。
2. **构建期**：webpack、vite、esbuild、ts-loader、`@vscode/vsce` 等，只在构建与 CI 运行。
3. **测试期**：`evals` 下的 mocha、playwright、`@vscode/test-cli` 等。

`scripts/audit-shipped-deps.mjs` 只对第 1 类设硬门槛。第 2、3 类的漏洞不阻断 CI。

**这不代表第 2、3 类没有风险。** 它们在开发者和 CI 机器上执行任意代码，投毒可以读取环境变量与凭据。这类风险不由 CVE 审计治理，需要 lockfile 完整性、发布者验证等单独措施，本仓库尚未实施。

## 豁免条目

| 模块 | 类别 | 数量级 | 豁免理由 | 复查日期 |
| --- | --- | --- | --- | --- |
| `brace-expansion` | 构建期 | ~21 | 经 `eslint > minimatch` 引入，只在 lint 时解析 glob 模式，输入不受外部控制 | 2026-11-22 |
| `undici` | 构建期 | ~21 | 经 `@vscode/vsce > cheerio` 引入，只在打包时抓取页面 | 2026-11-22 |
| `hono` | 测试期 | ~26 | 经 `evals > @modelcontextprotocol/sdk` 引入；gateway 使用 SDK 1.0.x，不依赖 hono | 2026-11-22 |
| `vite` / `esbuild` / `rollup` | 构建期 | ~10 | 浏览器扩展构建工具，不进入任何发布产物 | 2026-11-22 |
| `ip-address` / `proxy-addr` | 测试期 | ~6 | 唯一 critical 落在此处，经 `evals` 的 express 传递引入。`evals` 的 MCP 用法是 stdio server，不暴露 HTTP 端点 | 2026-11-22 |
| `markdown-it` / `linkify-it` | 构建期 | ~7 | 经 `@vscode/vsce` 引入，只在打包时渲染 README | 2026-11-22 |

## 变更规则

- 新增豁免必须写明理由与复查日期，不接受「暂时忽略」这类无信息量的说明。
- 若某依赖从构建期或测试期进入产物路径，其豁免立即失效，必须修复。
- `scripts/audit-shipped-deps.mjs` 的 `SHIPPED_ROOTS` 与 `gateway-vscode/package.json` 的 `dependencies` 必须保持一致；不一致时以产物实际行为为准并更新脚本。
