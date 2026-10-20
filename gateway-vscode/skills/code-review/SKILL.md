---
name: code-review
description: Review a proposed diff for actionable correctness bugs, regressions, security risks, and missing tests. Use when asked to review code or assess a change; do not modify files unless asked.
---

# Code Review

## Workflow

1. Read the full diff and directly related implementation, callers, tests, and repository instructions. Treat uncommitted user changes as intentional.
2. Trace changed behavior across relevant boundaries, including error handling, permissions, state transitions, and resource cleanup.
3. Report actionable findings first, ordered by severity, with file/line references, trigger conditions, and user impact.
4. Distinguish verified defects from assumptions. Do not report style preferences as bugs or repeat concerns without evidence.
5. Check whether tests cover changed behavior and important failure paths. State test gaps separately when they are not findings.
6. If no actionable issue is found, say so and identify meaningful residual risks or unrun checks. Do not edit reviewed files unless remediation is requested.
