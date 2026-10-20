<p align="center">
  <img src="doc/assets/webcode-logo.png" width="220" alt="webcode logo">
</p>

<h1 align="center">webcode</h1>

<p align="center">
  <strong>Local coding capabilities for web AI.</strong>
</p>

<p align="center">
  Through a VS Code extension and browser extension, webcode breaks the boundary between web AI and local projects, connecting ChatGPT, Gemini, DeepSeek, and other web AI products to local VS Code with file access, command execution, and MCP and Skills support.
</p>

<p align="center">
  English | <a href="README.md">中文</a>
</p>

<p align="center">
  <a href="https://github.com/three-water666/webcode/actions/workflows/release.yml">
    <img alt="release workflow" src="https://img.shields.io/github/actions/workflow/status/three-water666/webcode/release.yml?label=release&color=22c55e">
  </a>
  <img alt="browser bridge version" src="https://img.shields.io/github/package-json/v/three-water666/webcode?filename=bridge-browser%2Fpackage.json&label=bridge&color=f97316">
  <a href="LICENSE">
    <img alt="license MIT" src="https://img.shields.io/badge/license-MIT-16a34a">
  </a>
</p>

---

<p align="center">
  <img src="doc/assets/webcode-usage-screenshot.png" width="960" alt="webcode usage screenshot">
</p>

## What webcode does

- Lets web AI use local file, search, and command tools, with user approval where required.
- Connects a VS Code extension and browser bridge through a local Gateway.
- Exposes third-party MCP servers and workspace Skills to web AI.
- Supports built-in AI sites and user-defined site settings.

## Documentation

| Topic | Guide |
| ------ | ------ |
| Build, development, and feature guides | [Documentation index](doc/README_en.md) |
| Browser modes | [Browser mode guide](doc/BROWSER_MODE_GUIDE_en.md) |
| Built-in tools | [Built-in tools reference](doc/BUILTIN_TOOLS_en.md) |
| MCP configuration | [MCP configuration guide](doc/MCP_GUIDE_en.md) |
| Site support | [Site support guide](doc/PLATFORM_GUIDE_en.md) |
| Troubleshooting | [FAQ](doc/FAQ_GUIDE_en.md) |
| Development and contributions | [Contributing guide](CONTRIBUTING.md) |

Language versions: [中文](README.md).

## Examples

### DeepSeek Web: The Pelican Test

This SVG was generated in the recorded demo using the DeepSeek web app connected through webcode. The task is to draw a pelican riding a bicycle, also known as the "pelican test."

Prompt:

> Generate an SVG of a pelican riding a bicycle.

**Demo (1.5× speed)**

https://github.com/user-attachments/assets/448873b4-922a-4cac-b421-70a189394576

**Generated result**

<p align="center">
  <img src="doc/assets/pelican-bicycle-deepseek.svg" width="560" alt="SVG of a pelican riding a bicycle, generated using webcode and the DeepSeek web app">
</p>

[View the SVG source file](doc/assets/pelican-bicycle-deepseek.svg)

## Install and Quick Start

### 1. Install the VS Code Extension

1. Open the VS Code Marketplace from the Extensions view.
2. Search for `webcode gateway`.
3. Install the extension.

### 2. Start the Gateway

1. Open a folder or workspace in VS Code.
2. Click `webcode: OFF` in the bottom-right status bar of VS Code.

   ![webcode OFF button in the VS Code status bar](doc/assets/webcode-status-bar-off.png)

3. In the menu that opens, click `Start webcode`.
4. Wait for the status bar item to change to `webcode: <port>`.

When the status bar shows a port number, the local gateway is running.

### 3. Open a Supported AI Product

1. Choose the target site in the launch menu, such as `Open ChatGPT` or another supported entry.
2. webcode opens Microsoft Edge in [`Edge Isolated Keepalive`](doc/BROWSER_MODE_GUIDE_en.md) mode by default.
3. The isolated Edge profile auto-loads the bundled webcode bridge extension.
4. The bridge page completes the handshake with the local gateway automatically.
5. After the handshake succeeds, the browser redirects to the target AI site.

On first use, sign in to the target AI site once in the isolated Edge profile. When the bridge extension shows `ON`, the connection is ready to use.

### 4. Use It in Chat

1. Open a new chat on the target AI site.
2. Enter your actual task first, then add `/webcode` or `@webcode` at the end of the same message, or press Enter directly.
3. When webcode asks whether to add the initialization context, choose `Add` or press Enter.
4. webcode replaces the trigger word with the full initialization context. Review the message, then send it yourself.

If the initialization context exceeds the current AI site's input limit, webcode first attaches the full context as a txt file and keeps a short instruction in the input box.

For example:

- `Read src/utils.ts and write a unit test for it. /webcode`
- `List the files in the current workspace. @webcode`
- `Create project docs under the docs directory. /webcode`

## Built-in Tools

webcode includes built-in local tools such as `read_file`, `attach_file`, `write_file`, `edit_file`, `search_files`, `search_code`, `execute_command`, `run_in_terminal`, and `terminal_session` for text reads, TXT/image/PDF attachment delivery, file writes, code search, command execution, and terminal session management.

See the [built-in tools reference](doc/BUILTIN_TOOLS_en.md).

## MCP

Use `webcodeGateway.servers` when you want to attach third-party MCP servers for browser automation, GitHub, databases, or other external capabilities.

See the [MCP server configuration guide](doc/MCP_GUIDE_en.md).

## Skills

webcode can expose local Skills from the current VS Code workspace so the web AI can load project workflows, templates, domain notes, or script resources on demand.

See the [Skills guide](doc/SKILLS_GUIDE_en.md).

## Project Rules

During initialization, webcode reads project rule files from the root of the primary VS Code workspace and sends them with the initialization result:

- `USER_RULES.md`
- `AGENTS.md` or `CLAUDE.md`

If both `AGENTS.md` and `CLAUDE.md` exist, only `AGENTS.md` is sent. The browser extension no longer has a separate custom-instructions settings page.

## Configuration

VS Code settings use the `webcodeGateway.*` namespace. See the [site support guide](doc/PLATFORM_GUIDE_en.md) for site settings, the [MCP guide](doc/MCP_GUIDE_en.md) for server configuration, and the [browser mode guide](doc/BROWSER_MODE_GUIDE_en.md) for browser selection.

## Currently Supported AI Platforms and Additional Platform Support

webcode currently includes built-in support for the following AI platforms:

- ChatGPT
- Gemini
- Google AI Studio
- DeepSeek
- GLM
- Claude
- Qwen

To support other platforms, you can add new sites through VS Code configuration. Stable platforms can be added as built-in sites; experimental or private sites usually only need `webcodeGateway.aiSites`.

See the [site support guide](doc/PLATFORM_GUIDE_en.md).

## Build From Source

See the [build guide](doc/BUILD_GUIDE_en.md) for repository checkout, dependency installation, packaging scripts, artifacts, and local installation.

## FAQ

See the [FAQ guide](doc/FAQ_GUIDE_en.md) for first-launch setup, trigger-word issues, tool calls that executed but did not update the page, and tool-call history logs.

## Project Structure

- `gateway-vscode/`: VS Code extension, Gateway, MCP, and local tools.
- `bridge-browser/`: browser extension and page-bridge logic.
- `shared/`: types and logic shared across workspace packages.
- `evals/`: unit evaluations, end-to-end scenarios, and QA scripts.
- `doc/`: user, build, and development guides.

## Development and Tests

Requires Node.js 22 and pnpm 10.25.0. From the repository root:

```bash
pnpm install
pnpm --filter @webcode/shared run build
pnpm build
pnpm test
pnpm test:extension
pnpm lint
```

See the [build guide](doc/BUILD_GUIDE_en.md) and [documentation index](doc/README_en.md) for command scope and browser end-to-end testing.

## Contributing

Issues and pull requests are welcome. Read the [contributing guide](CONTRIBUTING.md) before opening a pull request. For security reports, see [SECURITY.md](SECURITY.md). The code of conduct is still a draft pending maintainer review: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Acknowledgments

Thanks to the [LINUX DO](https://linux.do/) community for providing a platform for technical discussions and open-source sharing.

## License

This repository is licensed under the MIT License. See [LICENSE](LICENSE).
