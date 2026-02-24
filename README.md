# OpenTabs

**AI agents for any web app.**

Give AI agents access to any web application through your authenticated browser session. No API keys. No reverse engineering. Just your browser.

OpenTabs is a Chrome extension + MCP server with a plugin-based architecture. Plugins define tools, resources, and prompts that run directly in your browser tabs. Your AI assistant (Claude, Cursor, or any MCP client) calls these tools through the [MCP protocol](https://modelcontextprotocol.io/) — and the action happens in the real web app, using your existing logged-in session.

## Architecture

<p align="center">
  <img src=".github/assets/architecture.svg" alt="OpenTabs architecture: AI Agent communicates via MCP to the OpenTabs Server, which connects via WebSocket to the Chrome Extension running plugin adapters in your browser tabs" width="800" />
</p>

## How It Works

<p align="center">
  <img src=".github/assets/how-it-works.svg" alt="Three-step flow: 1. Agent calls a tool, 2. Server routes it to the right tab, 3. Action runs in the page with your session" width="800" />
</p>

1. **Your AI agent sends a tool call** — Claude, Cursor, or any MCP-compatible agent calls a tool like `slack_send_message` — just like calling an API.

2. **OpenTabs routes it to your browser** — The MCP server dispatches the call to the Chrome extension, which injects it into the correct tab using your existing authenticated session.

3. **The action runs on the real web app** — The plugin adapter executes the action directly in the page context, with full access to the DOM and same-origin APIs. Results flow back to the agent.

## Key Features

- **Zero-configuration access** — uses your existing browser sessions. No API keys, no OAuth, no service accounts.
- **Plugin ecosystem** — anyone can create and publish plugins as npm packages. Install globally and they're auto-discovered.
- **36 built-in browser tools** — tab management, screenshots, DOM interaction, network capture, cookies, and more — available for every tab, no plugin required.
- **Works with any MCP client** — Claude Code, Cursor, and any client that supports Streamable HTTP transport.
- **Hot reload for developers** — the MCP server detects plugin changes automatically. Zero-restart development workflow.

## Quick Start

Get OpenTabs running and make your first tool call in under 5 minutes.

### Install the CLI

```bash
npm install -g @opentabs-dev/cli
```

### Start the server

```bash
opentabs start
```

On first run, this creates `~/.opentabs/`, generates an auth secret, and installs the Chrome extension files.

### Load the Chrome extension

1. Open `chrome://extensions/` in Chrome
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select `~/.opentabs/extension`

### Configure your MCP client

Get your auth secret:

```bash
opentabs config show --json | jq -r .secret
```

Add the server to your MCP client. For Claude Code (`~/.claude.json` — merge into `"mcpServers"`):

```json
{
  "mcpServers": {
    "opentabs": {
      "type": "streamable-http",
      "url": "http://localhost:9515/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_SECRET_HERE"
      }
    }
  }
}
```

### Install a plugin

```bash
opentabs plugin search
npm install -g opentabs-plugin-slack
opentabs start
```

### Verify

```bash
opentabs status
opentabs doctor
```

You're ready. Your AI agent can now use all registered plugin tools and the 36 built-in browser tools.

## Building a Plugin

Want to extend OpenTabs for a new website? You need [Node.js](https://nodejs.org/) (v20+) in addition to the user setup above.

### Scaffold a new plugin

```bash
npx create-opentabs-plugin my-plugin
cd my-plugin
npm install
```

### Build and register

```bash
npm run build
```

This compiles your plugin, generates the adapter bundle and tool manifest, registers the plugin locally, and notifies the running server.

### Develop with hot reload

```bash
opentabs start --dev
```

Dev mode watches your plugin's `dist/` directory and reloads automatically when you rebuild.

See the [Plugin Development guide](https://opentabs.ai/docs/guides/plugin-development) for a complete walkthrough.

## Contributing

Work on the OpenTabs platform itself. You need [Bun](https://bun.sh/) (>= 1.3.9), [Node.js](https://nodejs.org/) (v20+), and Google Chrome.

### Clone and build

```bash
git clone https://github.com/opentabs-dev/opentabs.git
cd opentabs
bun install
bun run build
```

### Start the dev server

```bash
bun run dev
```

### Run the checks

| Command                    | Description                                          |
| -------------------------- | ---------------------------------------------------- |
| `bun run check`            | Run all checks (build, type-check, lint, knip, test) |
| `bun run check:everything` | All checks + E2E tests + docs + plugins              |
| `bun run build`            | Build all packages                                   |
| `bun run type-check`       | TypeScript type checking                             |
| `bun run lint`             | ESLint                                               |
| `bun run knip`             | Unused code detection                                |
| `bun run test`             | Unit tests                                           |
| `bun run test:e2e`         | E2E tests (Playwright)                               |
| `bun run dev:mcp`          | MCP server only with hot reload                      |
| `bun run clean`            | Remove all build artifacts                           |

All commands must exit 0 before committing.

### Directory structure

```
opentabs/
├── platform/                  Core platform packages
│   ├── mcp-server/            MCP server — plugin discovery, tool dispatch
│   ├── browser-extension/     Chrome extension (Manifest V3)
│   ├── plugin-sdk/            Plugin authoring SDK
│   ├── plugin-tools/          Plugin developer CLI (opentabs-plugin)
│   ├── cli/                   User-facing CLI (opentabs)
│   └── create-plugin/         Plugin scaffolding CLI
├── plugins/                   Example plugins (standalone projects)
├── scripts/                   Build and maintenance scripts (clean, plugins, dev)
├── e2e/                       Playwright E2E tests
└── docs/                      Documentation site (opentabs.ai)
```

See the [Development Setup guide](https://opentabs.ai/docs/contributing/dev-setup) for the full contributor workflow.

## Documentation

Full documentation is available at [opentabs.ai/docs](https://opentabs.ai/docs):

- [Quick Start](https://opentabs.ai/docs/quick-start) — 5 minutes from install to your first tool call
- [Installation](https://opentabs.ai/docs/install) — setup paths for users, plugin developers, and contributors
- [Plugin Development](https://opentabs.ai/docs/guides/plugin-development) — build your own plugin from scratch
- [SDK Reference](https://opentabs.ai/docs/sdk/plugin-class) — plugin class, tools, resources, prompts, and utilities
- [CLI Commands](https://opentabs.ai/docs/reference/cli) — all available CLI commands
- [Architecture](https://opentabs.ai/docs/contributing/architecture) — how the platform works under the hood

## License

MIT
