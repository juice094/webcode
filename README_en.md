<p align="center">
  <img src="doc/assets/webcode-logo.png" width="150" alt="webcode logo">
</p>

<h1 align="center">webcode</h1>

<p align="center"><strong>Bring web AI into your local project.</strong></p>

<p align="center">
  Connect web AI to your local workspace through a VS Code extension and browser bridge, with tools for files, search, commands, MCP, and Skills.
</p>

<p align="center">
  <a href="README.md">中文</a> ·
  <a href="doc/README_en.md">Documentation</a> ·
  <a href="CONTRIBUTING.md">Contribute</a> ·
  <a href="SUPPORT.md">Support</a>
</p>

<p align="center">
  <a href="https://github.com/juice094/webcode/actions/workflows/release.yml">
    <img alt="release workflow" src="https://img.shields.io/github/actions/workflow/status/juice094/webcode/release.yml?label=release&color=22c55e">
  </a>
  <img alt="browser bridge version" src="https://img.shields.io/github/package-json/v/juice094/webcode?filename=bridge-browser%2Fpackage.json&label=bridge&color=f97316">
  <a href="LICENSE">
    <img alt="MIT license" src="https://img.shields.io/badge/license-MIT-16a34a">
  </a>
  <img alt="VS Code engine" src="https://img.shields.io/badge/VS%20Code-%5E1.106.1-007ACC">
</p>

<p align="center">
  <img src="doc/assets/webcode-usage-screenshot.png" width="960" alt="webcode in use">
</p>

## What webcode does

- **Local coding tools:** Read and edit files, search code, and run commands, with user approval where required.
- **Browser bridge:** Start a local Gateway from VS Code and connect it to supported web AI sites.
- **Extensible capabilities:** Connect third-party services through MCP and expose workspace Skills and project rules.

## Quick Start

1. Install `webcode gateway` from the VS Code Marketplace.
2. Open a project folder in VS Code. Click `webcode: OFF` in the status bar and choose **Start webcode**.
3. Select an AI site from the launch menu. By default, webcode opens [Edge Isolated Keepalive](doc/getting-started/BROWSER_MODE_GUIDE_en.md); sign in to the AI site in that isolated profile on first use.
4. In a new chat, enter your task and add `/webcode` or `@webcode` at the end. Review the initialization context and send it yourself.

The connection is ready when the bridge shows `ON`. If the initialization context exceeds the site's input limit, webcode attaches the full context as a TXT file.

## Run from source

Requires Node.js 22 and pnpm 10.25.0. From the repository root:

```bash
pnpm install
pnpm --filter @webcode/shared run build
pnpm build
```

To package the VSIX and the browser extension, see the [build guide](doc/getting-started/BUILD_GUIDE_en.md).

## Tech stack

| Layer | Stack | Notes |
| ------ | ------ | ------ |
| VS Code extension | TypeScript, webpack | `engines.vscode` is `^1.106.1`; bundles to a single `dist/extension.js` |
| Browser extension | TypeScript, Vite 5, `@crxjs/vite-plugin` 2.4.0 | Includes a `MAIN` world content script; requires Chromium 111 or newer |
| Shared package | TypeScript (`tsc`) | `@webcode/shared`: protocol constants and cross-package types |
| Runtime dependencies | Express, cors, zod, MCP SDK | Local Gateway and third-party MCP integration |
| Tooling | pnpm 10.25.0 workspace, Node.js 22 | Three-package monorepo |

## Example

The “pelican test” uses webcode with DeepSeek to generate an SVG of a pelican riding a bicycle.

- [Watch the demo (1.5×)](https://github.com/user-attachments/assets/448873b4-922a-4cac-b421-70a189394576)
- [View the generated SVG](doc/assets/pelican-bicycle-deepseek.svg)

## Capabilities and Configuration

| Capability | Details |
| ------ | ------ |
| Built-in tools | File access, attachments, code search, commands, and terminal sessions in the [tools reference](doc/reference/BUILTIN_TOOLS_en.md). |
| MCP | Configure third-party services with `webcodeGateway.servers`; see the [MCP guide](doc/guides/MCP_GUIDE_en.md). |
| Skills | Expose workspace Skills and use built-in developer Skills; see the [Skills guide](doc/guides/SKILLS_GUIDE_en.md). |
| AI sites | Built-in support for ChatGPT, Gemini, Google AI Studio, DeepSeek, GLM, Claude, and Qwen. Add or override sites using VS Code settings; see the [site support guide](doc/guides/PLATFORM_GUIDE_en.md). |
| Project rules | Initialization reads root `USER_RULES.md` and `AGENTS.md` or `CLAUDE.md`. If both agent files exist, `AGENTS.md` takes precedence. |

## Documentation

- [Documentation index](doc/README_en.md): full index grouped into getting started, guides, reference, architecture, and plans.
- [Build guide](doc/getting-started/BUILD_GUIDE_en.md): source build, packaging, and local installation.
- [FAQ](doc/getting-started/FAQ_GUIDE_en.md): first launch, trigger words, and tool-result delivery.
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md) · [Support](SUPPORT.md)

## Development and Tests

Requires Node.js 22 and pnpm 10.25.0. Run from the repository root:

```bash
pnpm install
pnpm --filter @webcode/shared run build
pnpm build
pnpm test
pnpm test:extension
pnpm lint
```

Browser end-to-end tests and interactive QA are documented in the [Evals README](evals/README_en.md).

## Project Structure

| Directory | Contents |
| ------ | ------ |
| `gateway-vscode/` | VS Code extension, Gateway, MCP, and local tools |
| `bridge-browser/` | Browser extension and page bridge |
| `shared/` | Types and logic shared across packages |
| `evals/` | End-to-end scenarios, agent evaluations, and QA |
| `doc/` | User, build, and development documentation |

## Contributing

Issues and pull requests are welcome. Read the [contributing guide](CONTRIBUTING.md) before opening a PR. For security reports, see [SECURITY.md](SECURITY.md). The [code of conduct](CODE_OF_CONDUCT.md) is a draft pending maintainer review.

## Provenance

This project originated from [three-water666/webcode](https://github.com/three-water666/webcode). The original author has stopped maintaining it, and it is now independently maintained at [juice094/webcode](https://github.com/juice094/webcode). Ongoing development, releases, and issue reports all happen there.

## License

This repository is licensed under the [MIT License](LICENSE). Original copyright belongs to three-water666. Thanks to the [LINUX DO](https://linux.do/) community for supporting technical discussion and open-source sharing.
