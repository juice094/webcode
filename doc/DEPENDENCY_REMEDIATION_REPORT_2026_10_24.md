# 依赖治理阶段性报告（2026-10-24）

语言：中文

## 一、已完成

### 1.1 Dependabot 配置修复（三轮）

| 轮次 | 问题 | 修复 |
| --- | --- | --- |
| 1 | 两个 `directory: /` 条目，Dependabot 拒绝解析 | 合并为单一 entry，用 groups 内 `dependency-type` 区分 |
| 2 | `/bridge-browser` 子目录条目只改子包不更新根 lockfile，CI 必然失败 | 移除子目录条目，根条目覆盖全部 workspace 包 |
| 3 | 单一开发组一次含 12 个包，失败无法定位 | 按 lint / types / test / build 拆四组，只允许 patch |

修复后 Dependabot 正常产出单包 PR，失败可精确定位。

### 1.2 受约束 overrides

全部带范围上限，避免 pnpm 全量替换导致跨主版本：

| 包 | 约束 | 当前解析 |
| --- | --- | --- |
| qs | >=6.16.0 | 6.16.1 |
| body-parser | >=1.20.6 <2.0.0 | 1.20.8 |
| proxy-addr | >=2.0.8 <3.0.0 | — |
| fast-uri | >=3.1.8 <4.0.0 | 3.1.9 |
| hono | >=4.13.11 <5.0.0 | 4.13.13 |
| @hono/node-server | >=1.19.15 <2.0.0 | 1.19.17 |
| ip-address | >=10.7.4 <11.0.0 | 10.7.4 |

审计总数从 127 降至 85，test 层从 52 降至 10。

### 1.3 审计盲区修复

关键发现：webpack 压缩后包名不再出现在产物文本中。用 grep 搜索 fast-uri 得到 0 命中，但读 sourcemap 的 sources 后确认 fast-uri 确实被内联。

实施：

1. `audit-shipped-deps.mjs` 改读 `dist/extension.js.map` 的 sources 提取内联包集合，文本扫描降为回退。
2. 新增冲突检测：build/test 层 advisory 的模块若出现在内联集合中，退出码 3。
3. 新增 `--require-bundle`：CI 中产物缺失时退出码 4，不再静默跳过。
4. CI 审计前先执行 `pnpm --filter gateway-vscode run compile`，避免 dist 被 gitignore 导致空转。
5. 新增 `evals/scripts/audit-shipped-deps.test.mjs` 覆盖三种退出码。

### 1.4 构建期供应链防护（部分）

| 项 | 状态 |
| --- | --- |
| release 作业权限收窄 | ✅ 拆成 build（contents: read）与 publish（contents: write） |
| 发布脚本路径修复 | ✅ `./build_release.sh` → `./scripts/release/build-release.sh` |
| 安装脚本白名单 | ✅ onlyBuiltDependencies: esbuild, keytar |
| provenance 验证 | ❌ 未做 |
| 可复现构建 | ❌ 未做 |

顺带修复一个阻塞发布的真实 bug：根目录 `build_release.sh` 在 c33ea01 被删除，但 release.yml 仍调用它，导致 1.2.1 之后任何 tag 都会在第一步失败。

### 1.5 已合并的依赖 PR

| PR | 内容 | 备注 |
| --- | --- | --- |
| #4 | express 4.22.1 → 4.22.3 | 运行时依赖，三项全绿 |
| #6 | @types/node patch | 全绿 |
| #7 | dev-test 组（playwright-cli、test-cli） | 全绿 |
| #8 | @types/chrome 0.0.260 → 0.3.5 | 需类型迁移，见下 |
| #10 | @vscode/vsce patch | 全绿 |
| #11 | playwright-core patch | 全绿 |
| #12 | webpack 5.106.2 → 5.112.0 | 全绿 |
| #13 | typescript-eslint 8.57.1 → 8.72.0 | 需断言清理，见下 |
| #14 | ts-loader patch | 全绿 |
| #15 | mocha 11.7.5 → 11.8.0 | 全绿 |

关闭：

- #3：子目录条目产生的无法安装 PR
- #5：12 包批量升级，全 CI 失败且无法定位
- #9：@types/vscode 1.116 → 1.140，与 engines ^1.106.1 脱钩，存在真实兼容风险

### 1.6 升级带来的必要代码修复

**@types/chrome 0.3.5**

- `chrome.tabs.TabChangeInfo` 改名为 `OnUpdatedInfo`。
- `chrome.tabs.update` 返回 `Promise<Tab | undefined>`，新增 undefined 守卫。
- 移除 8 处因类型收窄而冗余的断言。

**typescript-eslint 8.72.0**

- `no-unnecessary-type-assertion` 规则收紧，移除 5 处冗余断言，每处均用 tsc 验证类型仍成立。

## 二、审计门槛抓到的新问题（待处理）

最终验证时 `pnpm run audit:shipped:strict` 退出码 3：

```text
HIGH body-parser 1243073 classified test but bundled via evals>@modelcontextprotocol/sdk>express>body-parser
```

**这正是 P3 机制要抓的那类问题**：`pnpm audit` 把 body-parser 的路径只归到 `evals>`，路径分类判定 shipped 为 0；但产物扫描确认 body-parser 实际被内联进 `dist/extension.js`（express 的一部分）。

当前 lockfile 中 body-parser 为 1.20.8，满足既有 override `>=1.20.6 <2.0.0`。**需确认 advisory 1243073 的 patched_versions 是否高于 1.20.8**——若要求更高版本，则需调整 override 上限。

**这是待办，不是已完成项。**

## 三、验证状态

```text
lint = 0
 test = 0  (gateway 384 + evals 4)
build = 0

audit = 3  ← 见第二节
```

## 四、剩余缺口

- body-parser advisory 1243073 待处理。
- provenance 验证未做。
- 可复现构建未做（当前投入产出比不划算）。
- 构建期依赖的供应链攻击防护仅做到权限收窄与脚本白名单两项。
