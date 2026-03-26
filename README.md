# OpenTabs

[![GitHub stars](https://img.shields.io/github/stars/opentabs-dev/opentabs)](https://github.com/opentabs-dev/opentabs/stargazers)
[![npm version](https://img.shields.io/npm/v/@opentabs-dev/cli)](https://www.npmjs.com/package/@opentabs-dev/cli)
[![License: MIT](https://img.shields.io/github/license/opentabs-dev/opentabs)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-22%2B-brightgreen)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)]()
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](https://github.com/opentabs-dev/opentabs/pulls)
[![CI](https://github.com/opentabs-dev/opentabs/actions/workflows/ci.yml/badge.svg)](https://github.com/opentabs-dev/opentabs/actions/workflows/ci.yml)
[![Docs](https://github.com/opentabs-dev/opentabs/actions/workflows/ci-docs.yml/badge.svg)](https://github.com/opentabs-dev/opentabs/actions/workflows/ci-docs.yml)

**This is not another Playwright wrapper.**

Every web app has internal APIs — the same endpoints its own frontend calls. OpenTabs reverse-engineered them and exposed them as [MCP tools](https://modelcontextprotocol.io/) today. Your AI calls the same backend the web app calls — through your browser, using your existing session. No screenshots. No DOM scraping. No pixel-guessing.

<p align="center">
  <img src="assets/demo-hero.gif" alt="Demo: AI checks stocks, orders food, and sends a Discord message — all through the browser" />
</p>

[Watch the full video on YouTube](https://www.youtube.com/watch?v=PBvUXDAGVM8)

`discord_send_message` hits Discord's real backend — fast, deterministic, cheap on tokens. The knowledge gets packaged into a reusable plugin anyone can install.

## How It Works

OpenTabs is two pieces:

1. **An MCP server** that your AI talks to
2. **A Chrome extension** that bridges the gap to your open tabs

Your AI calls a tool → the server routes it to the right tab → the plugin makes the API call using your session → the result flows back. That's the whole loop.

100+ plugins covering ~2,000 tools across Slack, Discord, GitHub, Jira, Notion, Figma, AWS, Stripe, Robinhood, DoorDash, Airbnb, and [a lot more](plugins/). Plus built-in browser tools (screenshots, clicking, typing, network capture, DOM inspection) that work on any tab without a plugin.

Works with [Claude Code](https://github.com/anthropics/claude-code), Cursor, Windsurf, [OpenCode](https://github.com/anomalyco/opencode), and any MCP client that supports Streamable HTTP.

## Quick Start

You need [Node.js](https://nodejs.org/) 22+ and Chrome.

```bash
npm install -g @opentabs-dev/cli
opentabs start
```

First run creates `~/.opentabs/`, generates an auth secret, and prints MCP config blocks you can paste straight into Claude Code or Cursor.

Load the Chrome extension:

1. Open `chrome://extensions/`
2. Turn on **Developer mode**
3. Click **Load unpacked** → select `~/.opentabs/extension`

Install a plugin:

```bash
opentabs plugin install <plugin-name>
```

Five minutes, start to finish.

<p align="center">
  <img src="assets/demo-quick-start-install-uninstall.gif" alt="Demo: Install a plugin and uninstall another — full plugin lifecycle driven by AI" />
</p>

[Watch the full video on YouTube](https://youtu.be/MoBD7DhnEY0)

## Build a Plugin

Point your AI at any website. It builds the plugin — analyzes the page, discovers the APIs, scaffolds the code, registers it. Most of the plugins in this repo were built by AI in minutes.

The MCP server ships with site analysis tools, the SDK handles the boilerplate, and a [self-improving skill](.claude/skills/build-plugin/) teaches AI agents the whole process. **Every time an AI builds a plugin, it writes what it learned back into the skill** — new auth patterns, API quirks, edge cases. The system gets better with every plugin built.

Publish yours and anyone can `opentabs plugin install` it. Keep it local for internal tools. The [Plugin Development guide](https://opentabs.dev/docs/guides/plugin-development) covers both paths.

Or build by hand:

```bash
opentabs plugin create my-app --domain .example.com
cd my-app && npm install
npm run build   # compiles, registers, notifies the running server
```

## Security

I know you're the kind of person who sets `DANGEROUSLY_SKIP_PERMISSIONS=1` the moment something asks for confirmation. I respect that. But your browser sessions are precious, so I wanted the defaults to be thoughtful — even for the fearless.

- **Everything starts off.** Every plugin's tools are disabled by default. Not "ask for confirmation" — actually off. This includes the plugins I ship myself. What if my account gets compromised? What if a dependency gets hijacked? You shouldn't have to trust me blindly either.
- **AI-assisted code review.** When you enable a plugin, the system offers to have your AI review the adapter source code first. It checks for data exfiltration, credential access, persistence mechanisms, and scope escalation. You see the findings, you decide.
- **Version-aware.** When a plugin updates, permissions reset. New code, new review.
- **Three permission levels.** Off (disabled), Ask (confirmation dialog before each call), or Auto (runs immediately). Set per-plugin or per-tool.
- **Runs locally.** No cloud. No telemetry. Everything lives in `~/.opentabs/` on your machine.
- **Full audit log.** Every tool call is logged — what ran, when, whether it succeeded.

The defaults are safe, the controls are in your hands, and the code is open source — [read it](https://opentabs.dev/docs/reference/configuration).

<p align="center">
  <img src="assets/demo-todoist-permissions.gif" alt="Demo: Permission dialog asking for approval before a tool call executes" />
</p>

[Watch the full video on YouTube](https://youtu.be/6CL6kwk8d9w)

## FAQ

**How is this different from browser automation (Playwright, Stagehand, Browser-Use)?**

Browser automation simulates what a human would do — click, type, read the screen. Works on any site out of the box. The cost is speed, tokens, and the knowledge stays trapped in that one session.

OpenTabs plugins call the web app's internal APIs directly. A send-message tool isn't clicking a text box — it's making the same API call the frontend makes. Fast, cheap on tokens, and the knowledge is packaged into a reusable plugin. The downside is you need a plugin per site, and internal APIs can change. If a plugin breaks, open a PR.

**What about Chrome's WebMCP?**

[Chrome's WebMCP](https://developer.chrome.com/blog/webmcp-epp) is the right long-term direction — websites opt in and expose tools to AI agents natively. But adoption depends on every service choosing to participate, and that takes years.

OpenTabs is the proactive version. Instead of waiting, we reverse-engineer the APIs and expose them today. If WebMCP becomes widespread, plugins can evolve to use it — but you don't have to wait.

**2,000 tools? Won't that blow up my context window?**

No. Three connection modes — pick the one that fits. **Full MCP** (`/mcp`) gives you everything upfront. **Gateway** (`/mcp/gateway`) exposes 2 meta-tools and lets your AI discover the rest on demand. **CLI mode** has zero MCP overhead — your AI just calls `opentabs tool call` via shell. Most users enable 3–5 plugins and only those tools load into context. See the [Connection Modes docs](https://opentabs.dev/docs/reference/mcp-server#connection-modes) for details.

**Why not just use official MCP servers?**

If one works well for you, use it. I started building OpenTabs for apps that don't have MCP support — many had none when I began, and some probably never will. Along the way, I noticed: setting up separate API keys or OAuth flows for each service adds up. Public APIs sometimes have stricter rate limits or a smaller feature set. The web app is always the superset.

I see OpenTabs and official servers as complementary. Use whatever fits — or mix and match.

## Architecture

| Package | What it does |
|---------|-------------|
| **MCP Server** | Plugin discovery, tool dispatch, audit log, permissions |
| **Chrome Extension** | Adapter injection, tool relay, side panel UI (Manifest V3) |
| **Plugin SDK** | `OpenTabsPlugin` base class, `defineTool` factory, SDK utilities |
| **Plugin Tools** | Plugin developer CLI (`opentabs-plugin build`) |
| **CLI** | User-facing CLI (`opentabs start`, `opentabs plugin install`, etc.) |
| **Create Plugin** | Scaffolding CLI for new plugin projects |

See [Architecture docs](https://opentabs.dev/docs/contributing/architecture) for the full picture.

## How This Was Built

OpenTabs was built entirely by AI agents. Zero hand-written application code.

I wrote structured PRDs — hundreds of them — and used [Ralph](https://github.com/snarktank/ralph), an autonomous agent loop, to execute them with [Claude Code](https://github.com/anthropics/claude-code). Multiple workers ran in parallel, each claiming a PRD via optimistic locking with `git push`. Every PRD is open-sourced: **[opentabs-dev/opentabs-prds](https://github.com/opentabs-dev/opentabs-prds)**.

## Contributing

I'd love your help. You need [Node.js](https://nodejs.org/) 22+ and Chrome.

```bash
git clone https://github.com/opentabs-dev/opentabs.git
cd opentabs
npm install
npm run build
npm run dev       # tsc watch + MCP server + extension
```

Before committing:

```bash
npm run check     # build + type-check + lint + knip + test
```

See the [Development Setup guide](https://opentabs.dev/docs/contributing/dev-setup) for the full contributor workflow.

## Docs

**[opentabs.dev/docs](https://opentabs.dev/docs)**

- [Quick Start](https://opentabs.dev/docs/quick-start) — install to first tool call in five minutes
- [Plugin Development](https://opentabs.dev/docs/guides/plugin-development) — build a plugin from scratch
- [SDK Reference](https://opentabs.dev/docs/sdk/plugin-class) — plugin class, tools, and utilities
- [Browser Tools](https://opentabs.dev/docs/reference/browser-tools) — built-in tools for any tab
- [CLI Reference](https://opentabs.dev/docs/reference/cli) — every command
- [Architecture](https://opentabs.dev/docs/contributing/architecture) — how it all fits together

This project wouldn't exist without [Claude Code](https://github.com/anthropics/claude-code), [OpenCode](https://github.com/anomalyco/opencode), [Ralph](https://github.com/snarktank/ralph), and [RetroUI](https://github.com/Logging-Studio/RetroUI). Genuinely grateful for all of them.

## Star History

<a href="https://star-history.com/#opentabs-dev/opentabs&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=opentabs-dev/opentabs&amp;type=Date&amp;theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=opentabs-dev/opentabs&amp;type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=opentabs-dev/opentabs&amp;type=Date" />
 </picture>
</a>

## Disclaimer

OpenTabs is an independent open-source project. It is **not affiliated with, endorsed by, or sponsored by** any of the third-party services it integrates with. All product names, logos, trademarks, and registered trademarks are the property of their respective owners. Use of these names in plugin identifiers is for identification purposes only and does not imply any association or endorsement.

This software interacts with third-party web applications using your existing authenticated browser sessions. **You are responsible for ensuring your use of OpenTabs complies with the terms of service of any third-party platforms you connect to.** The authors and contributors are not responsible for any unintended actions, data loss, account restrictions, or other consequences that may result from using this tool.

This software is provided "as is", without warranty of any kind. See the [MIT License](LICENSE) for the full terms.

## License

[MIT](LICENSE)
