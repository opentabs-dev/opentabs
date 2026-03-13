# Discord

OpenTabs plugin for Discord — gives AI agents access to Discord through your authenticated browser session.

## Install

```bash
opentabs plugin install discord
```

Or install globally via npm:

```bash
npm install -g @opentabs-dev/opentabs-plugin-discord
```

## Setup

1. Open [discord.com](https://discord.com/channels/@me) in Chrome and log in
2. Open the OpenTabs side panel — the Discord plugin should appear as **ready**

## Tools (26)

### Messages (8)

| Tool | Description | Type |
|---|---|---|
| `send_message` | Send a message to a channel | Write |
| `edit_message` | Edit an existing message | Write |
| `delete_message` | Delete a message from a channel | Write |
| `read_messages` | Read recent messages from a channel | Read |
| `read_thread` | Read messages from a thread | Read |
| `search_messages` | Search messages in a server | Read |
| `get_message` | Get a message by ID | Read |
| `list_pinned_messages` | List pinned messages in a channel | Read |

### Servers (3)

| Tool | Description | Type |
|---|---|---|
| `list_guilds` | List servers the user belongs to | Read |
| `get_guild_info` | Get detailed info about a server | Read |
| `list_roles` | List roles in a server | Read |

### Channels (6)

| Tool | Description | Type |
|---|---|---|
| `list_channels` | List channels in a server | Read |
| `get_channel_info` | Get detailed information about a channel | Read |
| `create_channel` | Create a new channel in a server | Write |
| `edit_channel` | Edit a channel's name, topic, or settings | Write |
| `delete_channel` | Delete a channel permanently | Write |
| `create_thread` | Create a new thread | Write |

### Users (2)

| Tool | Description | Type |
|---|---|---|
| `list_members` | List members in a server | Read |
| `get_user_profile` | Get a user's profile information | Read |

### DMs (2)

| Tool | Description | Type |
|---|---|---|
| `list_dms` | List open direct message channels | Read |
| `open_dm` | Open a direct message conversation | Write |

### Reactions (4)

| Tool | Description | Type |
|---|---|---|
| `add_reaction` | Add an emoji reaction to a message | Write |
| `remove_reaction` | Remove an emoji reaction from a message | Write |
| `pin_message` | Pin a message in a channel | Write |
| `unpin_message` | Unpin a message from a channel | Write |

### Files (1)

| Tool | Description | Type |
|---|---|---|
| `upload_file` | Upload a file to a channel | Write |

## How It Works

This plugin runs inside your Discord tab through the [OpenTabs](https://opentabs.dev) Chrome extension. It uses your existing browser session — no API tokens or OAuth apps required. All operations happen as you, with your permissions.

## License

MIT
