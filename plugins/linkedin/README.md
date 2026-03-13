# LinkedIn

OpenTabs plugin for LinkedIn — gives AI agents access to LinkedIn through your authenticated browser session.

## Install

```bash
opentabs plugin install linkedin
```

Or install globally via npm:

```bash
npm install -g @opentabs-dev/opentabs-plugin-linkedin
```

## Setup

1. Open [linkedin.com](https://linkedin.com) in Chrome and log in
2. Open the OpenTabs side panel — the LinkedIn plugin should appear as **ready**

## Tools (6)

### Profile (2)

| Tool | Description | Type |
|---|---|---|
| `get_current_user` | Get the current authenticated user | Read |
| `get_user_profile` | Get a user's LinkedIn profile | Read |

### Messaging (4)

| Tool | Description | Type |
|---|---|---|
| `list_conversations` | List messaging conversations | Read |
| `get_conversation_messages` | Read messages in a conversation | Read |
| `send_message` | Send a message in a conversation | Write |
| `get_mailbox_counts` | Get unread message counts | Read |

## How It Works

This plugin runs inside your LinkedIn tab through the [OpenTabs](https://opentabs.dev) Chrome extension. It uses your existing browser session — no API tokens or OAuth apps required. All operations happen as you, with your permissions.

## License

MIT
