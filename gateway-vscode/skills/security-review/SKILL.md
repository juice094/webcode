---
name: security-review
description: Review code or design for trust-boundary failures involving authentication, authorization, command execution, file paths, secrets, external services, or sensitive data. Use for security reviews and threat-model checks.
---

# Security Review

## Workflow

1. Define assets, actors, trust boundaries, entry points, and assumptions from code and user context. Mark missing deployment facts as unknown.
2. Trace untrusted input through parsing, validation, authorization, execution, storage, and output. Check path containment, command construction, token/session lifetime, approval scope, and logging.
3. Verify controls at enforcement points and inspect tests for bypass, malformed input, expiry, and cross-boundary cases. Do not infer protection from UI checks alone.
4. Report concrete findings with severity, preconditions, impact, and a safe remediation direction. Separate verified issues from threat-model gaps and assumptions.
5. Avoid destructive proof-of-concept actions or exposing secrets. Do not claim a system is secure based on a code review alone; state scope and residual risk.
