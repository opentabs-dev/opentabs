# OpenTabs

**Your browser is already logged in. Let your AI use it.**

<!-- TODO: Replace with actual demo GIF once recorded -->
<!-- <p align="center">
  <img src=".github/assets/demo.gif" alt="Claude Code sending a Slack message through the browser via OpenTabs" width="700" />
</p> -->

Most MCP servers ask for your API keys. We thought that was a bit odd. You're already logged into Slack, GitHub, Jira, and a dozen other apps in Chrome. Why should your AI need a separate set of credentials?

OpenTabs is a Chrome extension and MCP server that gives your AI agent access to web apps through your existing browser sessions. No API keys. No OAuth setup. No service accounts. If you can see it in a tab, your agent can use it.

## What's Included

Each plugin talks to the real web app through your authenticated session.

| | | | |
|---|---|---|---|
| **Slack** | **GitHub** | **Discord** | **Jira** |
| **Linear** | **Notion** | **GitLab** | **Figma** |
| **Sentry** | **Confluence** | **Cloudflare** | **Supabase** |
| **Vercel** | **Asana** | **Airtable** | **Reddit** |
| **X (Twitter)** | **Teams** | **Bitbucket** | **Stack Overflow** |

Plus built-in browser tools that work on any tab — screenshots, clicking, typing, scrolling, network capture, cookies, DOM inspection, and more. No plugin needed.

## How It Works

<p align="center">
  <img src=".github/assets/how-it-works.svg" alt="Three-step flow: 1. Agent calls a tool, 2. Server routes it to the right tab, 3. Action runs in the page with your session" width="700" />
</p>

1. **Your AI sends a tool call** — `slack_send_message`, `github_create_issue`, whatever you need. It's just a normal MCP tool call.

2. **OpenTabs routes it to the right tab** — The MCP server finds the matching browser tab and dispatches the call through the Chrome extension.

3. **It runs on the real web app** — The plugin adapter executes the action in the page using your logged-in session. Results flow back to the agent.

Works with Claude Code, Cursor, Windsurf, [OpenCode](https://opencode.ai), and any MCP client that supports Streamable HTTP.

## Quick Start

You need [Node.js](https://nodejs.org/) 22+ and Chrome.

```bash
# Install
npm install -g @opentabs-dev/cli

# Start the server
opentabs start
```

On first run, this creates `~/.opentabs/`, generates an auth secret, and prints MCP config blocks you can copy straight into Claude Code or Cursor.

Then load the Chrome extension:

1. Open `chrome://extensions/`
2. Turn on **Developer mode**
3. Click **Load unpacked** → select `~/.opentabs/extension`

Install a plugin and you're done:

```bash
opentabs plugin install slack
```

Your AI agent can now talk to Slack. The whole thing takes about 5 minutes.

## Build Your Own Plugins

This is the part we're most excited about.

You can point your AI agent at any website and it'll build a plugin for you — it analyzes the page, discovers the APIs, scaffolds the code, and registers it. Your agent wrote it, you can read every line, and it runs in your browser. We think that's a pretty good deal.

Behind this is a self-improving skill system. OpenTabs ships with a [build-plugin skill](.claude/skills/build-plugin/) — a comprehensive guide that teaches AI agents how to build production-ready plugins. It covers API discovery, auth patterns, error handling, schema design, testing, and a growing collection of gotchas learned from building every plugin in this repo.

Here's the thing that makes it interesting: **every time an AI builds a plugin, it writes what it learned back into the skill.** New auth patterns, new API discovery techniques, new edge cases — they all get folded in. The skill that teaches AI to build plugins gets better with every plugin built. We'd love your help making it even better. If your agent discovers something new while building a plugin, contribute it back.

Or if you prefer to build by hand:

```bash
opentabs plugin create my-app --domain example.com
cd my-app && npm install
```

Write your tools, build, and the server picks them up automatically:

```bash
npm run build   # compiles, registers, notifies the running server
npm run dev     # watch mode with hot reload
```

Plugins are standalone npm packages. Publish them and anyone can `opentabs plugin install` them. The [Plugin Development guide](https://opentabs.ai/docs/guides/plugin-development) walks through everything.

## Security

Your browser sessions are precious. We know that. Here's how we handle it:

- **Everything starts off.** Every plugin's tools are disabled by default. Not "ask for confirmation" — actually off.
- **AI-assisted code review.** When you enable a plugin, the system offers to have your AI review the adapter source code first. It checks for data exfiltration, credential access, persistence mechanisms, and scope escalation. You see the findings and decide.
- **Version-aware.** When a plugin updates, permissions reset. New code, new review.
- **Three permission levels.** Off (disabled), Ask (confirmation dialog before each call), or Auto (runs immediately). You choose per-plugin or per-tool.
- **Runs locally.** No cloud. No telemetry. Everything lives in `~/.opentabs/` on your machine.
- **Full audit log.** Every tool call is logged — what ran, when, whether it succeeded.

We're not going to pretend this is perfect. Browser extensions that interact with your web apps are inherently a trust decision. But we wanted the defaults to be safe and the controls to be in your hands. The [full security model](https://opentabs.ai/docs/reference/configuration) is documented, and the code is open source — read it.

## Frequently Asked Questions

**Why not just use the official MCP server for Slack / GitHub / etc.?**

Good question — and if an official MCP server works well for you, you should absolutely use it. We started building OpenTabs for the apps that *don't* ship official MCP support — Discord, Figma, Linear, and many others had no MCP server at all when we began. Along the way, we also built plugins for apps that do have official servers, partly for learning, and partly because we noticed a few things: setting up a separate API key or OAuth flow for each service adds up fast when you use ten of them. Public APIs sometimes have stricter rate limits or a smaller feature set than the web app itself. And the web app is always the superset — it has access to internal APIs, real-time data, and features that never make it to the public API.

We see OpenTabs and official MCP servers as complementary. Use whatever works best for your setup — or mix and match.

**How is this different from browser automation MCP servers (Playwright, Stagehand, Browser-Use)?**

Those are great tools — we're fans. The difference is in the approach.

Browser automation tools work by interacting with the page visually: snapshot the DOM, find the element, click it, wait, snapshot again. That means they work on any site out of the box, which is a real strength. The tradeoff is that the AI figures out how to navigate the site fresh every time. If a popup appears or the design changes, it has to re-figure things out. And whatever the AI learned about that site during the session is gone afterward — there's no way to share or reuse that knowledge.

OpenTabs plugins call the web app's internal APIs directly, so a tool like `slack_send_message` isn't clicking a text box — it's making the same API call Slack's own frontend makes. Once a plugin is built, it's a structured, typed, reusable package that anyone can install. The knowledge accumulates: every plugin built makes the platform more useful for everyone.

The tradeoff is that OpenTabs needs a plugin per site. But between the pre-built plugins and your AI agent's ability to build new ones on the fly, the coverage grows fast.

**What about Chrome's WebMCP?**

[Chrome's WebMCP](https://developer.chrome.com/blog/webmcp-epp) is a proposal where websites expose structured MCP tools natively in the browser. We think it's a great idea — it's how the web should probably work long-term.

The timeline depends on web services choosing to adopt it, though, and that kind of ecosystem shift takes a while. WebMCP is in early preview today. OpenTabs works right now, with the apps you already use, in about five minutes. If and when WebMCP becomes widespread, OpenTabs plugins can evolve to use it. We're excited to see where it goes.

**Can I build a plugin for Google Docs / Gmail / Google Sheets?**

We'll be honest: we burned a *lot* of tokens trying to build Google Workspace plugins and couldn't crack it. Google did a genuinely impressive job obscuring their internal APIs — hats off to them, honestly. If you manage to figure it out and want to contribute a Google Workspace plugin back, you'd be our hero. The [build-plugin skill](.claude/skills/build-plugin/) has everything your AI agent needs to try.

## How This Was Built

This might sound a little wild: OpenTabs was built entirely by AI agents.

568 structured PRDs (product requirement documents), executed over 19 days by up to 6 parallel Claude Code workers running in Docker containers. Zero hand-written application code. The work queue is just git — `git push` serialization acts as a distributed lock. No Redis, no SQS, no external infrastructure.

We open-sourced every single PRD. If you're curious about the process, or if you're doing AI-driven development yourself, the specs might be useful:

**[opentabs-dev/opentabs-prds](https://github.com/opentabs-dev/opentabs-prds)** — 568 PRDs, the complete development record.

## Architecture

The platform has six packages:

| Package | What it does |
|---------|-------------|
| **MCP Server** | Plugin discovery, tool dispatch, audit log, permissions |
| **Chrome Extension** | Adapter injection, tool relay, side panel UI (Manifest V3) |
| **Plugin SDK** | `OpenTabsPlugin` base class, `defineTool` factory, SDK utilities |
| **Plugin Tools** | Plugin developer CLI (`opentabs-plugin build`) |
| **CLI** | User-facing CLI (`opentabs start`, `opentabs plugin install`, etc.) |
| **Create Plugin** | Scaffolding CLI for new plugin projects |

## Contributing

We'd love your help. You need [Node.js](https://nodejs.org/) 22+ and Chrome.

```bash
git clone https://github.com/opentabs-dev/opentabs.git
cd opentabs
npm install
npm run build
npm run dev       # tsc watch + MCP server + extension
```

Before committing, make sure everything passes:

```bash
npm run check     # build + type-check + lint + knip + test
```

See the [Development Setup guide](https://opentabs.ai/docs/contributing/dev-setup) for the full contributor workflow.

## Documentation

**[opentabs.ai/docs](https://opentabs.ai/docs)**

- [Quick Start](https://opentabs.ai/docs/quick-start) — install to first tool call in 5 minutes
- [Plugin Development](https://opentabs.ai/docs/guides/plugin-development) — build a plugin from scratch
- [SDK Reference](https://opentabs.ai/docs/sdk/plugin-class) — plugin class, tools, and utilities
- [Browser Tools](https://opentabs.ai/docs/reference/browser-tools) — built-in tools for any tab
- [CLI Reference](https://opentabs.ai/docs/reference/cli) — every command
- [Architecture](https://opentabs.ai/docs/contributing/architecture) — how the platform works

## License

[MIT](LICENSE)
