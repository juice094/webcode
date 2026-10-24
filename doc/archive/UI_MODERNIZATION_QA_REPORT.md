# UI 现代化改造阶段性 QA 报告

语言：中文

> **已作废（2026-10-22）**。本报告记录的是第 2 轮 `qa:start` 会话的中间状态，其后 R8–R13 已完成
> 审批流程 e2e、键盘断言、对比度实测与浅色/桥接页验证，并发现并修复了四个真实缺陷。
> 最新结论见 [UI 现代化改造计划](../plans/UI_MODERNIZATION_PLAN.md) 的「交互式 QA 结果」与「轮次安排」章节。
> 本文件仅作为当时的受阻记录保留，不作为验收依据。

## 报告范围

- 对应计划：[UI 现代化改造计划](../plans/UI_MODERNIZATION_PLAN.md)。
- 覆盖改动：M0 令牌层、M1 原语层、M2 审批弹窗试点。
- 报告状态：**阶段性收尾**，交互式 QA 未完成全部流程，未得出结论性验收意见。

## QA 运行信息

| 项目 | 内容 |
| --- | --- |
| 运行 ID | `2026-10-22T02-12-58-805Z-minimal-tool-loop-3s1cv0` |
| 站点 | deepseek |
| 场景 | minimal-tool-loop（确定性 bridge 与 Gateway 工具循环） |
| 隔离工作区 | `evals/runs/<run>/workspace` |
| 运行产物 | `evals/runs/<run>/` |

## 已完成

1. 隔离会话启动成功：`pnpm qa:start deepseek` 构建桥接与扩展并附加 Playwright 会话。
2. 会话状态健康：`qa:ctl status` 报告 `running`，Gateway 在端口 34567 运行，扩展 `three-water666.gateway-vscode@1.3.0` 处于活动状态，工作区为隔离目录。
3. 浏览器基线可用：DeepSeek 已登录，输入框与 webcode 工作面板（`展开工作面板 · webcode`）均可见。
4. 构建验证：`qa:start` 期间 bridge-browser 与 gateway-vscode 均编译成功，包含新增的 `approval_modal_views.ts` 与令牌模块。

## 未完成

- **未触发审批弹窗**：本次运行的固定场景不包含 agent task（`qa:ctl task` 返回 `Scenario minimal-tool-loop does not define an agent task.`），因此没有可驱动审批流程的固定提示词。
- **未验证 `<dialog>` 真实行为**：焦点陷阱、`::backdrop` 渲染、居中与尺寸、Esc 取消、`forced-colors` 焦点环、`prefers-reduced-motion` 均未在真实浏览器中观察到。
- **未测量对比度**：令牌取值为设计估算，未用工具实测记录。
- **未做性能对照**：无基线与回退阈值，不能宣称性能验收通过。

## 受阻原因

1. 场景选择：`minimal-tool-loop` 是确定性 bridge/Gateway 工具循环夹具，不提供面向模型的固定任务，因此无法在不人工构造提示词的前提下进入审批路径。
2. 审批模式配置键名未确认：尝试读取 `webcodeGateway.approvalMode` 返回空 inspect，说明该键不存在；需要先在 `gateway-vscode/package.json` 中确认实际配置键名，再决定如何强制触发审批。
3. 为遵守 QA 章程，未向站点发送自拟提示词来强行构造审批场景，也未批准任何破坏性操作。

## 待议问题

- 会话过程中出现过两轮回复未被识别为工具调用的情况（使用了非标准的标签式调用格式）。已改用标准 JSON 代码块格式。是否需要补充说明或约束，待确认。

## 建议的后续步骤

1. 选择一个会触发审批的 agent-eval 场景，例如命令风险或审批相关场景，重新运行 `pnpm qa:start deepseek <scenario-id>`。
2. 在 `gateway-vscode/package.json` 中确认审批模式与拒绝规则的配置键名，并在隔离扩展中设置为需要审批。
3. 审批弹窗出现后，按以下顺序验证：初始焦点位置、Tab 是否限制在弹窗内、`::backdrop` 是否覆盖整页、Esc 是否关闭（非强制场景）、拒绝后原因是否回传、关闭后焦点是否回到原元素。
4. 用截图记录主视图、永久允许视图、拒绝原因视图三种状态。
5. 补充对比度实测记录后再更新计划中的验收状态。

## 结论

本次阶段性 QA 只确认了环境可用与构建通过，**未对审批弹窗的真实交互与可访问性做出验收结论**。计划中 M2 的退出条件仍处于未满足状态。
