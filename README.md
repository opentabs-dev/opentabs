<div align="center">

<a href="https://opentabs.dev">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme-banner-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/readme-banner-light.svg">
    <img alt="OpenTabs" src="assets/readme-banner-light.svg" width="600">
  </picture>
</a>

<br>

[Website](https://opentabs.dev) &nbsp;&middot;&nbsp; [Docs](https://opentabs.dev/docs) &nbsp;&middot;&nbsp; [Plugins](plugins/) &nbsp;&middot;&nbsp; [Discord](https://discord.gg/opentabs)

<br>

[![npm version](https://img.shields.io/npm/v/@opentabs-dev/cli?style=flat-square&color=FFDB33)](https://www.npmjs.com/package/@opentabs-dev/cli)
[![License: MIT](https://img.shields.io/github/license/opentabs-dev/opentabs?style=flat-square&color=FFDB33)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/opentabs-dev/opentabs?style=flat-square&color=FFDB33)](https://github.com/opentabs-dev/opentabs/stargazers)

</div>

---

**Browser automation clicks buttons. OpenTabs calls APIs.**

Playwright, Puppeteer, and Stagehand simulate a human — click, type, read the screen. OpenTabs skips all that. It calls the same internal APIs the web app's own frontend calls, through your browser, using your existing session. Exposed as [MCP tools](https://modelcontextprotocol.io/).

No screenshots. No DOM scraping. No pixel-guessing.

<figure>
  <img src="assets/demo-hero.gif" alt="Demo: AI checks stocks, orders Panda Express, and sends a Discord message — all through the browser" />
  <figcaption><p align="center"><sub>AI checking Robinhood, ordering Panda Express, and messaging on Discord — all through open browser tabs</sub></p></figcaption>
</figure>

---

## Quick Start

You need [Node.js](https://nodejs.org/) 22+ and Chrome.

```bash
npm install -g @opentabs-dev/cli
opentabs start
```

First run prints MCP config blocks you can paste into [Claude Code](https://github.com/anthropics/claude-code), Cursor, or Windsurf.
Load the extension from `~/.opentabs/extension` via `chrome://extensions/` (Developer mode → Load unpacked).

```bash
opentabs plugin install <plugin-name>
```

Five minutes, start to finish. See the [Quick Start guide](https://opentabs.dev/docs/quick-start).

## 100+ Plugins, ~2,000 Tools

`discord_send_message` hits Discord's real backend — fast, deterministic, cheap on tokens.

Slack, Discord, GitHub, Jira, Notion, Figma, AWS, Stripe, Robinhood, Panda Express, Airbnb, and [a lot more](plugins/). Plus built-in browser tools (screenshots, clicking, typing, network capture) that work on any tab without a plugin.

## Build a Plugin

Point your AI at any website. It analyzes the page, discovers the APIs, scaffolds the code, and registers it.

```bash
opentabs plugin create my-app --domain .example.com
cd my-app && npm install && npm run build
```

Publish to npm and anyone can `opentabs plugin install` it. See the [Plugin Development guide](https://opentabs.dev/docs/guides/plugin-development).

## Security

- **Everything starts off.** Every plugin is disabled by default — not "ask," actually off.
- **AI-assisted code review.** Your AI reviews the adapter source before you enable it.
- **Version-aware.** When a plugin updates, permissions reset. New code, new review.
- **Three permission levels.** Off, Ask (confirmation dialog), or Auto. Per-plugin or per-tool.
- **Runs locally.** No cloud. Everything in `~/.opentabs/`. Full audit log. Anonymous [telemetry](https://opentabs.dev/docs/reference/telemetry) (opt-out).

## How This Was Built

Built entirely by AI agents — zero hand-written application code. Hundreds of PRDs executed by [Claude Code](https://github.com/anthropics/claude-code) workers via [Ralph](https://github.com/snarktank/ralph). Every PRD is open-sourced: **[opentabs-dev/opentabs-prds](https://github.com/opentabs-dev/opentabs-prds)**.

---

**[Docs](https://opentabs.dev/docs)** &nbsp;&middot;&nbsp; [Quick Start](https://opentabs.dev/docs/quick-start) &nbsp;&middot;&nbsp; [Plugin Development](https://opentabs.dev/docs/guides/plugin-development) &nbsp;&middot;&nbsp; [SDK Reference](https://opentabs.dev/docs/sdk/plugin-class) &nbsp;&middot;&nbsp; [Browser Tools](https://opentabs.dev/docs/reference/browser-tools) &nbsp;&middot;&nbsp; [CLI Reference](https://opentabs.dev/docs/reference/cli) &nbsp;&middot;&nbsp; [Architecture](https://opentabs.dev/docs/contributing/architecture)

## Contributing

```bash
git clone https://github.com/opentabs-dev/opentabs.git
cd opentabs && npm install && npm run build
npm run dev       # tsc watch + MCP server + extension
npm run check     # build + type-check + lint + knip + test
```

See the [Development Setup guide](https://opentabs.dev/docs/contributing/dev-setup).

## License

[MIT](LICENSE) — Not affiliated with or endorsed by any third-party service. See the [full disclaimer](https://opentabs.dev/docs/legal/disclaimer).

&nbsp;

<p align="center"><sub>Built with <a href="https://github.com/anthropics/claude-code">Claude Code</a>, <a href="https://github.com/anomalyco/opencode">OpenCode</a>, <a href="https://github.com/snarktank/ralph">Ralph</a>, and <a href="https://github.com/Logging-Studio/RetroUI">RetroUI</a>.</sub></p>
