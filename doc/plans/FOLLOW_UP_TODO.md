# 后续待办

> 状态：开放
> 来源：DeepSeek 限流治理与 read_file 附件路由工作后的遗留项

## P0

### 1. 协议漂移检测（已实现，待真实会话验收）

**问题**：模型在上下文压力或强制工具选择时，会输出平台原生工具调用语法（如 DeepSeek 的 `<｜｜DSML｜｜>`、Anthropic 的 `antml:`）。这些不是 JSON 代码块，webcode 扫描器看不到，gateway 收不到请求，工作面板停在旧状态，用户只看到一段乱码文本。**全链路静默失败。**

**证据**：2026-10-24 QA 会话中，明确要求「严格使用 read_file」后，模型输出 DSML 语法，trace 无任何 read_file 事件。

**动作**：在 assistant 回复的文本扫描阶段，除找 JSON 代码块外，同时检测已知原生语法标记。命中且无对应 JSON 调用时，在 UI 明确提示「模型输出了非协议格式的工具调用，未被执行」。

**验收**：构造一次 DSML 输出，确认 UI 出现提示且工作面板状态不误导。

**进展**：`nativeToolSyntax.ts` 负责检测，`native_syntax_notice.ts` 负责提示，6 条单测覆盖 DSML 双/单竖线、antml、普通文本、合法 JSON 与空输入；`bridge-browser` 编译、lint 与全部单测通过（commit `e7bda49`）。仍未做真实会话的端到端验收。

### 2. 强化 train prompt（已完成）

**问题**：现有 `prompts/train_zh.md` / `train_en.md` 每 5 次工具调用附加一次协议提醒，但未明确禁止平台原生语法。

**动作**：在两份 train prompt 中加入「禁止使用平台原生工具调用语法（DSML/antml 等），必须用 JSON 代码块」。

**性质**：概率性改善，不保证。

**进展**：两份 train prompt 已补充「必须放在 JSON 代码块中」与「禁止 DSML/antml 原生语法」，网关类型检查与 391 项单测通过（commit `ff79d22`）。

## P1

### 3. read_file 路由的后续观察

**现象**：QA 实测中，模型面对 PNG 时主动选择 `attach_file` 而非 `read_file`。`read_file` 的附件路由因此未被自然触发。

**已做**：路由作为兜底保留（391 项单测全绿），`attach_file` 仍是图片/PDF 的主路径。

**不做**：不追求改变模型的工具选择习惯。强制指定工具会诱发协议漂移（见 P0-1）。

**补充**：`attach_file` 描述已去掉「仅需查看文本时改用 read_file」的反向暗示，改为强调投递能力（commit `caee4ed`）。

### 4. 文档化协议限制

**动作**：在 FAQ 中说明「强制指定工具可能诱发协议漂移」，以及遇到乱码文本时的处理方式。

### 5. read_file 路由代码提交（已完成）

**状态**：`attachmentSupport.ts`、`attachFileTool.ts`、`readFileTool.ts`、`readFileAttachmentRouting.test.ts` 已随 commit `b7ea22f` 提交，391 项单测全绿。

## 已知失败教训

2026-10-24 的一次委托中，我在 thinking 中反复声明要执行 `gh api`，但从未真正发出工具调用，陷入「搜索 → 失败 → 再搜索」循环，最终输出未经任何验证的回答，并编造了多个 CVE 编号。

**教训**：

- thinking 里说「执行」不等于执行。真正的执行是发出工具调用 JSON 块。
- 没有工具验证的输出，不能包含具体编号、版本号、结论。
- 遇到访问受限时，应直接报告限制，而不是用猜测填充答案。
