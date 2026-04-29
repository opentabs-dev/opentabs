[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/opentabs-dev-opentabs-badge.png)](https://mseep.ai/app/opentabs-dev-opentabs)

<div align="center">

<a href="https://opentabs.dev">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme-banner-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/readme-banner-light.svg">
    <img alt="OpenTabs" src="assets/readme-banner-light.svg" width="600">
  </picture>
</a>

<br>

[![npm version](https://img.shields.io/npm/v/@opentabs-dev/cli?style=flat-square&color=FFDB33)](https://www.npmjs.com/package/@opentabs-dev/cli)
[![License: MIT](https://img.shields.io/github/license/opentabs-dev/opentabs?style=flat-square&color=FFDB33)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/opentabs-dev/opentabs?style=flat-square&color=FFDB33)](https://github.com/opentabs-dev/opentabs/stargazers)

[Docs](https://opentabs.dev/docs) &nbsp;&middot;&nbsp; [Plugins](plugins/) &nbsp;&middot;&nbsp; [Discord](https://discord.gg/b8Hjpz4B)

</div>

<br>

Your AI calls real web APIs through your browser session — no screenshots, no DOM scraping.

<p align="center">
  <br>
  <img src="assets/demo-hero.gif" alt="Demo: AI sends a Discord message and adds reactions through real API calls" />
  <br>
  <sub>AI sending a Discord message and adding reactions — real API calls, not browser automation</sub>
  <br><br>
</p>

## How It Works

1. **Install** the CLI and load the Chrome extension
2. **Connect** — the extension bridges your browser to a local server
3. **Use** — your AI calls web APIs through your authenticated session

No API keys. No OAuth setup. If you're logged in, your AI can use it.

Works with any [MCP](https://modelcontextprotocol.io/) client. Don't want MCP? Use [CLI mode](https://opentabs.dev/docs/reference/mcp-server#cli-mode) instead.

## Quick Start

Requires [Node.js](https://nodejs.org/) 22+ and Chrome.

```bash
npm install -g @opentabs-dev/cli
opentabs start
```

Load the extension from `~/.opentabs/extension` in `chrome://extensions/` (Developer mode → Load unpacked).

```bash
opentabs plugin install <plugin-name>
```

Full walkthrough: [Quick Start guide](https://opentabs.dev/docs/quick-start)

## What You Get

- **100+ plugins, ~2,000 tools.** Slack, Discord, GitHub, Jira, Notion, Figma, AWS, Stripe, and [a lot more](plugins/). One command to install, works immediately.

- **Built-in browser tools.** Screenshots, clicking, typing, network capture — works on any tab, no plugin needed.

- **Build your own.** Scaffold a plugin in one command, publish to npm, anyone can install it. Or point your AI at any website — it discovers the APIs and builds the plugin for you. [Plugin Development guide](https://opentabs.dev/docs/guides/plugin-development)

<p align="center">
  <br>
  <img src="assets/demo-install-plugin.gif" alt="Demo: installing a Reddit plugin and immediately using it to create a post" />
  <br>
  <sub>Install a plugin, use it immediately — no restart needed</sub>
  <br><br>
</p>

## Security

- **Everything starts off.** No tool executes until you explicitly enable it.
- **Code review built in.** Your AI reviews the plugin source before you enable it.
- **Version-aware.** Permissions reset when a plugin updates.
- **Three permission levels.** Off, Ask (confirmation dialog), or Auto — per-plugin or per-tool.
- **Runs locally.** No cloud. Full audit log. Anonymous [telemetry](https://opentabs.dev/docs/reference/telemetry) (opt-out).

## Contributing

```bash
git clone https://github.com/opentabs-dev/opentabs.git
cd opentabs && npm install && npm run build
npm run dev       # tsc watch + MCP server + extension
npm run check     # build + type-check + lint + knip + test
```

[Development Setup guide](https://opentabs.dev/docs/contributing/dev-setup) &nbsp;&middot;&nbsp; [Discord](https://discord.gg/b8Hjpz4B)

## License

[MIT](LICENSE) — Not affiliated with or endorsed by any third-party service. [Full disclaimer](DISCLAIMER.md).

---

<p align="center">
  <a href="https://opentabs.dev/docs"><strong>Docs</strong></a> &nbsp;&middot;&nbsp;
  <a href="https://opentabs.dev/docs/quick-start">Quick Start</a> &nbsp;&middot;&nbsp;
  <a href="https://opentabs.dev/docs/guides/plugin-development">Plugin Development</a> &nbsp;&middot;&nbsp;
  <a href="https://opentabs.dev/docs/sdk/plugin-class">SDK Reference</a> &nbsp;&middot;&nbsp;
  <a href="https://opentabs.dev/docs/reference/browser-tools">Browser Tools</a> &nbsp;&middot;&nbsp;
  <a href="https://opentabs.dev/docs/reference/cli">CLI Reference</a>
</p>

<p align="center"><sub>Built with <a href="https://github.com/anthropics/claude-code">Claude Code</a>, <a href="https://github.com/anomalyco/opencode">OpenCode</a>, <a href="https://github.com/snarktank/ralph">Ralph</a>, and <a href="https://github.com/Logging-Studio/RetroUI">RetroUI</a>.</sub></p>
