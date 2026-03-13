# Claude

OpenTabs plugin for Claude — gives AI agents access to Claude through your authenticated browser session.

## Install

```bash
opentabs plugin install claude
```

Or install globally via npm:

```bash
npm install -g @opentabs-dev/opentabs-plugin-claude
```

## Setup

1. Open [claude.ai](https://claude.ai) in Chrome and log in
2. Open the OpenTabs side panel — the Claude plugin should appear as **ready**

## Tools (14)

### Account (3)

| Tool | Description | Type |
|---|---|---|
| `get_current_user` | Get the current user profile | Read |
| `list_organizations` | List all organizations | Read |
| `list_models` | List available Claude models | Read |

### Conversations (6)

| Tool | Description | Type |
|---|---|---|
| `list_conversations` | List all conversations | Read |
| `get_conversation` | Get a conversation with messages | Read |
| `create_conversation` | Create a conversation with an initial message | Write |
| `send_message` | Send a message and get a response | Write |
| `update_conversation` | Rename a conversation | Write |
| `delete_conversation` | Delete a conversation | Write |

### Projects (5)

| Tool | Description | Type |
|---|---|---|
| `list_projects` | List all projects | Read |
| `get_project` | Get a project by UUID | Read |
| `create_project` | Create a new project | Write |
| `update_project` | Update a project | Write |
| `delete_project` | Delete a project | Write |

## How It Works

This plugin runs inside your Claude tab through the [OpenTabs](https://opentabs.dev) Chrome extension. It uses your existing browser session — no API tokens or OAuth apps required. All operations happen as you, with your permissions.

## License

MIT
