# ChatGPT

OpenTabs plugin for ChatGPT — gives AI agents access to ChatGPT through your authenticated browser session.

## Install

```bash
opentabs plugin install chatgpt
```

Or install globally via npm:

```bash
npm install -g @opentabs-dev/opentabs-plugin-chatgpt
```

## Setup

1. Open [chatgpt.com](https://chatgpt.com) in Chrome and log in
2. Open the OpenTabs side panel — the ChatGPT plugin should appear as **ready**

## Tools (26)

### Account (2)

| Tool | Description | Type |
|---|---|---|
| `get_current_user` | Get your ChatGPT profile | Read |
| `get_account_info` | Get account subscription and features | Read |

### Models (1)

| Tool | Description | Type |
|---|---|---|
| `list_models` | List available AI models | Read |

### Conversations (12)

| Tool | Description | Type |
|---|---|---|
| `list_conversations` | List your ChatGPT conversations | Read |
| `get_conversation` | Get a conversation with messages | Read |
| `search_conversations` | Search conversations by keyword | Read |
| `start_conversation` | Start an ordinary conversation | Write |
| `send_message` | Send a message in the selected project conversation | Write |
| `rename_conversation` | Rename a conversation | Write |
| `archive_conversation` | Archive a conversation | Write |
| `unarchive_conversation` | Unarchive a conversation | Write |
| `star_conversation` | Star a conversation | Write |
| `unstar_conversation` | Unstar a conversation | Write |
| `delete_conversation` | Delete a conversation permanently | Write |
| `list_shared_conversations` | List shared conversations | Read |

### Projects (4)

| Tool | Description | Type |
|---|---|---|
| `list_project_conversations` | List conversations in a ChatGPT project | Read |
| `start_project_conversation` | Start a conversation in a project | Write |
| `send_project_session_message` | Send a message to a named project session | Write |
| `move_conversation_to_project` | Move a conversation into a project | Write |

### Memories (1)

| Tool | Description | Type |
|---|---|---|
| `get_memories` | Get your ChatGPT memories | Read |

### Settings (3)

| Tool | Description | Type |
|---|---|---|
| `get_custom_instructions` | Get your custom instructions | Read |
| `update_custom_instructions` | Update your custom instructions | Write |
| `get_beta_features` | Get beta feature flags | Read |

### Prompts (1)

| Tool | Description | Type |
|---|---|---|
| `get_prompt_library` | Get prompt library templates | Read |

### GPTs (2)

| Tool | Description | Type |
|---|---|---|
| `get_gpt` | Get details about a custom GPT | Read |
| `discover_gpts` | Explore the GPT store | Write |

## How It Works

This plugin runs inside your ChatGPT tab through the [OpenTabs](https://opentabs.dev) Chrome extension. It uses your existing browser session — no API tokens or OAuth apps required. All operations happen as you, with your permissions.

## License

MIT
