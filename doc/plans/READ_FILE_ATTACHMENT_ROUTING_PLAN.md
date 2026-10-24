# read_file 附件路由设计

> 状态：设计待审
> 范围：`gateway-vscode/src/tools/readFileTool.ts` 及其单测
> 原则：路由决策收进工具实现，模型无感，不新增提示词依赖

## 1. 问题

`read_file` 当前只读 UTF-8 文本（`readFileTool.ts:33-34` 的描述、`readFileContent` 的 `fs.readFile(filePath, 'utf8')`）。模型遇到 PDF、图片时：

- `read_file` 报「不是 UTF-8 文本」；
- 唯一出路是模型自己想到改用 `attach_file`，属于靠模型自觉的编排，不可靠；
- 回传侧（工具结果 → 网页）已有确定性附件通道，读取侧没有。

这是「文件上传替代粘贴」诉求的读取侧缺口。回传侧已由 `maxInlineChars` 关闭。

## 2. 已确认的基础设施

| 能力 | 位置 | 结论 |
|---|---|---|
| resource 类型结果 | `tools/types.ts:6-16` | `ToolContent.type` 开放，支持 `resource` |
| 附件结果构造 | `attachFileTool.ts:117-145` `createAttachmentResult` | base64 + mimeType + `_meta`，现成模式 |
| 支持格式表 | `attachFileTool.ts:17-53` `SUPPORTED_ATTACHMENTS` | TXT/PNG/JPEG/WebP/GIF/PDF，含魔数校验 |
| bridge 侧解析 | `bridge-browser/src/modules/tool_result.ts:173-184` `parseContentAttachment` | 自动识别 `type === "resource"` 并转附件投递 |
| 超长文本兜底 | `result_delivery.ts:216-221` `shouldAttachResultText` | 回传侧已有，与本次无关 |
| 风险策略 | `sensitivePathPolicy.ts:79-98` | 只依赖 path，与新路由无冲突 |

**关键结论：bridge 侧无需改动。** 只要 gateway 返回 `type: 'resource'`，投递链路自动生效。

## 3. 设计

### 3.1 分流点

在 `readFileTool.execute` 中，`resolveWorkspaceRelativePath` 之后、`readFileContent` 之前分流（`readFileTool.ts:63-65` 之间）：

1. 内置 skill 虚拟路径 → 现状不变（只读文本）；
2. 敏感文件 risk 检查 → 现状不变；
3. `resolveWorkspaceRelativePath`；
4. 【新增】按扩展名判断：`.pdf`/`.png`/`.jpg`/`.jpeg`/`.webp`/`.gif` → 附件路由，其余 → 现状文本路径。

### 3.2 附件路由行为

复用 `attach_file` 的校验与构造：

1. 复用 `SUPPORTED_ATTACHMENTS` 做扩展名 + 魔数双重校验（防止扩展名伪装）；
2. 复用 `createAttachmentResult` 构造 `resource` 类型结果（base64 + mimeType + `_meta`）；
3. 返回文本说明：`Prepared workspace file "<path>" (<mimeType>, <bytes>) for browser attachment delivery.`

### 3.3 与行选择参数的冲突

`read_file` 有 `head`/`tail`/`start_line`/`end_line`/`show_line_numbers`。附件路由下这些参数无意义。

**决策：显式报错，不静默忽略。** 静默忽略会让模型误以为按行读取生效了，产生错误认知。报错文案：`read_file cannot apply line selection to a binary attachment. Read the full file or use attach_file directly.`

### 3.4 超长文本的处理

本次**不做**「文本超长自动转 .txt 附件」。理由：回传侧的 `maxInlineChars` 已覆盖投递体积问题；读取侧超长文本已由 `READ_FILE_OUTPUT_MAX_BYTES` 加行选择参数处理；再叠一层会让同一工具在两条路径上都有附件行为，语义更复杂。若后续需要，作为独立项评估。

### 3.5 代码复用方式

`SUPPORTED_ATTACHMENTS` 与 `createAttachmentResult` 目前是 `attachFileTool.ts` 私有。两种方案：

| 方案 | 做法 | 代价 |
|---|---|---|
| A | 从 `attachFileTool.ts` 导出这两个符号 | 最小改动，但 `readFileTool` 依赖另一个工具文件 |
| B | 提取到新模块 `tools/attachmentSupport.ts` | 职责更清晰，改动面稍大 |

**推荐 B**：附件格式支持是两条工具路径共享的基础能力，放在独立模块比跨工具文件导入更合理。

## 4. 改动清单

| 文件 | 改动 | 优先级 | 验证 |
|---|---|---|---|
| `tools/attachmentSupport.ts` | 新增，迁入 `SUPPORTED_ATTACHMENTS`、`resolveSupportedAttachment`、`createAttachmentResult` | P0 | 原 `attachFileTool` 测试全绿 |
| `tools/attachFileTool.ts` | 改为从新模块导入 | P0 | 同上 |
| `tools/readFileTool.ts` | 描述更新 + `execute` 增加分流 + 行选择冲突报错 | P0 | 新增单测 |
| `unit-test/readFileTool.test.ts` | 补附件路由用例 | P0 | 见下 |
| `unit-test/attachFileTool.test.ts` | 确认迁移后无回归 | P0 | 全绿 |

不改动：`bridge-browser/**`、`sensitivePathPolicy.ts`、`result_delivery.ts`、任何提示词。

## 5. 单测清单

1. `read_file` 读 PNG → 返回 `type: 'resource'`，`mimeType === 'image/png'`，`blob` 为 base64；
2. `read_file` 读 PDF → 同上，`mimeType === 'application/pdf'`；
3. `read_file` 读伪装扩展名的文件（`.png` 但内容不是 PNG）→ 报错；
4. `read_file` 读 `.png` 且带 `head` → 报行选择冲突错误；
5. `read_file` 读普通 `.txt` → 行为与改动前完全一致（回归）；
6. `read_file` 读超长文本 → 行为与改动前一致（回归）；
7. 敏感文件路径 + 附件扩展名 → risk 检查仍先生效。

## 6. 验收标准

- `pnpm --filter gateway-vscode run compile` 通过；
- `pnpm --filter gateway-vscode run test` 全绿；
- 交互式 QA：在隔离会话中对 DeepSeek 发「读取工作区里的 xxx.png」，确认 bridge 侧附件投递与 DeepSeek 认账。注：模拟 paste 通道已在本次限流验证中用 .txt 附件实测通过，图片格式风险低；此步骤用于确认格式级行为，而非验证通道本身。
- 回归：原有 `read_file` 全部单测零改动通过。

## 7. 风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| 扩展名路由误判文本文件 | 正常文件被当附件 | 魔数校验兜底，不匹配即报错而非误投递 |
| 附件投递失败 | 模型拿不到内容 | bridge 侧已有失败原因回传（`attachment_delivery.ts:58-68`），模型可回退用 `attach_file`。模拟 paste 通道已用 .txt 实测通过；DeepSeek 具备原生图片处理能力，图片格式风险低 |
| 工具语义扩张影响模型判断 | 模型对 `read_file` 能力认知混乱 | 描述明确写「文本读取，或把 PDF/图片作为附件投递」 |

**回滚点**：单次 commit，回滚即恢复 `read_file` 纯文本语义。`attachmentSupport.ts` 为纯迁移，回滚不影响 `attach_file`。

## 8. 不做什么

- 不改 bridge 侧解析逻辑（已支持）；
- 不把超长文本自动转附件（回传侧已覆盖）；
- 不新增提示词规则（路由收在工具实现里）；
- 不处理 Office 文档（.docx/.xlsx），当前 `attach_file` 不支持，超出本次范围。



