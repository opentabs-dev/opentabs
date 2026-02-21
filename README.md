# OpenTabs

Chrome extension + MCP server that gives AI agents access to web applications through your browser.

OpenTabs uses a plugin-based architecture: plugins define tools, resources, and prompts that run in the context of your authenticated browser tabs. AI agents interact with web applications through the MCP protocol — no API keys or service accounts required.

## Quick Start

**Prerequisites:** [Bun](https://bun.sh/) (>= 1.3.9), Google Chrome

```bash
# Clone and install
git clone https://github.com/opentabs-dev/opentabs.git
cd opentabs
bun install

# Build everything
bun run build

# Load the Chrome extension
# 1. Open chrome://extensions/
# 2. Enable Developer mode
# 3. Load unpacked → select ~/.opentabs/extension/

# Start the MCP server
opentabs start
```

## Architecture

```
┌─────────────┐  Streamable HTTP  ┌─────────────┐  WebSocket  ┌──────────────────┐
│  AI Agent   │ ←───────────────→ │ MCP Server  │ ←─────────→ │ Chrome Extension │
└─────────────┘                   └──────┬──────┘             └────────┬─────────┘
                                         │                             │
                                  Plugin Discovery              Adapter Injection
                                  (npm + local paths)           (per plugin, per tab)
```

The **MCP server** discovers plugins and exposes their tools via the MCP protocol. The **Chrome extension** injects plugin adapters into matching browser tabs and dispatches tool calls to them. Plugins run in the page context with access to the user's authenticated session.

## Development

| Command              | Description              |
| -------------------- | ------------------------ |
| `bun run build`      | Build all packages       |
| `bun run type-check` | TypeScript type checking |
| `bun run lint`       | ESLint                   |
| `bun run knip`       | Unused code detection    |
| `bun run test`       | Unit tests               |
| `bun run test:e2e`   | E2E tests (Playwright)   |

**Dev mode** (MCP server with hot reload):

```bash
bun run dev
```

## Directory Structure

```
opentabs/
├── platform/              Core platform packages
│   ├── mcp-server/        MCP server — plugin discovery, tool dispatch
│   ├── browser-extension/ Chrome extension (Manifest V3)
│   ├── plugin-sdk/        Plugin authoring SDK
│   ├── plugin-tools/      Plugin developer CLI (opentabs-plugin)
│   ├── cli/               User-facing CLI (opentabs)
│   └── create-plugin/     Plugin scaffolding CLI
├── plugins/               Example plugins (standalone projects)
└── e2e/                   Playwright E2E tests
```

## Documentation

See [CLAUDE.md](CLAUDE.md) for detailed architecture, conventions, and development guidelines.
