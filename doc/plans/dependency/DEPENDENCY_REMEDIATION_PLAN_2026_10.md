# 依赖修复计划（2026-10）

语言：中文

## 一、触发原因

2026-10-23 推送 1.4.0 时，GitHub 报告默认分支存在 121 条依赖告警（48 high / 62 moderate / 11 low）。同期核查发现：CI 全绿且 `Audit shipped dependencies` 步骤成功，`Dependabot Updates` 工作流反复运行且成功，但 `gh pr list` 返回空。

即：审计门槛只覆盖产物内依赖（当前 0 条，真实通过），而构建期与测试期的漏洞既未修复，也未产出待审 PR。

关联文档：[依赖漏洞治理与加固计划](DEPENDENCY_HARDENING_PLAN.md)、[依赖审计豁免清单](../../reference/DEPENDENCY_AUDIT_EXEMPTIONS.md)。

## 二、现状核查结论

### 2.1 CI 状态（已验证）

| Run | 提交 | 结果 | 审计步骤 |
| --- | --- | --- | --- |
| 39911228333 | docs(release): record D and E batch work in 1.4.0 | success (1m27s) | success |
| 39897540678 | chore(release): bump to 1.4.0 | success (2m00s) | success |

`scripts/audit-shipped-deps.mjs` 只对 `gateway-vscode` 四个运行时依赖（`@modelcontextprotocol/sdk`、`cors`、`express`、`zod`）的传递路径设硬门槛。CI 通过等于产物内当前 0 条。

### 2.2 三个缺口

**缺口 1：Dependabot 在跑，却不产出 PR**

运行标题显示单次分组包含数十个包（`brace-expansion` x10、`fast-uri` x7、多个 SDK 版本等）。超大分组 PR 易因 lockfile 冲突或触达 `open-pull-requests-limit` 而无法创建，漏洞静默累积。

**缺口 2：豁免清单有一条论断缺少证据**

`DEPENDENCY_AUDIT_EXEMPTIONS.md` 记录 `hono` 属于测试期，理由是「gateway 使用 SDK 1.0.x，不依赖 hono」。该版本号需实测确认；若 `gateway-vscode` 的 SDK 实际版本传递引入 `hono`，则豁免失效、审计门槛本应失败。

**缺口 3：构建期/测试期高危依赖无修复动作**

| 包 | 漏洞 | 影响版本 | 修复版本 | 约束 |
| --- | --- | --- | --- | --- |
| `fast-uri` | 路径遍历、host confusion | <=3.1.0 / <=4.1.0 | 3.1.8 / 4.1.5 | ajv 8.x 声明 `^3.0.1` |
| `hono` | CORS ReDoS | <4.12.34 | >=4.12.34 | 需确认父级范围 |
| `@hono/node-server` | ReDoS | <1.19.13 | >=1.19.15（1.x） | 跨 2.x 需同步升级祖先 |
| `ip-address` | IPv6 zone 二次 DoS | <=10.7.3 | 10.7.4 | 10.x 线内安全 |
| `brace-expansion` | 大数字范围 DoS、<1.1.16 ReDoS | <1.1.16 | 1.1.16 或对应 5.x | 分 1.x / 2.x+ 两条线 |

### 2.3 硬约束

pnpm overrides 是全量替换，不校验父级声明的范围。把 `@hono/node-server` 从 `^1.19.0` 强行 override 到 `2.1.4` 会安装成功，在运行时才炸。**所有 override 必须带范围上限**（`>=X <Y`），不得裸写 `>=X`。

## 三、修复批次

### P0：验证豁免前提（已完成）

确认 gateway-vscode 的 SDK 实际版本，以及 hono 是否进入产物。结果见第六章。

退出条件：把实际输出写进豁免清单，替换无证据的「SDK 1.0.x」表述。已达成。

### P1：修复 Dependabot（最高杠杆）

目标：让高危 PR 真正产出。改 .github/dependabot.yml，要点：

- 用 applies-to: security-updates 让安全更新独立成组，不受普通分组拖累。
- open-pull-requests-limit 设为 10，防止达到上限后新 PR 被静默丢弃。
- 主版本升级单独成 PR，不自动合并。
- bridge-browser 目录单独配置，每月一次，上限 5。

退出条件：推送后 24-48 小时内 gh pr list 能看到 dependabot 创建的 PR。

### P2：受约束的 overrides

在根 package.json 的 pnpm.overrides 追加，全部带范围上限：

- fast-uri: >=3.1.8 <4.0.0
- hono: >=4.13.11 <5.0.0
- @hono/node-server: >=1.19.15 <2.0.0
- ip-address: >=10.7.4 <11.0.0

@hono/node-server 锁 1.x：跨 2.x 需同步升级祖先依赖，父级范围不确定时留在 1.x 是唯一安全选择。
brace-expansion 分线复杂且纯 DoS，本批保留豁免，复查时再评估。

验证：pnpm install 后跑 pnpm list fast-uri hono @hono/node-server ip-address --depth 20，再跑 node scripts/audit-shipped-deps.mjs --report 确认 shipped 仍为 0，最后 pnpm run lint 与 pnpm test。

退出条件：--report 中 build/test 层高危条目下降，shipped 仍为 0。

### P3：补齐审计盲区（必要修复）

P0 发现 pnpm audit 把 SDK 到 hono 的路径全部归到 evals>，因此 audit 本身无法发现 gateway 引入 server 侧模块的情况。本批必须补上机制保证。

1. audit-shipped-deps.mjs 增加产物扫描：对 dist/extension.js 检索每个 build/test 层 advisory 的模块名，命中即退出码 3 并打印冲突。
2. CI 增加分层报告步骤，写入 GITHUB_STEP_SUMMARY（不阻断）。
3. CI 记录 dependabot 待审 PR 数量，连续两周为 0 而报告有高危时告警。

退出条件：豁免清单每条都能追溯到自动检查或有日期的验证记录。

## 四、批次依赖与并行度

- P0 已完成，结论是豁免成立但审计有盲区。
- P1 与 P2 无文件重叠，可并行推进。
- P3 依赖 P2 的最终依赖图，并且是本次核查得出的必要项，不是可选优化。

## 五、决策记录

- P2 范围：只做有明确修复版本且父级范围可确认的四项。brace-expansion 分线复杂且纯 DoS，先保留豁免。
- 不改 express 主版本：沿用既有 pnpm.overrides 策略，只约束传递依赖。
- 不使用「漏洞总数下降」作为验收指标：总数含大量永不该修的构建期依赖。

## 六、P0 执行结果（2026-10-23）

### 6.1 实测数据

- gateway-vscode 声明 @modelcontextprotocol/sdk 为 ^1.32.0，实际解析 1.32.1。
- 依赖树包含 @hono/node-server 1.19.14（修复版 >=1.19.15）与 hono 4.12.15（修复版 >=4.13.11）。
- 审计分层：127 advisories，shipped 0、build 75、test 52。
- 审计中归属 gateway-vscode 的路径共 8 条，全部来自 @vscode/vsce 与 webpack。
- 打包产物 dist/extension.js 中 hono、fast-uri、ip-address、node-server 出现次数均为 0。

### 6.2 修正后的判定

豁免清单第 3 条的措辞需改，结论成立。

- 「gateway 使用 SDK 1.0.x」是错的，实际为 1.32.1。
- 「不依赖 hono」在运行时与打包意义上成立：产物零出现。
- 在安装层不成立：依赖树确实装进了 hono 4.12.15。

### 6.3 更严重的发现：审计路径归属盲区

pnpm audit 把 30 余条 SDK 到 hono、fast-uri、ip-address 的路径全部归到 evals>，没有一条归到 gateway-vscode>。

后果：shipped 为 0 依赖「产物恰好没有 import SDK 的 server 部分」这一事实，而非机制保证。若将来 gateway 引入 SDK 的 server 侧能力，pnpm audit 仍不会报警，audit-shipped-deps.mjs 也检不出。

这把 P3 从「可观测性优化」升级为必要修复：必须用产物扫描补 audit 的路径归属盲区。

## 七、P1-P3 执行结果（2026-10-23）

### P1：Dependabot 分组已重写

原配置把全部生产依赖塞进一个分组，PR 过大无法创建，Dependabot 却报告成功。新配置拆成：

- 安全更新独立分组（applies-to: security-updates），不会排在常规升级之后。
- 常规生产更新与开发更新分开，主版本升级单独成 PR。
- open-pull-requests-limit 提升到 10（根）与 5（bridge-browser）。

效果需推送后 24-48 小时观察 PR 是否真的产生。

### P2：受约束 overrides 已落地

追加四项，均带范围上限：

| 包 | 约束 | 解析结果 | 修复要求 |
| --- | --- | --- | --- |
| fast-uri | >=3.1.8 <4.0.0 | 3.1.9 | >=3.1.8 |
| hono | >=4.13.11 <5.0.0 | 4.13.13 | >=4.13.11 |
| @hono/node-server | >=1.19.15 <2.0.0 | 1.19.17 | >=1.19.15 |
| ip-address | >=10.7.4 <11.0.0 | 10.7.4 | >=10.7.4 |

审计总量 127 降到 85，test 层 52 降到 10，shipped 仍为 0。

### P3：审计盲区已补，且发现一处真实逃逸

关键事实：产物经 webpack 压缩后，包名不再出现在文本里。用 grep 搜索 fast-uri 得到 0 命中，但读取 sourcemap 的 sources 后确认 fast-uri 确实被内联。也就是说，仅靠文本扫描会漏判。

实施内容：

1. audit-shipped-deps.mjs 改为读取 gateway-vscode/dist/extension.js.map 的 sources 提取内联包集合，文本扫描降为回退。
2. 新增冲突检测：若某 advisory 被归入 build/test 层，但其模块出现在内联集合中，退出码 3。
3. 新增 --require-bundle：CI 中产物缺失时退出码 4，不再静默跳过扫描。
4. CI 在审计前先执行 pnpm --filter gateway-vscode run compile，避免 dist 被 gitignore 导致扫描空转。
5. 新增 evals/scripts/audit-shipped-deps.test.mjs，用合成数据验证三种退出码（0 通过、1 产物内漏洞、3 分类冲突）。

当前状态：86 个内联包，0 冲突，fast-uri 已在 P2 升到 3.1.9，无待修 advisory。但机制已就位，将来 fast-uri 若出新漏洞会被拦下，而不再被归到 evals 后静默放过。

## 八、已知缺口

- 构建期依赖的供应链攻击防护（lockfile 完整性、发布者验证、可复现构建）不在本计划范围。
- evals 与构建工具的告警不逐条处理，仅通过 overrides 收敛高危项。
- pnpm audit 的 devDependencies 统计对 pnpm workspace 不可信，分层依据依赖路径而非元数据。
- 审计归属盲区在 P3 完成前仍存在：当前 shipped 为 0 依赖产物实测，不是工具保证。
