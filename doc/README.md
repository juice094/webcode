# 文档目录

语言：中文 | [English](README_en.md)

## 快速上手

完整说明见 [快速上手索引](getting-started/index.md)。

- [浏览器模式指南](getting-started/BROWSER_MODE_GUIDE.md)：浏览器选择、保活模式和独立 profile。
- [手动安装浏览器桥接](getting-started/MANUAL_BRIDGE_GUIDE.md)：通过 `chrome://extensions` 加载已解压扩展的来源与同步约定。
- [常见问题](getting-started/FAQ_GUIDE.md)：首次启动、触发词和工具结果回填。
- [构建指南](getting-started/BUILD_GUIDE.md)：环境、源码构建、打包和本地安装。

## 使用指南

完整说明见 [使用指南索引](guides/index.md)。

- [MCP 服务配置指南](guides/MCP_GUIDE.md)：配置第三方 MCP server。
- [Skills 使用指南](guides/SKILLS_GUIDE.md)：工作区 Skills 的发现和使用。
- [站点支持扩展指南](guides/PLATFORM_GUIDE.md)：新增内置 AI 站点或配置自定义站点。

## 参考

完整说明见 [参考索引](reference/index.md)。

- [内置工具说明](reference/BUILTIN_TOOLS.md)：Gateway、初始化和浏览器侧工具。
- [read_file 设计说明](reference/READ_FILE_GUIDE.md)
- [搜索工具设计说明](reference/SEARCH_TOOLS_GUIDE.md)
- [终端工具设计说明](reference/RUN_IN_TERMINAL_GUIDE.md)
- [依赖审计豁免清单](reference/DEPENDENCY_AUDIT_EXEMPTIONS.md)：已知不修复的依赖漏洞、判定口径、理由与复查日期。
- [术语表](reference/terminology.md)：易混术语的标准写法、语域分工与已裁决记录。

## 架构

完整说明见 [架构索引](architecture/index.md)。

- [平台提示词指南](architecture/PLATFORM_PROMPT_GUIDE.md)：平台差异化 prompt 的实现说明。

## 计划与报告

完整说明见 [计划与报告索引](plans/index.md) 与 [依赖治理链索引](plans/dependency/index.md)。

- [UI 美观与交互体验优化开发计划](plans/UI_UX_DEVELOPMENT_PLAN.md)：范围、阶段、基线、验收、回滚与 Rust 重新评估条件。
- [UI 现代化改造计划](plans/UI_MODERNIZATION_PLAN.md)：Chrome 111 基线下的令牌层、原语层、性能预算与分面推广步骤；含 R1–R13 的完成记录与已发现缺陷。
- [工程审查整改计划](plans/ENGINEERING_REVIEW_REMEDIATION_PLAN.md)：工具调用超时中止、并发背压、搜索与读取热路径优化的分批落地计划。
- [依赖漏洞治理与加固计划](plans/dependency/DEPENDENCY_HARDENING_PLAN.md)：审计结论、真实暴露面分层、红队审计与分阶段治理步骤。
- [依赖修复计划（2026-10）](plans/dependency/DEPENDENCY_REMEDIATION_PLAN_2026_10.md)：CI 与依赖现状核查、Dependabot 分组缺陷、受约束 overrides 与审计盲区修复的分批计划。
- [依赖治理阶段性报告（2026-10-24）](plans/dependency/DEPENDENCY_REMEDIATION_REPORT_2026_10_24.md)：Dependabot 三轮修复、受约束 overrides、审计盲区补强与待处理项。

## 归档与工作流

完整说明见 [归档文档](archive/README.md)：已作废但保留历史价值的文档及其替代关系。

- [UI/UX 开发 Agent Skill](../.codex/skills/ui-ux-development/SKILL.md)：后续 agent 实施 UI 改动时必须遵循的工作流。

## 相关入口

项目入口和开发测试命令见[根目录 README](../README.md)；评测流程见 [Evals README](../evals/README.md)。
