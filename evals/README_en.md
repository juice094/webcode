# webcode Evals

Language: English | [中文](README.md)

This package contains product-flow end-to-end tests, agent evaluations, and live-site acceptance assets. It is not included in release artifacts.

## Evaluation Layers

- **Contract E2E** uses a local simulated AI page to verify the browser DOM, bridge, Gateway, and workspace flow without a real model.
- **Agent Eval** checks whether an agent can complete repository tasks such as reading code, fixing bugs, writing tests, using MCP, and following Skills.
- **Live-site Smoke** checks compatibility with real AI sites, including selectors, response capture, result delivery, and sending behavior. Account access, rate limits, and site changes make this a manual or semi-automated release check.

## Current Status

Deterministic minimal E2E and command-risk approval scenarios are available. Real DeepSeek browser runs are available without a model API key. GitHub Actions runs unit tests and VS Code Extension Host tests; the minimal browser E2E, live-site smoke, and baseline comparison are not currently CI gates.

## Commands

Run the deterministic browser flow and command-risk scenario:

```bash
pnpm test:e2e:minimal
pnpm test:e2e:command-risk
```

List and run agent scenarios:

```bash
pnpm eval:scenarios list
pnpm eval:scenarios prepare implement-feature-slugify
pnpm eval:scenarios grade <run-id-or-directory>
```

Run a real DeepSeek browser evaluation:

```bash
pnpm eval:deepseek
pnpm eval:deepseek implement-feature-slugify
```

Live runs use an isolated browser profile and workspace. The first run requires a manual sign-in. Tool calls outside the documented auto-approval allowlist may require user approval. See the Chinese guide for detailed setup, environment variables, artifacts, and QA modes.

## Scenario Structure

Each agent scenario includes a fixture copied into an isolated workspace, a task description, a hidden grader, and reference output used to validate the grader. Skills and MCP scenarios also verify the corresponding tool calls in the Gateway trace.

See [the repository documentation index](../doc/README_en.md) and the [root README](../README_en.md) for project setup and contributor information.
