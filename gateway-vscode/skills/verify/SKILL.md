---
name: verify
description: Select and run the smallest useful verification for a code or documentation change, then expand only for meaningful integration risks. Use before reporting implementation complete or test status.
---

# Verify Changes

## Workflow

1. Identify changed files and the behavior or contract each change affects. Inspect repository scripts and instructions instead of guessing commands.
2. Run the cheapest check that can falsify the change: a focused test, typecheck, lint, build, link check, or schema validation.
3. For cross-module or user-facing changes, add the nearest integration or Extension Host check. Use browser E2E only when the changed flow warrants it.
4. Keep interactive QA separate from deterministic tests. Start browser-driven QA only with explicit user authorization and use the project's isolated QA workflow.
5. If a command fails, preserve its output, determine whether it is caused by the change, and do not hide failures with retries that omit evidence.
6. Report commands and outcomes precisely. Label unavailable, skipped, or unverified criteria; do not infer success from a build or unrelated passing test.
