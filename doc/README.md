# 文档目录

语言：中文 | [English](README_en.md)

## 用户指南

- [浏览器模式指南](BROWSER_MODE_GUIDE.md)：浏览器选择、保活模式和独立 profile。
- [常见问题](FAQ_GUIDE.md)：首次启动、触发词和工具结果回填。
- [内置工具说明](BUILTIN_TOOLS.md)：Gateway、初始化和浏览器侧工具。
- [MCP 服务配置指南](MCP_GUIDE.md)：配置第三方 MCP server。
- [Skills 使用指南](SKILLS_GUIDE.md)：工作区 Skills 的发现和使用。

## 构建与扩展

- [构建指南](BUILD_GUIDE.md)：环境、源码构建、打包和本地安装。
- [站点支持扩展指南](PLATFORM_GUIDE.md)：新增内置 AI 站点或配置自定义站点。
- [平台提示词指南](PLATFORM_PROMPT_GUIDE.md)：平台差异化 prompt 的实现说明。

## 工具设计说明

- [read_file 设计说明](READ_FILE_GUIDE.md)
- [搜索工具设计说明](SEARCH_TOOLS_GUIDE.md)
- [终端工具设计说明](RUN_IN_TERMINAL_GUIDE.md)

## 项目计划与 Agent 工作流

- [UI 美观与交互体验优化开发计划](UI_UX_DEVELOPMENT_PLAN.md)：范围、阶段、基线、验收、回滚与 Rust 重新评估条件。
- [UI 现代化改造计划](UI_MODERNIZATION_PLAN.md)：Chrome 111 基线下的令牌层、原语层、性能预算与分面推广步骤。
- [依赖漏洞治理与加固计划](DEPENDENCY_HARDENING_PLAN.md)：审计结论、真实暴露面分层、红队审计与分阶段治理步骤。
- [UI 现代化改造阶段性 QA 报告](UI_MODERNIZATION_QA_REPORT.md)：隔离会话状态、已完成项、受阻原因与后续步骤。
- [UI/UX 开发 Agent Skill](../.codex/skills/ui-ux-development/SKILL.md)：后续 agent 实施 UI 改动时必须遵循的工作流。

项目入口和开发测试命令见[根目录 README](../README.md)；评测流程见 [Evals README](../evals/README.md)。
