# Glama

OpenTabs plugin for Glama — gives AI agents access to Glama through your authenticated browser session.

## Install

```bash
opentabs plugin install glama
```

Or install globally via npm:

```bash
npm install -g @opentabs-dev/opentabs-plugin-glama
```

## Setup

1. Open [glama.ai](https://glama.ai) in Chrome and log in
2. Open the OpenTabs side panel — the Glama plugin should appear as **ready**

## Tools (15)

### MCP Servers (7)

| Tool | Description | Type |
|---|---|---|
| `search_servers` | Search for MCP servers in the Glama directory | Read |
| `get_server` | Get detailed information about an MCP server | Read |
| `list_popular_servers` | List popular MCP servers from the directory | Read |
| `list_server_tools` | List tools provided by an MCP server | Read |
| `list_server_categories` | List MCP server categories | Read |
| `list_servers_by_category` | List MCP servers in a specific category | Read |
| `get_server_score` | Get quality and security scores for an MCP server | Read |

### MCP Tools (1)

| Tool | Description | Type |
|---|---|---|
| `search_tools` | Search for MCP tools across all servers | Read |

### MCP Clients (1)

| Tool | Description | Type |
|---|---|---|
| `list_mcp_clients` | List MCP clients that support the Model Context Protocol | Read |

### Chat (2)

| Tool | Description | Type |
|---|---|---|
| `list_recent_chats` | List recent chat sessions | Read |
| `get_chat_session` | Get details about a chat session | Read |

### Gateway (2)

| Tool | Description | Type |
|---|---|---|
| `list_available_models` | List available LLM models for chat | Read |
| `list_gateway_models` | List LLM models available through the Glama gateway | Read |

### Projects (1)

| Tool | Description | Type |
|---|---|---|
| `list_projects` | List all projects in the workspace | Read |

### Account (1)

| Tool | Description | Type |
|---|---|---|
| `get_current_user` | Get the authenticated user's profile | Read |

## How It Works

This plugin runs inside your Glama tab through the [OpenTabs](https://opentabs.dev) Chrome extension. It uses your existing browser session — no API tokens or OAuth apps required. All operations happen as you, with your permissions.

## License

MIT
