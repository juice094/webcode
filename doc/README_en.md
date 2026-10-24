# Documentation Index

Language: English | [中文](README.md)

## Getting Started

See the [getting started index](getting-started/index.md) for a reading order.

- [Browser mode guide](getting-started/BROWSER_MODE_GUIDE_en.md): browser selection, keepalive modes, and isolated profiles.
- [Manual bridge installation](getting-started/MANUAL_BRIDGE_GUIDE_en.md): source and sync conventions for loading the unpacked bridge via `chrome://extensions`.
- [FAQ](getting-started/FAQ_GUIDE_en.md): first launch, trigger words, and tool-result delivery.
- [Build guide](getting-started/BUILD_GUIDE_en.md): prerequisites, source build, packaging, and local installation.

## Guides

See the [guides index](guides/index.md).

- [MCP configuration guide](guides/MCP_GUIDE_en.md): configure third-party MCP servers.
- [Skills guide](guides/SKILLS_GUIDE_en.md): discovery and use of workspace Skills.
- [Site support guide](guides/PLATFORM_GUIDE_en.md): add a built-in AI site or configure a custom site.

## Reference

See the [reference index](reference/index.md).

- [Built-in tools reference](reference/BUILTIN_TOOLS_en.md): Gateway, bootstrap, and browser-side tools.
- [read_file design](reference/READ_FILE_GUIDE.md) (Chinese only)
- [Search tools design](reference/SEARCH_TOOLS_GUIDE.md) (Chinese only)
- [Terminal tools design](reference/RUN_IN_TERMINAL_GUIDE.md) (Chinese only)
- [Dependency audit exemptions](reference/DEPENDENCY_AUDIT_EXEMPTIONS.md) (Chinese only): accepted advisories with rationale and review dates.
- [Terminology](reference/terminology.md) (Chinese only): canonical wording, register split, and scope decisions.

## Architecture

See the [architecture index](architecture/index.md).

- [Platform prompt guide](architecture/PLATFORM_PROMPT_GUIDE.md): implementation notes for platform-specific prompts (Chinese only).

## Plans and Reports

See the [plans index](plans/index.md) and the [dependency remediation chain](plans/dependency/index.md) (Chinese only).

- [UI and interaction development plan](plans/UI_UX_DEVELOPMENT_PLAN.md) (Chinese): scope, phases, baseline, acceptance, rollback, and Rust re-evaluation triggers.
- [UI modernization plan](plans/UI_MODERNIZATION_PLAN.md) (Chinese): token and primitive layers, performance budget, and per-surface rollout, including the R1-R13 record.
- [Engineering review remediation plan](plans/ENGINEERING_REVIEW_REMEDIATION_PLAN.md) (Chinese): batched rollout for tool-call timeouts, concurrency backpressure, and hot-path optimization for search and file reads.
- [Dependency hardening plan](plans/dependency/DEPENDENCY_HARDENING_PLAN.md) (Chinese): audit findings, shipped-versus-buildtime split, red-team review, and phased remediation.
- [Dependency remediation plan (2026-10)](plans/dependency/DEPENDENCY_REMEDIATION_PLAN_2026_10.md) (Chinese): CI and dependency status checks, Dependabot grouping gaps, constrained overrides, and the audit-blind-spot fix plan.
- [Dependency remediation report (2026-10-24)](plans/dependency/DEPENDENCY_REMEDIATION_REPORT_2026_10_24.md) (Chinese): three rounds of Dependabot fixes, constrained overrides, audit-blind-spot coverage, and remaining items.

## Archive and Agent Workflow

See [archived documents](archive/README.md) (Chinese): superseded documents and what replaced them.

- [UI/UX development Agent Skill](../.codex/skills/ui-ux-development/SKILL.md) (Chinese): workflow for future UI implementation tasks.

## Related Entries

See the [root README](../README_en.md) for project setup and development commands, and the [Evals README](../evals/README_en.md) for evaluation workflows.
