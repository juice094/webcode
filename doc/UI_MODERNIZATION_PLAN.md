# UI 现代化改造计划（Chrome 111 基线）

语言：中文

## 决策状态

- 状态：已批准，按“令牌层 → 原语层 → 单流程试点 → 分面推广”推进。
- 浏览器基线：保持 `minimum_chrome_version` 为 111，不抬高。
- 技术路线：仅使用 Chrome 111 已支持的原生 Web 能力；不引入 React、Vue、组件库、CSS-in-JS 运行时或构建插件。
- 关系：本计划是 [UI 美观与交互体验优化开发计划](UI_UX_DEVELOPMENT_PLAN.md) 在“现代化实现手段”上的补充，不改变其范围、阶段门禁与 Rust 决策边界。冲突时以 `UI_UX_DEVELOPMENT_PLAN.md` 为准。
- 推进方式：按轮次敏捷推进。每轮完成可独立回滚的一批改动，未验证项随风险清单进入后续轮次，不阻塞当前轮次合并。

## 当前进度快照

> 本节由每轮开发结束时的全量扫描生成，不凭记忆。最后更新于第 9 轮（对比度实测与审批 e2e）。

### 阶段状态

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| M0 令牌层 | 完成 | 20 个 `@property` + 明暗两套值 + 字体/字号/行高令牌 |
| M1 原语层 | 完成 | 焦点环、`accent-color`、reduced-motion、forced-colors、`prefers-contrast` |
| M2 审批弹窗试点 | 完成 | `<dialog>` 迁移完成；第 9 轮的 e2e 发现并修复了一个导致弹窗不可见的挂载错误 |
| M3 试点验收 | 进行中 | 对比度已实测通过；审批流程 e2e 通过；键盘走查未做 |
| M4 分面推广 | 进行中 | 8 个 surface 中 5 个接入 `SHARED_STYLES`；令牌已下沉 `shared`，桥接页也使用同一数据源 |

### Surface 接入矩阵

`SHARED_STYLES` 覆盖：popup、审批弹窗、工具活动浮层（含后续输入浮层，二者同处一个 shadow root）、浮动日志、自动初始化确认。

| Surface | 文件 | `SHARED_STYLES` | 字号令牌 | 剩余硬编码字号 |
| --- | --- | --- | --- | --- |
| Popup | `index.html` + `popup/*.ts` | 已接入 | 已应用 | 0 |
| 审批弹窗 | `approval_modal_markup.ts` | 已接入 | 已应用 | 2（图标尺寸） |
| 工具活动浮层 | `tool_activity_overlay_styles.ts` | 已接入 | 已应用 | 3（图标尺寸） |
| 后续输入浮层 | `follow_up_overlay_styles.ts` | 随浮层接入 | 已应用 | 1（删除按钮字形） |
| 浮动日志 | `logger_styles.ts` | 已接入 | 已应用 | 0 |
| 自动初始化确认 | `auto_init_confirm.ts` | 已接入 | 已应用 | 0 |
| 视觉状态标记 | `visual_status.ts` | 不适用（作用于宿主页面） | 未应用 | 2（徽章） |
| 桥接加载页 | `bridge_loader.ts` | 不适用（gateway 侧渲染） | 未应用 | 0（用 em 相对单位） |

### 跨包共享：令牌下沉 `shared`

第 6 轮决定把令牌下沉到 `shared` 包，理由与边界如下。

**为什么下沉**

`shared` 已有 `branding.json`、`bridgeProtocol.json` 这类纯数据契约。令牌同样是纯数据，不含运行时逻辑、不访问 DOM、不依赖任一包的构建工具，因此不改变 `shared` 的性质。真正有成本的是共享样式引擎，而不是共享值。

**下沉了什么**

`shared/src/designTokens.ts` 导出：

- `DESIGN_TOKENS`（light / dark 两套颜色）
- `DESIGN_TOKEN_METRICS`（间距、圆角、时长、字号、行高）
- `DESIGN_TOKEN_FONTS`（字体栈，含 CJK 回退）
- `toCssDeclarations()`（纯函数序列化）

**没有下沉什么**

`@property` 注册留在 `bridge-browser/src/styles/tokens.ts`。它是浏览器专有特性，gateway 页面既不需要也不该携带。`tokens.ts` 现在从 `shared` 派生值，只额外补充 `@property` 声明。

**gateway 侧变化**

`bridgePage.ts` 引入 `DESIGN_TOKENS.dark` 生成 `--wc-*` 变量，样式表全部改为引用令牌；`renderInvalidBridgePage`、`renderInstallGuide`、`renderPortWarning` 的内联 `style` 全部改为语义类。桥接页自身的品牌色（Chrome Web Store 绿、GitHub 红）保留为 `--bridge-store` / `--bridge-github` 局部变量，因为它们不对应扩展的任何语义色。

**代价**

桥接页配色随令牌对齐发生变化（例如 accent 从 `#3498db` 变为 `oklch(0.62 0.17 250)`）。这是视觉变更，不是纯重构，未在真实浏览器确认观感。

### 交互式 QA 结果（第 8 轮）

使用 `pnpm qa:start` 启动两个隔离会话（deepseek 站点、minimal-tool-loop 场景）。

**通过项**

| 项 | 证据 |
| --- | --- |
| 初始化弹窗结构 | `role="dialog"`、标题与说明正确 |
| 初始化上下文插入一次 | 截图显示原始任务在前、上下文在后，无重复 |
| 不自动发送 | 插入后输入框仍可编辑，发送按钮可点 |
| 工具调用闭环 | trace 记录 `read_file` 启动与 3ms 完成，结果回填后模型继续回答 |
| 浮层状态显示 | 深色下显示「1/1 · 结果已回填」 |
| 深色主题跟随 | 修复后深色系统下弹窗为深色卡片，见下 |

**发现并修复的缺陷**

深色系统下，初始化弹窗渲染为纯白卡片，与深色宿主页面对比刺眼。

根因：四个 shadow-root surface（审批弹窗、`auto_init_confirm`、浮动日志、工具活动浮层）的宿主元素是裸 `div`，没有 `data-theme` 属性；`tokens.ts` 当时只有 `:root[data-theme="dark"]` 选择器，没有 `prefers-color-scheme` 规则。因此深色令牌对这 4 个 surface 不可达。

**更正**：报告初稿曾写“全仓库从未设置 `data-theme`”，这是错的。`bridge-browser/index.html` 第 2 行一直是 `<html data-theme="dark">`，popup 的深色令牌是可达的。当时的 grep 只扫了 `src/**/*.ts`，漏掉 HTML 文件。

修复分两步：

1. 在 `tokens.ts` 增加 `@media (prefers-color-scheme: dark)` 块，配合 `:not([data-theme])` 排除显式主题。显式 `data-theme` 仍然优先。
2. 移除 popup 的 `<html data-theme="dark">`。否则 `:not()` 会把 popup 排除在系统主题之外，让它成为唯一不跟随系统的 surface。

复测：重新启动会话，`emulateMedia({ colorScheme: 'dark' })` 后截图确认弹窗为深色卡片。popup 的浅色外观**未在浏览器中验证**。

**仍未验证**

- 浅色场景未在本轮复测。
- 对比度未用工具实测，所有对比度结论仍是目测。
- 键盘走查（`<dialog>` 焦点陷阱、Tab 循环、Esc、焦点恢复）未执行。
- **审批弹窗本身未触发**：本轮场景只做只读 `read_file`，未产生审批；验证的是 `auto_init_confirm`，它与审批弹窗是不同的 surface。
- 桥接页配色变更未实际打开确认。
- 浮层在深色宿主下的完整状态序列（等待审批、执行中、失败）未逐项验证。

**观察到的非缺陷现象**

- 深色下弹窗遮罩几乎不可见，层次感弱于浅色场景。
- `auto_init_confirm` 主按钮从 Material `#1a73e8` 变为 `--wc-accent`，饱和度降低，视觉重量变轻。

### 第 9 轮结果：对比度与审批 e2e

**对比度实测**

新增 `scripts/check-contrast.mjs`，按 CSS Color 4 规范把 `oklch()` 转 sRGB，再套 WCAG 2.x 相对亮度公式。22 组前景/背景组合，初始 6 组不达标。

根因：深色主题为了在深背景上可见，把 `success`/`warning`/`danger`/`accent` 的 L 提到 0.62–0.75，但填充按钮文字仍是白色。

| 组合 | 修复前 | 修复后 |
| --- | --- | --- |
| 深色 approve 按钮 | 2.91:1 | 6.46:1 |
| 深色 always-allow 按钮 | 2.28:1 | 8.26:1 |
| 深色 reject hover | 3.40:1 | 5.54:1 |
| 深色 scope approve | 3.64:1 | 6.54:1 |
| 深色 purpose 文字 | 4.26:1 | 5.40:1 |
| 浅色 purpose 文字 | 4.48:1 | 4.86:1 |

修复：深色主题的 `--wc-on-accent` / `--wc-on-filled` 改为深色墨（`oklch(0.18 0.01 260)`），`--wc-accent` 微调到 0.68。现在 22 组全部通过 4.5:1。已接入 CI：`pnpm check:contrast`。

**审批弹窗：e2e 发现真实缺陷**

`pnpm test:e2e:command-risk` 首次运行即失败：`.btn-confirm` 存在于 DOM 但永远不可见（87 次重试全部 hidden）。

根因是 `approval_modal.ts` 中两行自相矛盾的代码：`createModalElements` 已把 dialog 挂到 shadow root，随后 `host.appendChild(elements.dialog)` 又把它移到 light DOM，导致所有 shadow 样式失效。这是 R1 迁移 `<dialog>` 时留下的。

两轮 QA 都没发现的原因：`qa:start` 会话跑的是 `minimal-tool-loop`，只做只读 `read_file`，从未触发审批弹窗。

修复后 e2e 通过（9.9 秒走完普通审批、强制确认、危险命令阻断），已接入 CI。

教训：纯人工探索式 QA 无法替代确定性回归测试。

### 已知偏差

- 全部 surface 现在都跟随系统主题，没有任何 surface 硬编码主题。popup 从固定的深色改为跟随系统后，**浅色外观未经浏览器验证**。
- `auto_init_confirm` 已统一配色，但它与审批弹窗在功能上重叠（都是确认/取消），合并属于行为变更，未在本轮处理。
- `visual_status` 的 CSS 变量 fallback 仍是硬编码色值，这是宿主页面无令牌时的必要默认值，属于设计限制而非遗漏。
- 已加 lint 规则：禁止通过 `style.color`、`style.backgroundColor` 等直接赋值写入颜色，违规即报错。`style.setProperty('--token', ...)` 仍允许，因为那是向 CSS 变量供值的正确方式。规则已用临时探针验证确实会命中。
- lint **不强制**“每个 shadow root 直接引入 `SHARED_STYLES`”。`approval_modal.ts` 的样式常量定义在 `approval_modal_markup.ts` 中并已引入，直接引入检查会误报。这一层仍依赖人工审查。
- 日志颜色从 JS 内联改为 `data-log-type` 加 CSS 规则驱动；图标从 emoji 改为字形并加 `aria-hidden`。
- 中文字体栈已随 `TYPOGRAPHY_STYLES` 下发到 5 个 surface，但**未在真实浏览器验证实际渲染**。
- 桥接页已使用共享令牌，但其配色随之改变，**未在真实浏览器确认观感**。
- `renderInvalidBridgePage` 与安装引导卡片切换从 `style.display` 改为 `hidden` 属性，并补了 `[hidden] { display: none !important; }`。这一处修复了原实现中内联样式与标记不一致的隐患。

## 轮次安排

未验证项与残余风险随轮次推进，不阻塞当前轮次合并。

| 轮次 | 范围 | 风险进入后续轮次 |
| --- | --- | --- |
| R1 | 令牌层、原语层、审批弹窗 `<dialog>` 迁移 | `::backdrop` 与焦点行为未验证 |
| R2 | popup 令牌化与样式模块化、`visual_status` 颜色外移、预览页 | 字体令牌未应用 |
| R3（已完成） | 审批弹窗、工具活动浮层、浮动日志接入 `SHARED_STYLES`；ESLint 与 `.gitignore` 补充预览产物 | 对比度实测 |
| R4（已完成） | popup、审批弹窗、两个浮层应用字号与字体令牌 | 真实浏览器字体渲染验证 |
| R5（已完成） | `auto_init_confirm` 接入统一入口并统一配色；`bridge_loader` 内联色改为语义类，gateway 侧补充对应规则 | gateway 样式表仍硬编码 |
| R6（已完成） | 令牌下沉 `shared` 包；桥接页令牌化并消除全部内联样式；修复 `hidden` 与 `style.display` 混用 | 桥接页观感未验证 |
| R7（已完成） | `logger_styles` 字号令牌化；日志 emoji 改字形、颜色改 `data-log-type` 驱动；新增内联颜色 lint 规则并验证有效 | 对比度实测 |
| R8（已完成） | 交互式 QA：初始化流程、工具闭环、浮层状态通过；发现并修复深色主题不可达缺陷 | 审批弹窗与键盘走查未覆盖 |
| R9（已完成） | 对比度工具实测并修复 6 处不达标；`e2e:command-risk` 发现并修复 dialog 被移出 shadow root 的缺陷；两个门槛接入 CI | 键盘走查未做 |
| R10（下一步） | 键盘走查：在 `commandRiskE2E.test.ts` 补 Tab 循环、Esc 关闭、焦点恢复断言，使其进 CI | — |
| R11 | 浅色场景验证：popup 跟随系统后的浅色外观、审批弹窗浅色主题 | — |
| R12 | 桥接页确认：令牌化后配色变更的实际观感 | — |
| R13 | 性能基线：需负责人批准回退阈值，否则不做并记录 | — |


## 目标

在不抬高浏览器基线、不引入运行时依赖的前提下，同时满足：

1. 高性能：样式全部为构建期字符串，无运行时样式计算；动画仅使用合成友好属性；合成层效果有明确预算。
2. 高美化：三个 surface 共用一套语义令牌与视觉语言；焦点、状态、对比度一致且可达标。
3. 高维护性：单一令牌源；surface 只引用令牌，不写死色值；单 surface 可独立回滚。

三个目标并不天然冲突。真正的冲突来自“用 JS 驱动视觉”和“无限制堆叠合成层效果”，本计划通过架构约束排除这两点。

## 技术基线

`bridge-browser/manifest.json` 声明 `minimum_chrome_version: 111`。

可用能力：`<dialog>` 与 `showModal()`、`:focus-visible`、`accent-color`、`@property`、`:has()`、Container Queries、`dvh`、`oklch()` 与 `color-mix()`（111 恰好支持）、`forced-colors`、`prefers-contrast`。

不可用能力：CSS 嵌套（112）、Popover API（114）、`@starting-style`（117）、`light-dark()`（123）、`prefers-reduced-transparency`（118+）。

明暗主题在 111 下不使用 `light-dark()`，改为 `data-theme` 属性加两套令牌值。

## 三层架构

- Layer 1 令牌层：`bridge-browser/src/styles/tokens.ts`，原始值与语义令牌，`@property` 声明类型。
- Layer 2 原语层：`bridge-browser/src/styles/primitives.ts`，统一焦点环、原生控件配色、降级媒体查询。
- Layer 3 表面层：各 surface 的 `styles.ts` 或内联样式，只写布局，颜色与间距一律引用令牌。

### 约束

- Layer 3 禁止直接写十六进制或 `rgb()` 色值，必须引用 `--wc-*` 令牌。
- Layer 3 禁止把状态色写进内联 `style`，统一用 `data-state` 属性加语义类。
- 令牌按语义命名：`--wc-surface`、`--wc-on-surface`、`--wc-accent`、`--wc-danger`、`--wc-focus-ring`、`--wc-space-*`、`--wc-radius-*`、`--wc-dur-*`。
- `@property` 用于颜色、长度、时间令牌，使其可在 DevTools 检查、可参与动画、可拒绝非法值。

## 性能预算

| 预算项 | 规则 |
| --- | --- |
| 运行时样式 | 0 个 CSS-in-JS 运行时；样式全部为构建期字符串 |
| 动画属性白名单 | 只允许 `opacity` 与 `transform`；禁止动画 `width`、`height`、`box-shadow`、`filter` |
| 合成层预算 | `backdrop-filter` 全页同时可见不超过 1 处，且不放在可滚动容器的祖先上 |
| 阴影预算 | `box-shadow` blur 大于 20px 仅限顶层卡片，同时可见不超过 2 层 |
| CSS 体积 | 令牌层与原语层合计不超过 15KB（未压缩），无 `@import` |
| 反馈延迟 | 点击到可见状态变化的 p50 目标值待基线后由负责人批准 |

已知现存违规项，在对应阶段修复：

- `tool_activity_overlay_styles.ts` 中 `.launcher { transition: width ... }` 触发布局，需改为 `transform` 或移除。
- `.launcher`、`.panel`、`.history-panel` 三处 `backdrop-filter: blur(10px)` 需合并或替换。
- `logger_styles.ts` 中 `.logger` 的 `backdrop-filter: blur(4px)` 需纳入同一预算核算。

## 实施阶段

| 阶段 | 工作项 | 交付物 | 退出条件 |
| --- | --- | --- | --- |
| M0 令牌层 | 新增 `styles/tokens.ts` | 令牌模块与说明注释 | `pnpm lint` 通过；令牌可在 DevTools 解析 |
| M1 原语层 | 新增 `styles/primitives.ts` | 原语模块 | 同上 |
| M2 审批弹窗试点 | 迁移到原生 `<dialog>`；接入令牌与原语；移除内联色；修复对比度；补 reduced-motion | 可独立回滚的改动与测试 | 焦点陷阱、Esc、`::backdrop`、对比度达标；lint 与相关测试通过 |
| M3 试点验收 | 键盘走查、对比度实测、长任务对照 | 验收记录 | 硬性 a11y 门槛通过；性能不超预算 |
| M4 分面推广 | Popup、浮层、日志按 surface 逐一令牌化 | 分批 PR | 每个 surface 单独通过检查 |

阶段 M2 起，每个改动必须可独立 revert。

## 试点范围（M2）

选定审批弹窗，原因：用户高频、状态多、结构清晰、当前问题最集中。

具体改动：

1. 手写的 `position: fixed`、`z-index`、`width: 0`、`height: 0` 容器改为承载 `<dialog>` 的轻量宿主。
2. `position: fixed; inset: 0` 遮罩改为 `<dialog>::backdrop`。
3. `role="dialog"`、`aria-modal="true"`、`aria-labelledby` 由 `<dialog>` 与显式属性提供。
4. 焦点陷阱、初始焦点、Esc 由浏览器提供；强制性审批在 `cancel` 事件中调用 `preventDefault()`。
5. 关闭后焦点恢复通过记录 `document.activeElement` 实现。
6. `approval_modal_markup.ts` 中内联色值改为语义类。
7. 白字配 `#ff9800` 改为令牌化深橙，满足 WCAG 2.2 AA。
8. 装饰性 emoji 加 `aria-hidden="true"`。
9. 拒绝原因输入框补 `<label>`。
10. `prefers-reduced-motion` 覆盖 `fadeIn`。

保留不变：审批语义、`CommandApprovalScope` 取值、拒绝原因回传、`mandatory` 行为、事件守卫。

## 验收标准

- 键盘可完成：Tab 循环在弹窗内，焦点可见；Esc 可关闭（非强制场景）。
- `role="dialog"`、`aria-modal="true"`、可访问名称存在。
- 对比度满足 WCAG 2.2 AA，并记录测量结果。
- 严重级可访问性问题为 0。
- 动画属性全部在允许清单内；`backdrop-filter` 不超过预算。
- `pnpm lint` 与 `bridge-browser` 相关测试通过。
- 试点可独立 revert。

待确认：性能回退阈值需负责人在试点前批准；弹窗是否跟随宿主明暗主题待定。

## 测试与验证

- `pnpm lint`。
- `pnpm --filter bridge-browser run test`。
- 涉及弹窗行为的逻辑补充或更新测试。
- `<dialog>` 在 Shadow DOM、`::backdrop`、`forced-colors`、`prefers-reduced-motion` 的真实行为需交互式 QA 验证；仅在用户明确授权后，按 `webcode-browser-qa` Skill 在 `qa:start` 隔离工作区执行。

## 风险与回滚

| 风险 | 缓解 | 回滚条件 |
| --- | --- | --- |
| `<dialog>` 在 Shadow DOM 与轻量宿主下定位或尺寸异常 | 以 `dialog { width: min(90vw, 450px); margin: auto; }` 兜底；真实浏览器验证 | 遮罩或居中明显异常 |
| `oklch()` 与 `color-mix()` 在旧 Windows 下偏差 | 保留 `oklch` 基准；对比度实测 | 实测低于 AA |
| 令牌化引入视觉回归 | 单 surface 试点；逐项对照 | 关键控件不可读 |
| 合成层预算被突破 | 代码审查清单与后续 CI 脚本 | 超出预算 |
| 审批安全语义回归 | 不改变 `CommandApprovalScope` 与回调契约；补充测试 | 审批结果或拒绝原因不一致 |

回滚方式：M2 改动集中在审批弹窗相关文件与新增 `styles/` 目录，可整体 revert；M4 按 surface 分批 revert。

## 不在本期范围

- 抬高 `minimum_chrome_version`。
- 引入 React、Vue、Tailwind、组件库或 CSS-in-JS 运行时。
- 全量视觉重做。
- 强行重设 VS Code 宿主主题。
- 运行时主题引擎。

## 与既有计划的关系

- 阶段划分与硬门槛沿用 [UI 美观与交互体验优化开发计划](UI_UX_DEVELOPMENT_PLAN.md)。
- 本计划只回答“用什么现代化手段实现”，不改变其基线、验收与 Rust 决策边界。
