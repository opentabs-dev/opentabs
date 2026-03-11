# OpenTabs

**Your browser is already logged in. Let your AI use it.**

<p align="center">
  <a href="https://www.youtube.com/watch?v=PBvUXDAGVM8">
    <img src="https://img.youtube.com/vi/PBvUXDAGVM8/maxresdefault.jpg" alt="Demo: AI checks stocks, orders food, and sends a Discord message — all through the browser" />
  </a>
</p>

Every web app has internal APIs — the same endpoints its own frontend calls. I asked Claude to reverse-engineer them and expose them as [MCP tools](https://modelcontextprotocol.io/) so your AI agent can call them directly.

No screenshots. No DOM scraping. No pixel-guessing. Your AI calls `discord_send_message` and it hits the same backend Discord's web app uses — running in your browser, using your existing session. It's fast, cheap on tokens (tokens are money), and the knowledge gets packaged into a reusable plugin anyone can install.

## How It Works

Those internal APIs need to run inside your browser — that's where your sessions live. So OpenTabs is two pieces:

1. **An MCP server** that your AI talks to
2. **A Chrome extension** that bridges the gap to your open tabs

When your AI calls a tool, the server routes it to the right tab, the plugin makes the API call using your session, and the result flows back. That's the whole loop.

There are 100+ plugins covering ~2,000 tools across Slack, Discord, GitHub, Jira, Notion, Figma, AWS, Stripe, Robinhood, DoorDash, Airbnb, Netflix — and a bunch more. Check the [`plugins/`](plugins/) directory. I built every one of them with end-to-end testing as a requirement in the [build-plugin skill](.claude/skills/build-plugin/), but I'll be honest — I haven't had the resources to manually verify all 2,000 tools. If something's broken, point your AI at it and open a PR. My AI will review what your AI wrote, and we'll merge it together. That's kind of the whole idea.

There are also built-in browser tools (screenshots, clicking, typing, network capture, DOM inspection) that work on any tab without a plugin.

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

That's it. Your AI agent can now talk to the web app. Five minutes, start to finish.

**My honest recommendation:** build your own plugins instead of installing third-party ones. Plugins run in your browser with your logged-in sessions — you should know what the code does. Building a plugin is surprisingly easy (your AI can do it in minutes), and you get to read every line. More on that next.

## Build Your Own Plugins

This is the part I'm most excited about.

Point your AI agent at any website and it'll build a plugin for you — analyze the page, discover the APIs, scaffold the code, register it. Your agent wrote it, you can read every line, and it runs in your browser with your session. That's a pretty good trust model.

Most of the plugins in this repo were built by AI in minutes. The MCP server ships with site analysis tools, the SDK handles the boilerplate, and there's a [build-plugin skill](.claude/skills/build-plugin/) that walks AI agents through the whole process — API discovery, auth extraction, error handling, schema design, testing, and a growing collection of patterns learned from building every plugin in this repo.

Here's what makes it interesting: **every time an AI builds a plugin, it writes what it learned back into the skill.** New auth patterns, new API quirks, new edge cases — they all get folded in. The skill that teaches AI to build plugins gets better with every plugin built. I'd love your help making it even better. If your agent discovers something new, contribute it back.

If you prefer to build by hand:

```bash
opentabs plugin create my-app --domain example.com
cd my-app && npm install
```

Write your tools, build, and the server picks them up:

```bash
npm run build   # compiles, registers, notifies the running server
npm run dev     # watch mode with hot reload
```

Plugins are standalone npm packages. Publish yours and anyone can `opentabs plugin install` it. The [Plugin Development guide](https://opentabs.dev/docs/guides/plugin-development) covers everything.

## Security

I know you're the kind of person who sets `DANGEROUSLY_SKIP_PERMISSIONS=1` the moment something asks for confirmation. I respect that. But your browser sessions are precious, so I wanted the defaults to be thoughtful — even for the fearless.

- **Everything starts off.** Every plugin's tools are disabled by default. Not "ask for confirmation" — actually off. This includes the plugins I ship myself. What if my account gets compromised? What if a dependency gets hijacked? You shouldn't have to trust me blindly either.
- **AI-assisted code review.** When you enable a plugin, the system offers to have your AI review the adapter source code first. It checks for data exfiltration, credential access, persistence mechanisms, and scope escalation. You see the findings, you decide.
- **Version-aware.** When a plugin updates, permissions reset. New code, new review.
- **Three permission levels.** Off (disabled), Ask (confirmation dialog before each call), or Auto (runs immediately). Set per-plugin or per-tool.
- **Runs locally.** No cloud. No telemetry. Everything lives in `~/.opentabs/` on your machine.
- **Full audit log.** Every tool call is logged — what ran, when, whether it succeeded.

I won't pretend this is bulletproof. Browser extensions that interact with your web apps are inherently a trust decision. But the defaults are safe, the controls are in your hands, and the code is open source — [read it](https://opentabs.dev/docs/reference/configuration).

<p align="center">
  <a href="https://youtu.be/6CL6kwk8d9w">
    <img src="https://img.youtube.com/vi/6CL6kwk8d9w/maxresdefault.jpg" alt="Demo: Permission dialog asking for approval before a tool call executes" />
  </a>
</p>

## FAQ

**Why not just use official MCP servers?**

If an official MCP server works well for you, use it. I started building OpenTabs for the apps that *don't* have MCP support — many had none when I began, and some probably never will. Along the way, I also built plugins for apps that do have official servers, partly for learning, partly because I noticed a few things: setting up separate API keys or OAuth flows for each service adds up when you use a dozen of them. Public APIs sometimes have stricter rate limits or a smaller feature set than the web app. And the web app is always the superset — internal APIs, real-time data, features that never make it to the public API.

I see OpenTabs and official servers as complementary. Use whatever fits — or mix and match.

**How is this different from browser automation (Playwright, Stagehand, Browser-Use)?**

Those are great tools. Both approaches have real strengths, and I want to be honest about the tradeoffs.

Browser automation simulates what a human would do — click, type, read the screen. It works on any site out of the box, and that's a real advantage. The cost is speed, tokens, and the knowledge stays trapped in that one session. If a popup appears or the layout changes, the AI figures it out again from scratch.

OpenTabs plugins call the web app's internal APIs directly. A send-message tool isn't clicking a text box — it's making the same API call the web app's frontend makes. Fast, cheap on tokens, and the knowledge is packaged into a reusable plugin. The downside is you need a plugin per site, and internal APIs can change. Some web services are really good at obscuring them (Google Docs, I'm looking at you). If a plugin breaks, open a PR — I want to keep everything working.

**What about Chrome's WebMCP?**

[Chrome's WebMCP](https://developer.chrome.com/blog/webmcp-epp) is a proposal where websites expose structured MCP tools natively in the browser. I think it's a great idea — it's probably how this should work long-term.

The timeline depends on web services choosing to adopt it, and that kind of shift takes a while. WebMCP is in early preview today. OpenTabs works right now, with the apps you already use, in about five minutes. If WebMCP becomes widespread, OpenTabs plugins can evolve to use it.

## How This Was Built

This might sound a little wild: OpenTabs was built entirely by AI agents. Zero hand-written application code.

I wrote structured PRDs — hundreds of them — and used [Ralph](https://github.com/snarktank/ralph), an autonomous agent loop based on [Geoffrey Huntley's pattern](https://ghuntley.com/loop/), to execute them with [Claude Code](https://github.com/anthropics/claude-code). Multiple workers ran in parallel, each claiming a PRD by pushing a "running" marker to a shared repo — if the push failed, another worker already grabbed it. Just optimistic locking with `git push`. Nothing fancy, but it works.

I open-sourced every single PRD. If you're curious about the process, or doing AI-driven development yourself, the specs might be useful:

**[opentabs-dev/opentabs-prds](https://github.com/opentabs-dev/opentabs-prds)** — the complete development record.

## Architecture

Six packages:

| Package | What it does |
|---------|-------------|
| **MCP Server** | Plugin discovery, tool dispatch, audit log, permissions |
| **Chrome Extension** | Adapter injection, tool relay, side panel UI (Manifest V3) |
| **Plugin SDK** | `OpenTabsPlugin` base class, `defineTool` factory, SDK utilities |
| **Plugin Tools** | Plugin developer CLI (`opentabs-plugin build`) |
| **CLI** | User-facing CLI (`opentabs start`, `opentabs plugin install`, etc.) |
| **Create Plugin** | Scaffolding CLI for new plugin projects |

The UI across the side panel and docs site is built with [RetroUI](https://github.com/Logging-Studio/RetroUI), a NeoBrutalism component library that I really like.

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
- [Architecture](https://opentabs.dev/docs/contributing/architecture) — how the platform works

This project wouldn't exist without [Claude Code](https://github.com/anthropics/claude-code), [OpenCode](https://github.com/anomalyco/opencode), [Ralph](https://github.com/snarktank/ralph), and [RetroUI](https://github.com/Logging-Studio/RetroUI). Genuinely grateful for all of them.

## One More Thing

I asked Claude to talk to Gemini about what makes ChatGPT good. Three rounds, no scripting. Just two AIs being professionals.

<p align="center">
  <a href="https://youtu.be/WRrCeRfiVaI">
    <img src="https://img.youtube.com/vi/WRrCeRfiVaI/maxresdefault.jpg" alt="Claude talking to Gemini about ChatGPT through OpenTabs" />
  </a>
</p>

## Disclaimer

OpenTabs is an independent open-source project. It is **not affiliated with, endorsed by, or sponsored by** any of the third-party services it integrates with. All product names, logos, trademarks, and registered trademarks are the property of their respective owners. Use of these names in plugin identifiers is for identification purposes only and does not imply any association or endorsement.

This software interacts with third-party web applications using your existing authenticated browser sessions. **You are responsible for ensuring your use of OpenTabs complies with the terms of service of any third-party platforms you connect to.** The authors and contributors are not responsible for any unintended actions, data loss, account restrictions, or other consequences that may result from using this tool.

This software is provided "as is", without warranty of any kind. See the [MIT License](LICENSE) for the full terms.

## License

[MIT](LICENSE)
