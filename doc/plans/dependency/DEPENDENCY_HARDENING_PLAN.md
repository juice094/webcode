# 依赖漏洞治理与加固计划

语言：中文

## 决策状态

- 状态：待评审，按「先修真实暴露面 → 再补自动化 → 最后调结构」推进。
- 触发原因：推送时 GitHub 报告 132 个漏洞，精确审计为 137 条 advisory。
- 关联文档：[UI 现代化改造计划](../UI_MODERNIZATION_PLAN.md)（同期进行，无代码重叠）。

## 一、调查结论

数据来源：`pnpm audit --json --registry=https://registry.npmjs.org/`。

### 1.1 总量

| 指标 | 数值 |
| --- | --- |
| Advisory 条目 | 137 |
| 受影响模块 | 31 |
| critical / high / moderate / low | 1 / 58 / 69 / 12 |
| 依赖路径总数 | 140 |
| 仓库依赖总数 | 745 |

按顶层包分布：`evals` 61、`gateway-vscode` 38、根 `package.json` 23、`bridge-browser` 18。

### 1.2 关键事实：发布产物形态

这三条事实决定了 137 这个数字的实际含义。

1. `gateway-vscode/webpack.config.js` 的 `externals` 只有 `{ vscode: 'commonjs vscode' }`，其余全部内联进 `dist/extension.js`。
2. `gateway-vscode/.vscodeignore` 包含 `node_modules/**`，依赖包不随 `.vsix` 发布。
3. 产物中 `require()` 的目标只有 Node 内置模块和 `vscode`。

结论：用户运行时执行的是打包那一刻固化的代码，而非用户机器上的 `node_modules`。

### 1.3 真实暴露面

| 类别 | 路径数 | 是否进入用户运行时 |
| --- | --- | --- |
| `evals` 测试工具 | 61 | 否 |
| 根包 lint 工具 | 23 | 否 |
| `bridge-browser` 构建工具 | 18 | 否 |
| `gateway-vscode` 构建工具 | 34 | 否 |
| `gateway-vscode > express` 传递依赖 | 4 | 是 |

4 条经核实全部命中：

| Advisory | 模块 | 严重度 | 受影响范围 | 当前版本 | 修复版本 |
| --- | --- | --- | --- | --- | --- |
| 1119502 | qs | moderate | >=6.11.1 <=6.15.1 | 6.14.2 | >=6.15.2 |
| 1158506 | qs | moderate | >=6.14.2 <=6.15.3 | 6.14.2 | >=6.16.0 |
| 1158507 | qs | moderate | >=2.2.5 <6.16.0 | 6.14.2 | >=6.16.0 |
| 1123977 | body-parser | low | <1.20.6 | 1.20.5 | >=1.20.6 |

三条 qs advisory 中后两条修复版本均为 >=6.16.0，因此满足 6.16.0 即可同时解决三条。

### 1.4 唯一的 critical

```
proxy-addr >=1.1.0 <2.0.8（IP 欺骗 via IPv4-mapped IPv6）
路径：evals > @modelcontextprotocol/sdk > express > proxy-addr
```

`evals` 不在发布路径内。该漏洞需要应用使用 `trust proxy` 并据此做访问控制——`evals` 的 MCP SDK 用法是 stdio server 配置，非 HTTP server。但若将来 `evals` 起 HTTP 端点，需重新评估。

### 1.5 架构层面的缺失

| 缺失 | 证据 | 后果 |
| --- | --- | --- |
| 无自动化依赖更新 | 无 `dependabot.yml`、无 `renovate.json` | 137 条只能手动发现，持续累积 |
| CI 无审计门槛 | `grep -rln audit .github/workflows/` 为空 | 新增漏洞不阻断合并 |
| 审计无法区分生产/开发 | `pnpm audit` 报 `devDependencies: 0` | 4 条真实问题被 133 条构建期依赖淹没 |

第三条是工具缺陷而非仓库错误，但它直接导致「审计结果不可行动」。

### 1.6 不在 CVE 审计覆盖内的风险

`esbuild`、`vite`、`rollup`、`webpack` 被投毒的供应链风险，与 137 条无关。这类风险需要 lockfile 完整性校验、发布者验证、构建可复现性，不在本计划范围。

## 二、红队审计（对本计划本身的批判）

本节主动寻找本计划会失败的地方。

### R1. 「只修 4 条」的诱导性风险

**批判**：4 条这个数字会让人认为问题很小，从而不做 P1、P2。但 4 条是当前快照，没有自动化机制保证它不会变成 40 条。

**缓解**：P0 与 P1 必须同批交付，不允许只做 P0 就宣称完成。P1 的退出条件是「CI 能在新增生产依赖漏洞时失败」，而非「配置了 dependabot」。

### R2. 直接升级 express 的破坏性

**批判**：`qs` 与 `body-parser` 是 express 的传递依赖。要满足修复版本，要么升级到 express 5.x（大版本破坏），要么指望 express 4.22.1 的次要版本带上 `qs@6.16.0`——但当前 lockfile 已锁定 `qs@6.14.2`，仅升级 express 未必能带到目标版本。

**缓解**：优先用 `pnpm.overrides` 强制 `qs` 与 `body-parser` 到修复版本，不动 express 主版本。**该方案必须先验证**在 pnpm workspace + webpack 打包链路下生效，且运行时行为不变。验证前 P0 不宣称完成。

### R3. 审计门槛不可达

**批判**：设成「零漏洞」，745 个依赖下永远红，最终会被 disable；设成「不新增」，需要 baseline，否则存量 137 条会让阈值失效。

**缓解**：门槛必须分层。只对「进入产物的依赖」设硬门槛，其余仅报告。必须有豁免清单，每项写明理由与复查日期。

### R4. 本次调查自身的盲点

**批判**：调查**没有逐条阅读 advisory 描述**。只确认了版本命中，没确认 gateway 的实际调用是否触发对应代码。`qs` 三条是否涉及 gateway 使用的 API、`body-parser` 的 low 级问题是否在 JSON 解析路径上，均未验证。

**缓解**：P0 执行前必须补读这 4 条的描述与 PoC 条件，记录「触发 / 不触发 / 无法判定」。无法判定时按触发处理。

### R5. 动态 require 未解释

**批判**：产物中存在 1 处非字面量 `require()`，本次未确认其目标。若它按运行时字符串加载模块，则「产物只依赖 Node 内置模块」的结论不成立。

**缓解**：列为 P0 前置检查项。

### R6. 「不进入运行时」措辞可能被误用

**批判**：构建期依赖不进入用户运行时，但它们在开发者机器与 CI 上执行任意代码。若 `eslint` 的传递依赖被投毒，攻击者可读取环境变量与凭据。这是真实威胁模型，不能因「不发布」而忽略。

**缓解**：明确区分「用户运行时暴露」与「构建环境暴露」。后者不由 CVE 审计治理，需单独的供应链措施；本计划不覆盖，但要记录为已知缺口。

### R7. evals 豁免可能被滥用

**批判**：把 `evals` 排除在审计外，会让它成为漏洞堆积区。一旦 evals 代码被复用到生产路径，豁免就变成漏洞。

**缓解**：豁免必须绑定「`evals` 不出现在任何发布产物中」这一前提，并加自动检查——若 evals 被 gateway 或 bridge 引用，豁免立即失效。

### R8. 度量方式误导

**批判**：用「漏洞数从 137 降到 133」作为成功指标是错的。133 条里含大量永远不该修的构建期依赖。

**缓解**：验收改用分层计数，不使用总数。

## 三、分阶段计划

### P0：修复真实暴露面（阻塞项）

**前置检查结论**（已完成）

1. **动态 `require()`**：产物中那处非字面量 `require` 来自 `iconv-lite` 的错误提示文案（`"ACTION NEEDED: require('iconv-lite')..."`），是字符串内容而非运行时加载。产物依赖 Node 内置模块与 `vscode` 的结论成立。
2. **4 条 advisory 触发条件**（逐条阅读后）：

| Advisory | 触发条件 | 对 gateway 的判定 |
| --- | --- | --- |
| 1119502 `qs` | `qs.stringify` 使用 `arrayFormat: 'comma'` + `encodeValuesOnly: true`，数组含 null/undefined | **不触发**：gateway 代码中无 `qs.stringify` 调用 |
| 1158506 `qs` | `comma: true` 时 `a[]=1,2,3,4` 绕过 `arrayLimit` | **不触发**：express 4 默认 query parser 未启用 `comma` |
| 1158507 `qs` | `parse` → `stringify` 往返，且 `plainObjects` 或 `allowPrototypes` 为 true | **不触发**：gateway 无 `qs.stringify`，且未设置这两个选项 |
| 1123977 `body-parser` | `limit` 选项被配置为无效值（不可解析字符串或 NaN），导致大小检查被跳过 | **不触发**：`gateway.ts:440` 使用 `express.json()` 默认配置，未传 `limit` |

结论：4 条在当前代码路径下均不触发。**但版本仍升级**，理由见下。

3. **overrides 生效性**：已验证。首次设 `>=1.20.6` 时 `body-parser` 被拉到 2.2.2（跨主版本），而 express 4.22.1 声明 `~1.20.3`，属不兼容。收窄为 `>=1.20.6 <2.0.0` 后解析为 1.20.8，在兼容范围内。

**为什么在不触发的情况下仍然升级**

- `req.query.bridgeCode` 是唯一读取查询参数的位置，但 express 的 query parser 行为可能随版本或配置变化。
- 未来若引入 `qs.stringify` 或自定义 query parser，三条 `qs` 漏洞会立即变为可达。
- 升级成本已实测：340 项扩展测试全部通过，无回归。

**实施结果**

4. 根 `package.json` 增加 `pnpm.overrides`：`qs: >=6.16.0`、`body-parser: >=1.20.6 <2.0.0`。
5. 重新安装后解析为 `qs 6.16.1`、`body-parser 1.20.8`。
6. 重新构建，`pnpm audit` 确认 `gateway-vscode > express` 路径下剩余 advisory 为 **0**。
7. `pnpm --filter gateway-vscode run test`：**340 passing**。

**退出条件达成情况**

- 产物内 `qs >= 6.16.0`、`body-parser >= 1.20.6`：达成。
- `test:extension` 通过：达成（340 passing）。
- 4 条 advisory 不再出现在 `gateway-vscode > express` 路径下：达成（实测为 0）。

### P1：自动化（已完成）

**实施结果**

1. `scripts/audit-shipped-deps.mjs`：只对 `gateway-vscode` 运行时依赖（`@modelcontextprotocol/sdk`、`cors`、`express`、`zod`）的传递路径设硬门槛。退出码语义：0 通过、1 检出产物内漏洞、2 审计无法执行。
2. `package.json` 增加 `audit:shipped` 脚本。
3. `.github/workflows/test.yml` 在 unit 任务中加入审计步骤，并始终上传完整报告为 artifact（不阻断）。
4. `.github/dependabot.yml`：production 每周、development 每月，均分组。
5. `doc/DEPENDENCY_AUDIT_EXEMPTIONS.md`：记录 6 类已知不修复项的判定口径、理由与复查日期（2026-11-22）。

**退出条件验证**

- 构造含 `gateway-vscode>express>qs` 的合成 audit 数据 → 脚本退出码 **1**，并输出 advisory 详情。
- 构造只含 `bridge-browser>vite` 与 `evals>mocha>diff` 的合成数据 → 退出码 **0**，无误报。
- 真实仓库运行 → 132 条总数，产物内 **0** 条，退出码 0。
- 豁免清单 6 项，均有理由与复查日期。

**仍未验证**

- dependabot 配置未经真实 PR 验证（需推送后观察）。
- CI 工作流改动未在 GitHub Actions 上实跑。

### P2：分层审计（结构性）

**实施**

1. 编写脚本，按「产物内 / 构建期 / 测试期」对 audit 结果分类。
2. 在 CI 中分别报告，只有第一类设门槛。
3. 记录 `pnpm audit` 的 `devDependencies` 统计缺陷，避免后续误读。

**退出条件**

- 分类脚本输出与实际打包产物一致（抽查验证）。
- 文档记录分类依据与维护方式。

## 四、验收标准

| 指标 | 目标 | 方式 |
| --- | --- | --- |
| 产物内漏洞数 | 0 | 检查 audit 中 `gateway-vscode > express` 路径 |
| 新增生产依赖漏洞阻断 | 生效 | 构造场景验证 CI 失败 |
| 依赖更新自动化 | 存在 | dependabot PR 实际产生 |
| 审计结果可行动 | 分层输出 | 脚本输出与产物抽查一致 |

**不使用**「漏洞总数下降」作为验收指标（见 R8）。

## 五、风险与回滚

| 风险 | 缓解 | 回滚条件 |
| --- | --- | --- |
| `qs` 升级导致解析行为变化 | 先跑 `test:extension`；补跑覆盖查询参数的集成测试 | 请求解析异常 |
| `pnpm.overrides` 在 webpack 链路失效 | 构建后直接检查产物内联版本，不信任 lockfile | 产物版本未变 |
| dependabot PR 噪音 | 分组加频率限制；devDependencies 不自动合并 | PR 数量失控 |
| 审计门槛被 disable | 豁免清单加门槛只针对产物内依赖 | 门槛被绕过 |

回滚方式：P0 为 `package.json` 中 overrides 的增删，P1 为配置文件的增删，均可单独 revert。

## 六、不在本计划范围

- 构建期依赖的供应链攻击防护（lockfile 完整性、发布者验证、可复现构建）。
- `evals` 与构建工具的 133 条 advisory 的逐条处理。
- 依赖架构调整（合并构建工具、消除三套打包器）。
- `pnpm audit` 工具缺陷的修复（上游问题）。

## 七、已知缺口

- 4 条 advisory 经逐条阅读确认在当前代码路径下不触发，升级属于预防性措施而非紧急修复。
- 产物中动态 `require()` 已解释为 `iconv-lite` 的提示字符串，非模块加载。
- P1 已完成并有本地验证证据，但 dependabot 与 CI 工作流需推送后在 GitHub 上观察才能确认生效。
- P2（分层审计脚本的产物一致性抽查）尚未开始。
- 构建环境暴露面未纳入治理。
- 无性能或体积回归阈值，`qs` 升级后未测量影响。

