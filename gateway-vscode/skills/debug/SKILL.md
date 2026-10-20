---
name: debug
description: Diagnose a reproducible software failure by tracing evidence to its controlling code path, testing a narrow hypothesis, and verifying the smallest repair. Use for bugs, failing tests, unexpected runtime behavior, or stack traces.
---

# Debug

## Workflow

1. Capture the exact symptom, expected behavior, reproduction steps, environment, and relevant error output. Separate observed facts from assumptions.
2. Trace the failing call path to the code that directly computes or controls the behavior. Read the nearest tests and callers; avoid broad exploration once the controlling path is clear.
3. State one falsifiable hypothesis and one low-cost check that could disprove it. Run that check before editing when possible.
4. Make the smallest repair at the cause. Preserve unrelated work and existing public behavior. Do not suppress errors or weaken security checks to make a failure disappear.
5. Run the narrowest relevant test or build immediately. If it fails, use the new evidence to repair the same slice and rerun it.
6. Report the verified cause, changed behavior, checks actually run, and remaining uncertainty. Never claim a test passed unless its result was observed.
