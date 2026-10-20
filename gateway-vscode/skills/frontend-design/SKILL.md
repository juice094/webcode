---
name: frontend-design
description: Design or improve a web UI within its existing framework and visual system, with attention to task flow, responsive behavior, accessibility, and measurable performance. Use for frontend pages, components, browser extension UI, or interaction redesign.
---

# Frontend Design

## Workflow

1. Identify target users, primary task, UI surface, framework, design system, and supported viewports from the repository or user input. Mark missing product context as unknown.
2. Inspect existing components, tokens, and interaction patterns. Preserve established conventions; do not introduce a framework or component library without a demonstrated need.
3. Design the shortest clear task path, including loading, empty, error, success, and recovery states. Use semantic controls and visible focus; support keyboard completion and screen-reader labels.
4. Check text and control contrast, zoom/reflow, narrow layouts, long content, and reduced-motion behavior. Do not rely on color alone to communicate state.
5. Measure relevant task and rendering behavior against a reproducible baseline before claiming improvement. Do not invent user metrics or performance budgets.
6. Implement a focused slice, validate at representative viewports and with project tests, and report accessibility checks and unverified states.
